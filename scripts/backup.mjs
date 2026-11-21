import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  LIMIT,
  sha,
  required,
  seal,
  keyId,
  mac,
  verifyIndex,
  checkedFetch,
  bytes,
  driveClient,
  applicationDump,
  pgEnvironment,
  captureConsistentBackup,
  backupCodeRevision,
  assertProjectDatabase,
  isMain,
  main,
} from "./backup-lib.mjs";

export async function recordStatus(
  env,
  id,
  status,
  createdAt,
  manifestId = null,
  recoveryIndexId = null,
) {
  const url = required(env, "BACKUP_SUPABASE_URL");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    throw new Error("Invalid backup Supabase URL");
  const key = required(env, "BACKUP_SUPABASE_SERVICE_KEY");
  await checkedFetch(`${url}/rest/v1/rpc/cms_record_backup`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_id: id,
      p_status: status,
      p_created_at: createdAt,
      p_manifest_id: manifestId,
      p_detail:
        status === "success"
          ? `Encrypted snapshot uploaded and read back; restore drill separate. Recovery index: ${recoveryIndexId}`
          : "Backup failed; inspect CI privately.",
    }),
  });
}
export async function retain(drive, files, secret, now = Date.now()) {
  const indices = [];
  // Authenticate every index before deleting anything. A failed/rotated key stops GC safely.
  for (const file of files.filter((f) => f.appProperties.kind === "index")) {
    const data = verifyIndex(await drive.get(file.id), secret);
    indices.push({ file, data });
  }
  const keep = indices.filter(({ data }) => now - Date.parse(data.createdAt) <= 30 * 86400_000);
  if (!keep.length) throw new Error("No recent complete backup; retention stopped");
  const live = new Set(keep.flatMap(({ file, data }) => [file.id, data.manifestId, ...data.refs]));
  const oldIndices = indices.filter(({ file }) => !live.has(file.id));
  // Remove expired recovery points before their content, so no advertised backup loses its media.
  for (const { file, data } of oldIndices) {
    await drive.remove(file.id);
    if (!live.has(data.manifestId)) await drive.remove(data.manifestId);
  }
  const removed = new Set(oldIndices.flatMap(({ file, data }) => [file.id, data.manifestId]));
  for (const file of files) {
    if (
      !live.has(file.id) &&
      !removed.has(file.id) &&
      now - Date.parse(file.createdTime) > 30 * 86400_000 &&
      ["media", "database", "manifest"].includes(file.appProperties.kind)
    )
      await drive.remove(file.id);
  }
}
export async function performBackup(env = process.env) {
  const id = randomUUID(),
    createdAt = new Date().toISOString();
  let complete = false;
  try {
    const publicKey =
      env.BACKUP_PUBLIC_KEY_PEM ||
      (await readFile(required(env, "BACKUP_PUBLIC_KEY_FILE"), "utf8"));
    if (publicKey.includes("PRIVATE KEY")) {
      throw new Error("Backup runner accepts only an offline owner's public key");
    }
    const secret = required(env, "BACKUP_INDEX_KEY");
    if (Buffer.from(secret, "base64").length < 32)
      throw new Error("Index key must be at least 32 random bytes");
    const base = required(env, "BACKUP_SUPABASE_URL");
    const databaseUrl = required(env, "BACKUP_DATABASE_URL");
    assertProjectDatabase(databaseUrl, base);
    const dbEnv = pgEnvironment(databaseUrl, env);
    const drive = await driveClient(env);
    const existing = await drive.list();
    const trusted = new Map();
    for (const file of existing.filter((entry) => entry.appProperties.kind === "index")) {
      const index = verifyIndex(await drive.get(file.id), secret);
      for (const entry of index.files) {
        if (trusted.has(entry.id) && trusted.get(entry.id) !== entry.sha256) {
          throw new Error("Conflicting authenticated backup file hashes");
        }
        trusted.set(entry.id, entry.sha256);
      }
    }
    const hashes = new Map();
    async function upload(name, plaintext, kind, deduplicate = false) {
      const filename = deduplicate
        ? `media-${keyId(publicKey).slice(0, 16)}-${mac(secret, plaintext)}.enc`
        : `${id}-${name}.enc`;
      const found = deduplicate
        ? existing.find(
            (f) => f.name === filename && f.appProperties.kind === kind && trusted.has(f.id),
          )
        : null;
      let file, encoded;
      if (found) {
        encoded = await drive.get(found.id);
        if (sha(encoded) !== trusted.get(found.id))
          throw new Error("Existing encrypted object corrupted");
        file = found;
      } else {
        encoded = seal(plaintext, publicKey, { runId: id, kind });
        file = await drive.put(filename, encoded, { kind, sha256: sha(encoded) });
        if (sha(await drive.get(file.id)) !== sha(encoded))
          throw new Error("Drive upload readback mismatch");
        existing.push(file);
        trusted.set(file.id, sha(encoded));
      }
      hashes.set(file.id, sha(encoded));
      return { fileId: file.id, sha256: sha(plaintext), bytes: plaintext.length };
    }
    const {
      identities,
      roles,
      database,
      buckets,
      media,
      storagePolicies,
      schemaDefaults,
      schemaAccess,
    } = await captureConsistentBackup(dbEnv, async (state) => {
      const { identities, roles, buckets, objects } = state;
      const sql = await applicationDump(dbEnv);
      if (!sql.length) throw new Error("Empty database dump");
      const database = await upload("database.sql", sql, "database");

      if (buckets.length !== 3) throw new Error("Required media buckets missing");
      const serviceKey = required(env, "BACKUP_SUPABASE_SERVICE_KEY");
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base))
        throw new Error("Invalid backup Supabase URL");
      const media = [];
      let totalBytes = sql.length;
      for (const object of objects) {
        const encodedPath = object.name.split("/").map(encodeURIComponent).join("/");
        const response = await checkedFetch(
          `${base}/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${encodedPath}`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        );
        const content = await bytes(response, LIMIT);
        totalBytes += content.length;
        if (totalBytes > 1024 * 1024 * 1024) throw new Error("Backup exceeds 1 GiB safety budget");
        if (object.metadata?.size != null && content.length !== Number(object.metadata.size))
          throw new Error("Media changed during backup");
        media.push({
          bucket: object.bucket_id,
          path: object.name,
          contentType: response.headers.get("content-type") || "application/octet-stream",
          ...(await upload("media", content, "media", true)),
        });
      }
      const storagePolicies = state.storagePolicies.map((row) => row.sql).join("\n");
      return {
        identities,
        roles,
        database,
        buckets,
        media,
        storagePolicies,
        schemaDefaults: state.schemaDefaults,
        schemaAccess: state.schemaAccess,
      };
    });
    const manifest = {
      version: 1,
      application: backupCodeRevision(env),
      id,
      createdAt,
      database,
      identities,
      roles,
      buckets,
      media,
      storagePolicies,
      schemaDefaults,
      schemaAccess,
      source: new URL(base).hostname,
      restrictions:
        "Application public/private schemas and storage policies only. No auth sessions, refresh tokens, MFA secrets, passwords or provider configuration. Recreate identities before database restore.",
    };
    const refs = [...hashes.keys()];
    const encoded = seal(Buffer.from(JSON.stringify(manifest)), publicKey, {
      runId: id,
      kind: "manifest",
      createdAt,
      refs,
    });
    const manifestFile = await drive.put(`${id}-manifest.enc`, encoded, {
      kind: "manifest",
      sha256: sha(encoded),
    });
    if (sha(await drive.get(manifestFile.id)) !== sha(encoded))
      throw new Error("Manifest upload readback mismatch");
    const data = {
      version: 2,
      id,
      createdAt,
      manifestId: manifestFile.id,
      manifestSha256: sha(encoded),
      refs,
      files: [...hashes].map(([id, sha256]) => ({ id, sha256 })),
    };
    const index = Buffer.from(JSON.stringify({ data, mac: mac(secret, JSON.stringify(data)) }));
    const indexFile = await drive.put(`${id}-complete.json`, index, { kind: "index" });
    verifyIndex(await drive.get(indexFile.id), secret);
    await recordStatus(env, id, "success", createdAt, manifestFile.id, indexFile.id);
    complete = true;
    // Heartbeat providers alert if no start/success arrives; a scheduler outage is independently visible.
    await checkedFetch(required(env, "BACKUP_HEARTBEAT_URL"), {
      method: "POST",
      body: "Encrypted backup complete",
    });
    await retain(drive, await drive.list(), secret);
    console.log("Encrypted backup uploaded and verified; 30-day retention completed.");
  } catch (error) {
    if (!complete) await recordStatus(env, id, "failure", createdAt).catch(() => {});
    // Incomplete encrypted uploads are deliberately unreferenced; GC after a later successful backup removes them after 30 days.
    throw error;
  }
}
if (isMain(import.meta.url)) await main(() => performBackup());
