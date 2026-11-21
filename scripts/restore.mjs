import { mkdir, mkdtemp, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import {
  required,
  open,
  verifyIndex,
  sha,
  driveClient,
  checkedFetch,
  pgEnvironment,
  pgBinary,
  query,
  runPg,
  identitySql,
  roleSql,
  schemaDefaultSql,
  schemaAccessSql,
  assertSchemaAccess,
  assertSchemaDefaults,
  assertProjectDatabase,
  isMain,
  main,
} from "./backup-lib.mjs";

export function safePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))
  )
    throw new Error("Unsafe media path");
  return path;
}
export async function recover(drive, indexId, privateKey, trustedIndexKey) {
  const index = verifyIndex(await drive.get(indexId), trustedIndexKey);
  const encryptedManifest = await drive.get(index.manifestId);
  if (sha(encryptedManifest) !== index.manifestSha256)
    throw new Error("Authenticated manifest hash mismatch");
  const { plaintext, metadata } = open(encryptedManifest, privateKey);
  const manifest = JSON.parse(plaintext);
  if (
    manifest.version !== 1 ||
    metadata.kind !== "manifest" ||
    manifest.id !== metadata.runId ||
    manifest.id !== index.id ||
    manifest.createdAt !== index.createdAt ||
    JSON.stringify(metadata.refs) !== JSON.stringify(index.refs) ||
    !Array.isArray(manifest.media) ||
    !Array.isArray(manifest.identities) ||
    !Array.isArray(manifest.roles)
  )
    throw new Error("Invalid recovery manifest");
  const allowed = new Set(["cms-originals", "cms-derivatives", "cms-public"]);
  if (
    manifest.buckets?.length !== 3 ||
    new Set(manifest.buckets.map((b) => b.id)).size !== 3 ||
    manifest.buckets.some((b) => !allowed.has(b.id))
  )
    throw new Error("Invalid recovery buckets");
  const values = new Map();
  const expectedHashes = new Map(index.files.map((entry) => [entry.id, entry.sha256]));
  let total = 0;
  const seen = new Set();
  for (const record of [manifest.database, ...manifest.media]) {
    if (!record || !metadata.refs.includes(record.fileId)) throw new Error("Unlisted backup file");
    if (record.bucket) {
      if (!allowed.has(record.bucket)) throw new Error("Invalid recovery bucket");
      safePath(record.path);
      const path = `${record.bucket}/${record.path}`;
      if (seen.has(path)) throw new Error("Duplicate recovery object");
      seen.add(path);
    }
    if (!values.has(record.fileId)) {
      const encrypted = await drive.get(record.fileId);
      if (sha(encrypted) !== expectedHashes.get(record.fileId))
        throw new Error("Authenticated backup file hash mismatch");
      const recovered = open(encrypted, privateKey);
      if (recovered.metadata.kind !== (record.bucket ? "media" : "database"))
        throw new Error("Unexpected backup file kind");
      values.set(record.fileId, recovered.plaintext);
      total += recovered.plaintext.length;
      if (total > 1024 * 1024 * 1024) throw new Error("Recovery exceeds 1 GiB safety budget");
    }
    const content = values.get(record.fileId);
    if (sha(content) !== record.sha256 || content.length !== record.bytes)
      throw new Error("Recovered backup integrity mismatch");
  }
  if (values.size !== expectedHashes.size)
    throw new Error("Authenticated backup file inventory mismatch");
  return { manifest, values };
}
export async function extractRecovery(recovery, destination) {
  const target = resolve(destination);
  if (
    await stat(target).then(
      () => true,
      () => false,
    )
  )
    throw new Error("Recovery destination must not exist");
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".restore-"));
  try {
    await writeFile(join(staging, "manifest.json"), JSON.stringify(recovery.manifest, null, 2), {
      mode: 0o600,
    });
    await writeFile(
      join(staging, "database.sql"),
      recovery.values.get(recovery.manifest.database.fileId),
      { mode: 0o600 },
    );
    await writeFile(
      join(staging, "storage-policies.sql"),
      recovery.manifest.storagePolicies || "",
      { mode: 0o600 },
    );
    for (const object of recovery.manifest.media) {
      const path = join(staging, "media", object.bucket, safePath(object.path));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, recovery.values.get(object.fileId), { mode: 0o600 });
    }
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export function assertIdentityMapping(expected, actual) {
  for (const user of expected) {
    const target = actual.find((value) => value.id === user.id);
    if (
      !target ||
      target.email?.toLowerCase() !== user.email?.toLowerCase() ||
      JSON.stringify(target.identities) !== JSON.stringify(user.identities)
    )
      throw new Error("Target authentication identity mapping missing or different");
  }
}
export async function applyRecovery(recovery, env = process.env) {
  const { manifest, values } = recovery;
  const base = required(env, "RESTORE_SUPABASE_URL");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base))
    throw new Error("Restore requires an isolated Supabase target");
  const host = new URL(base).hostname;
  if (host === manifest.source || required(env, "RESTORE_TARGET_CONFIRM") !== host)
    throw new Error("Restore target must be isolated and explicitly confirmed");
  const dbUrl = required(env, "RESTORE_DATABASE_URL");
  assertProjectDatabase(dbUrl, base);
  const dbEnv = pgEnvironment(dbUrl, env);
  const dbObjects = await query(
    `select json_build_object('count',count(*)::int) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S','f')`,
    dbEnv,
  );
  if (dbObjects.count !== 0) throw new Error("Restore target application schemas must be empty");
  assertIdentityMapping(manifest.identities, await query(identitySql, dbEnv));
  const roles = await query(roleSql, dbEnv);
  for (const role of manifest.roles) {
    const target = roles.find((r) => r.rolname === role.rolname);
    if (
      !target ||
      Object.keys(role).some((key) => JSON.stringify(target[key]) !== JSON.stringify(role[key]))
    )
      throw new Error("Restore target roles differ; provision and review roles first");
  }
  assertSchemaAccess(manifest.schemaAccess, await query(schemaAccessSql, dbEnv));
  assertSchemaDefaults(manifest.schemaDefaults, await query(schemaDefaultSql, dbEnv));
  const key = required(env, "RESTORE_SUPABASE_SERVICE_KEY");
  const call = (path, options = {}) =>
    checkedFetch(`${base}/storage/v1/${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers },
    });
  const existing = await (await call("bucket")).json();
  if (existing.some((bucket) => manifest.buckets.some((b) => b.id === bucket.id)))
    throw new Error("Target recovery buckets must not exist");
  const created = [];
  let committed = false;
  try {
    for (const bucket of manifest.buckets) {
      await call("bucket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bucket.id,
          name: bucket.name,
          public: false,
          file_size_limit: bucket.file_size_limit,
          allowed_mime_types: bucket.allowed_mime_types,
        }),
      });
      created.push(bucket.id);
    }
    for (const object of manifest.media) {
      await call(
        `object/${object.bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "POST",
          headers: { "Content-Type": object.contentType, "x-upsert": "false" },
          body: values.get(object.fileId),
        },
      );
    }
    // psql rolls back schema+data together. Never disable triggers or bypass foreign key validation.
    const sql = Buffer.concat([
      values.get(manifest.database.fileId),
      Buffer.from(`\n${manifest.storagePolicies || ""}\n`),
    ]);
    await runPg(
      pgBinary(dbEnv, "psql"),
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"],
      dbEnv,
      sql,
    );
    committed = true;
    console.log(
      "Database and media restored to isolated target. Buckets remain private pending owner validation and MFA reenrollment.",
    );
  } finally {
    if (!committed) {
      for (const bucket of created.reverse()) {
        // Cleanup is best effort; a failed network may leave private staging objects requiring operator removal.
        await call(`bucket/${bucket}/empty`, { method: "POST" }).catch(() => {});
        await call(`bucket/${bucket}`, { method: "DELETE" }).catch(() => {});
      }
    }
  }
}
if (isMain(import.meta.url))
  await main(async () => {
    const [indexId, destination] = process.argv.slice(2);
    if (!indexId || !destination)
      throw new Error("Missing restore arguments: COMPLETION_INDEX_ID DESTINATION_OR_--apply");
    const privateKey = await readFile(required(process.env, "RESTORE_PRIVATE_KEY_FILE"), "utf8");
    const indexKey = await readFile(required(process.env, "RESTORE_INDEX_KEY_FILE"), "utf8");
    const drive = await driveClient(process.env);
    const recovery = await recover(drive, indexId, privateKey, indexKey);
    if (destination === "--apply") await applyRecovery(recovery);
    else {
      await extractRecovery(recovery, destination);
      console.log("Recovery bundle authenticated and extracted privately.");
    }
  });
