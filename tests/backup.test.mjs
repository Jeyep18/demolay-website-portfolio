import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import {
  seal,
  open,
  sha,
  mac,
  driveClient,
  verifyIndex,
  pgEnvironment,
  roleSql,
  storagePolicySql,
  assertProjectDatabase,
  backupStateSql,
  backupCodeRevision,
  main,
  portableRestoreList,
  assertSchemaDefaults,
  schemaAccessSql,
  assertSchemaAccess,
  assertBackupState,
  captureConsistentBackup,
} from "../scripts/backup-lib.mjs";
import { generateBackupKeys } from "../scripts/backup-keygen.mjs";
import {
  recover,
  extractRecovery,
  assertIdentityMapping,
  safePath,
  applyRecovery,
} from "../scripts/restore.mjs";
import { retain, performBackup } from "../scripts/backup.mjs";
import { checkStale } from "../scripts/backup-stale.mjs";
import { runInNewContext } from "node:vm";

test("manual snapshot opt-in does not enable disabled backup schedules or default dispatches", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/backup.yml", import.meta.url),
    "utf8",
  );
  const expression = workflow.match(/SNAPSHOT_REQUESTED: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(expression);
  assert.match(workflow, /create_snapshot:[\s\S]*?type: boolean\s+default: false/);
  assert.match(workflow, /name: Create encrypted snapshot\s+if: env.SNAPSHOT_REQUESTED == 'true'/);
  for (const [enabled, event, requested, expected] of [
    ["false", "schedule", false, false],
    ["false", "schedule", true, false],
    ["false", "workflow_dispatch", undefined, false],
    ["false", "workflow_dispatch", false, false],
    ["false", "workflow_dispatch", true, true],
    ["false", "push", true, false],
    ["true", "schedule", undefined, true],
    ["true", "workflow_dispatch", false, true],
  ]) {
    assert.equal(
      Boolean(
        runInNewContext(
          expression,
          {
            vars: { BACKUPS_ENABLED: enabled },
            github: { event_name: event },
            inputs: { create_snapshot: requested },
          },
          { timeout: 100 },
        ),
      ),
      expected,
      `${enabled}/${event}/${requested}`,
    );
  }
});

test("bundled PostgreSQL CA is the pinned unexpired Supabase root", async () => {
  const pem = await readFile(
    new URL("../supabase/certs/prod-ca-2021.crt", import.meta.url),
    "utf8",
  );
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.ca, true);
  assert.ok(certificate.verify(certificate.publicKey));
  assert.equal(
    certificate.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.ok(Date.parse(certificate.validFrom) <= Date.now());
  assert.ok(Date.parse(certificate.validTo) > Date.now());
  assert.ok(!pem.includes("PRIVATE KEY"));
});

const keys = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const now = Date.now(),
  secret = "fixture-only-test-index-key";
const sql = `CREATE ROLE fixture_reader; CREATE TABLE public.fixture_reports(id int primary key,title text,published bool); INSERT INTO public.fixture_reports VALUES(1,'Published report',true),(2,'Private draft',false); ALTER TABLE public.fixture_reports ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_public ON public.fixture_reports TO fixture_reader USING(published); GRANT SELECT ON public.fixture_reports TO fixture_reader;`;
function fixture() {
  const files = new Map(),
    records = [];
  let n = 0;
  const drive = {
    async get(id) {
      if (!files.has(id)) throw new Error("Missing backup file");
      return files.get(id);
    },
    async list() {
      return records.filter((r) => files.has(r.id));
    },
    async remove(id) {
      files.delete(id);
    },
  };
  function put(body, kind, createdAt = new Date(now).toISOString()) {
    const id = `fixture_${++n}`;
    files.set(id, body);
    records.push({ id, createdTime: createdAt, appProperties: { kind } });
    return id;
  }
  const db = Buffer.from(sql),
    media = Buffer.from("fixture media bytes");
  const dbId = put(seal(db, keys.publicKey, { kind: "database" }), "database");
  const mediaId = put(seal(media, keys.publicKey, { kind: "media" }), "media");
  const manifest = {
    version: 1,
    id: "fixture-run",
    createdAt: new Date(now).toISOString(),
    source: "original.supabase.co",
    database: { fileId: dbId, sha256: sha(db), bytes: db.length },
    identities: [
      {
        id: "fixture-user",
        email: "fixture@example.invalid",
        identities: [{ provider: "google", provider_id: "fixture-google-subject" }],
      },
    ],
    roles: [],
    buckets: ["cms-originals", "cms-derivatives", "cms-public"].map((id) => ({
      id,
      name: id,
      public: id === "cms-public",
    })),
    media: [
      {
        bucket: "cms-originals",
        path: "fixture/photo.png",
        contentType: "image/png",
        fileId: mediaId,
        sha256: sha(media),
        bytes: media.length,
      },
    ],
    storagePolicies: "",
  };
  const manifestId = put(
    seal(Buffer.from(JSON.stringify(manifest)), keys.publicKey, {
      runId: manifest.id,
      kind: "manifest",
      refs: [dbId, mediaId],
    }),
    "manifest",
  );
  const index = {
    version: 2,
    id: manifest.id,
    createdAt: manifest.createdAt,
    manifestId,
    manifestSha256: sha(files.get(manifestId)),
    refs: [dbId, mediaId],
    files: [dbId, mediaId].map((id) => ({ id, sha256: sha(files.get(id)) })),
  };
  const indexId = put(
    Buffer.from(JSON.stringify({ data: index, mac: mac(secret, JSON.stringify(index)) })),
    "index",
  );
  return { files, records, drive, manifest, manifestId, indexId, dbId, mediaId, put, media, index };
}

test("authenticated fixture really restores SQL data, RLS and media into temporary local fixture storage", async () => {
  const f = fixture(),
    parent = await mkdtemp(join(tmpdir(), "demolay-backup-test-")),
    destination = join(parent, "recovered");
  const database = new PGlite();
  try {
    const recovered = await recover(f.drive, f.indexId, keys.privateKey, secret);
    await extractRecovery(recovered, destination);
    await database.exec(await readFile(join(destination, "database.sql"), "utf8"));
    assert.deepEqual(
      (await database.query("select id,title from fixture_reports order by id")).rows,
      [
        { id: 1, title: "Published report" },
        { id: 2, title: "Private draft" },
      ],
    );
    await database.exec("SET ROLE fixture_reader");
    assert.deepEqual((await database.query("select id from fixture_reports")).rows, [{ id: 1 }]);
    assert.deepEqual(
      await readFile(join(destination, "media/cms-originals/fixture/photo.png")),
      f.media,
    );
    assertIdentityMapping(f.manifest.identities, f.manifest.identities);
    assert.equal((await stat(destination)).isDirectory(), true);
    await assert.rejects(extractRecovery(recovered, destination), /must not exist/);
  } finally {
    await database.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("ciphertext corruption is rejected before recovery", async () => {
  const f = fixture(),
    envelope = JSON.parse(f.files.get(f.mediaId));
  const content = Buffer.from(envelope.ciphertext, "base64");
  content[0] ^= 1;
  envelope.ciphertext = content.toString("base64");
  f.files.set(f.mediaId, Buffer.from(JSON.stringify(envelope)));
  await assert.rejects(recover(f.drive, f.indexId, keys.privateKey, secret));
});
test("public-key-only attacker cannot replace a manifest with validly encrypted malicious SQL", async () => {
  const f = fixture(),
    parent = await mkdtemp(join(tmpdir(), "demolay-forgery-test-")),
    destination = join(parent, "must-not-exist");
  try {
    const maliciousSql = Buffer.from("DROP SCHEMA public CASCADE;");
    f.files.set(f.dbId, seal(maliciousSql, keys.publicKey, { kind: "database" }));
    const forged = {
      ...f.manifest,
      database: { fileId: f.dbId, sha256: sha(maliciousSql), bytes: maliciousSql.length },
    };
    f.files.set(
      f.manifestId,
      seal(Buffer.from(JSON.stringify(forged)), keys.publicKey, {
        runId: forged.id,
        kind: "manifest",
        refs: f.index.refs,
      }),
    );
    // Both replacement envelopes decrypt correctly; only the independently trusted index prevents this forgery.
    assert.equal(
      open(f.files.get(f.dbId), keys.privateKey).plaintext.toString(),
      maliciousSql.toString(),
    );
    await assert.rejects(
      async () =>
        extractRecovery(await recover(f.drive, f.indexId, keys.privateKey, secret), destination),
      /Authenticated manifest hash mismatch/,
    );
    await assert.rejects(stat(destination), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
test("changed completion-index manifest id or wrong MAC key rejects before reading manifest or writing files", async () => {
  const f = fixture(),
    originalGet = f.drive.get,
    fetched = [];
  f.drive.get = async (id) => {
    fetched.push(id);
    return originalGet(id);
  };
  await assert.rejects(
    recover(f.drive, f.indexId, keys.privateKey, "wrong-independent-key"),
    /index authentication failed/,
  );
  assert.deepEqual(fetched, [f.indexId]);
  fetched.length = 0;
  const index = JSON.parse(f.files.get(f.indexId));
  index.data.manifestId = "attacker_manifest";
  f.files.set(f.indexId, Buffer.from(JSON.stringify(index)));
  await assert.rejects(
    recover(f.drive, f.indexId, keys.privateKey, secret),
    /index authentication failed/,
  );
  assert.deepEqual(fetched, [f.indexId]);
});
test("validly encrypted public-key replacement of a media file fails signed ciphertext hash", async () => {
  const f = fixture();
  f.files.set(f.mediaId, seal(f.media, keys.publicKey, { kind: "media" }));
  await assert.rejects(
    recover(f.drive, f.indexId, keys.privateKey, secret),
    /Authenticated backup file hash mismatch/,
  );
});
test("completion index must bind exact distinct file ids and hashes", async () => {
  const f = fixture(),
    data = { ...f.index, refs: [f.dbId] };
  f.files.set(
    f.indexId,
    Buffer.from(JSON.stringify({ data, mac: mac(secret, JSON.stringify(data)) })),
  );
  await assert.rejects(
    recover(f.drive, f.indexId, keys.privateKey, secret),
    /Invalid backup index/,
  );
});
test("restore requires an independent trusted index key", async () => {
  const f = fixture();
  await assert.rejects(
    recover(f.drive, f.indexId, keys.privateKey),
    /Missing trusted backup index key/,
  );
});
test("missing encrypted object is rejected", async () => {
  const f = fixture();
  f.files.delete(f.mediaId);
  await assert.rejects(recover(f.drive, f.indexId, keys.privateKey, secret), /Missing backup file/);
});
test("wrong offline key is rejected", async () => {
  const wrong = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const f = fixture();
  await assert.rejects(recover(f.drive, f.indexId, wrong.privateKey, secret), /Wrong backup key/);
});
test("changing authenticated header is rejected", () => {
  const body = JSON.parse(seal(Buffer.from("test"), keys.publicKey, { kind: "media" }));
  body.metadata.kind = "database";
  assert.throws(() => open(Buffer.from(JSON.stringify(body)), keys.privateKey));
});
test("expired/revoked OAuth returns safe failure without echoing provider response or credentials", async () => {
  const env = {
    BACKUP_GOOGLE_CLIENT_ID: "private-client",
    BACKUP_GOOGLE_CLIENT_SECRET: "private-secret",
    BACKUP_GOOGLE_REFRESH_TOKEN: "private-refresh",
  };
  await assert.rejects(
    driveClient(env, async () => new Response("private-secret: invalid_grant", { status: 400 })),
    { message: "Backup remote request failed (400)" },
  );
});
test("missing OAuth authentication fails before a request", async () => {
  let called = false;
  await assert.rejects(
    driveClient({}, async () => {
      called = true;
    }),
    /Missing BACKUP_GOOGLE_CLIENT_ID/,
  );
  assert.equal(called, false);
});
test("missing or changed target auth identity mapping refuses restore", () => {
  const f = fixture();
  assert.throws(() => assertIdentityMapping(f.manifest.identities, []), /identity mapping/);
  assert.throws(
    () =>
      assertIdentityMapping(f.manifest.identities, [
        { ...f.manifest.identities[0], identities: [] },
      ]),
    /identity mapping/,
  );
});
test("restore refuses original cloud project before any database/storage changes", async () => {
  const f = fixture();
  await assert.rejects(
    applyRecovery(
      { manifest: f.manifest, values: new Map() },
      {
        RESTORE_SUPABASE_URL: "https://original.supabase.co",
        RESTORE_TARGET_CONFIRM: "original.supabase.co",
      },
    ),
    /isolated/,
  );
});
test("media traversal and remote database without certificate verification fail closed", () => {
  for (const path of ["../secrets", "a/../b", "C:/secrets", "a\\b", "/root", "a//b"])
    assert.throws(() => safePath(path));
  assert.throws(
    () => pgEnvironment("postgres://user:password@db.example.com/postgres"),
    /verify-full/,
  );
  assert.equal(pgEnvironment("postgres://user:password@localhost/postgres").PGPASSWORD, "password");
});
test("retention keeps shared immutable media and removes only expired recovery points/unreferenced old blobs", async () => {
  const f = fixture(),
    old = new Date(now - 31 * 86400_000).toISOString();
  const oldManifest = f.put(Buffer.from("old ciphertext"), "manifest", old);
  const orphan = f.put(Buffer.from("orphan ciphertext"), "media", old);
  const data = { ...f.index, id: "old", createdAt: old, manifestId: oldManifest };
  const oldIndex = f.put(
    Buffer.from(JSON.stringify({ data, mac: mac(secret, JSON.stringify(data)) })),
    "index",
    old,
  );
  await retain(f.drive, await f.drive.list(), secret, now);
  assert.equal(f.files.has(f.mediaId), true);
  assert.equal(f.files.has(f.dbId), true);
  for (const id of [oldManifest, oldIndex, orphan]) assert.equal(f.files.has(id), false);
});
test("tampered retention index prevents all deletion", async () => {
  const f = fixture(),
    data = { ...f.index, refs: [] };
  f.put(Buffer.from(JSON.stringify({ data, mac: "00" })), "index");
  const count = f.files.size;
  await assert.rejects(retain(f.drive, await f.drive.list(), secret, now), /authentication failed/);
  assert.equal(f.files.size, count);
  assert.throws(() => verifyIndex(Buffer.from(JSON.stringify({ data, mac: "00" })), secret));
});
test("independent stale check rejects old or incomplete recovery points", async () => {
  const f = fixture();
  assert.equal((await checkStale(f.drive, secret, now)).manifestId, f.manifestId);
  await assert.rejects(checkStale(f.drive, secret, now + 37 * 3600_000), /30 hours/);
  f.files.delete(f.mediaId);
  await assert.rejects(checkStale(f.drive, secret, now), /missing files/);
});
test("storage policy and safe role inventory SQL actually round-trip in local PostgreSQL fixture", async () => {
  const source = new PGlite(),
    target = new PGlite();
  try {
    const setup = `CREATE ROLE fixture_storage_reader; CREATE SCHEMA storage; CREATE TABLE storage.objects(name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`;
    await source.exec(setup);
    await target.exec(setup);
    await source.exec(
      `CREATE POLICY fixture_storage ON storage.objects AS RESTRICTIVE FOR SELECT TO fixture_storage_reader USING(name like 'public/%');`,
    );
    const policies = (await source.query(storagePolicySql)).rows[0].coalesce;
    for (const policy of policies) await target.exec(policy.sql);
    assert.deepEqual(
      (await target.query(storagePolicySql)).rows,
      (await source.query(storagePolicySql)).rows,
    );
    const roles = (await source.query(roleSql)).rows[0].coalesce;
    assert.equal(
      roles.some((role) => role.rolname === "fixture_storage_reader"),
      true,
    );
    assert.equal(JSON.stringify(roles).includes("rolpassword"), false);
  } finally {
    await source.close();
    await target.close();
  }
});
test("backup refuses private keys in CI before requesting credentials", async () => {
  await assert.rejects(
    performBackup({ BACKUP_PUBLIC_KEY_PEM: keys.privateKey }),
    /only an offline owner's public key/,
  );
});
test("source database must match project and use direct or session pooler", () => {
  assertProjectDatabase(
    "postgres://postgres:password@db.fixture.supabase.co/postgres",
    "https://fixture.supabase.co",
  );
  assertProjectDatabase(
    "postgres://postgres.fixture:password@aws-0-region.pooler.supabase.com:5432/postgres",
    "https://fixture.supabase.co",
  );
  assert.throws(() =>
    assertProjectDatabase(
      "postgres://postgres:password@db.other.supabase.co/postgres",
      "https://fixture.supabase.co",
    ),
  );
  assert.throws(() =>
    assertProjectDatabase(
      "postgres://postgres.fixture:password@aws-0-region.pooler.supabase.com:6543/postgres",
      "https://fixture.supabase.co",
    ),
  );
  assert.throws(() =>
    assertProjectDatabase(
      "postgres://postgres.fixture:password@unrelated.example.com:5432/postgres",
      "https://fixture.supabase.co",
    ),
  );
});
test("offline key generation creates usable keys and refuses replacement", async () => {
  const parent = await mkdtemp(join(tmpdir(), "demolay-keygen-test-")),
    destination = join(parent, "offline");
  try {
    await generateBackupKeys(destination);
    const publicKey = await readFile(join(destination, "backup-public.pem"), "utf8");
    const privateKey = await readFile(join(destination, "backup-private.pem"), "utf8");
    assert.equal(
      open(seal(Buffer.from("key self check"), publicKey), privateKey).plaintext.toString(),
      "key self check",
    );
    assert.equal(
      Buffer.from(await readFile(join(destination, "backup-index.key"), "utf8"), "base64").length,
      32,
    );
    await assert.rejects(generateBackupKeys(destination));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

function stableSource() {
  return {
    audit: { count: "3", highwater: "10" },
    identities: [{ id: "owner", email: "owner@example.invalid", identities: [] }],
    roles: [],
    schemaAccess: [{ schema: "public", owner: "postgres", acl: [] }],
    storagePolicies: [],
    buckets: [],
    objects: [
      "cms-originals/owner/photo.original",
      "cms-derivatives/photo.webp",
      "cms-public/photo.webp",
    ].map((key) => ({ bucket_id: key.split("/")[0], name: key.split("/").slice(1).join("/") })),
    media: [
      {
        id: "photo",
        status: "ready",
        original_path: "owner/photo.original",
        derivative_path: "photo.webp",
        public_path: "photo.webp",
      },
    ],
    receipts: [
      { id: "photo", original_path: "owner/photo.original", derivative_path: "photo.webp" },
    ],
  };
}
test("backup consistency guard permits a quiet complete capture before writing its completion index", async () => {
  const source = stableSource(),
    events = [];
  await captureConsistentBackup(
    {},
    async () => {
      events.push("capture SQL and media");
      return 123;
    },
    async () => structuredClone(source),
  );
  events.push("write completion index");
  assert.deepEqual(events, ["capture SQL and media", "write completion index"]);
});
for (const action of [
  "publish",
  "archive",
  "out-of-order audit commit",
  "identity mapping change",
  "schema privilege change",
  "unfinished retirement",
  "storage mutation",
  "promotion canceled after dump",
]) {
  test(`backup refuses ${action} during capture before writing a completion index`, async () => {
    const source = stableSource();
    let complete = false;
    await assert.rejects(async () => {
      await captureConsistentBackup(
        {},
        async () => {
          if (action === "identity mapping change")
            source.identities[0].email = "changed@example.invalid";
          else if (action === "schema privilege change")
            source.schemaAccess[0].acl.push({ grantee: "authenticated", privilege: "CREATE" });
          else if (action === "unfinished retirement") source.media[0].status = "revoking";
          else if (action === "storage mutation") source.objects.pop();
          else if (action === "promotion canceled after dump")
            source.media[0].row_version = "new-transaction";
          else {
            source.audit.count = "4";
            if (action !== "out-of-order audit commit") source.audit.highwater = "11";
          }
        },
        async () => structuredClone(source),
      );
      complete = true;
    }, /retry|repair storage/);
    assert.equal(complete, false);
  });
}
test("backup rejects unresolved promotion or retirement before dumping or downloading", async () => {
  for (const status of ["promoting", "revoking"]) {
    const source = stableSource();
    source.media[0].status = status;
    let captured = false;
    await assert.rejects(
      captureConsistentBackup(
        {},
        async () => {
          captured = true;
        },
        async () => source,
      ),
      /unfinished media operation/,
    );
    assert.equal(captured, false);
  }
});
test("backup requires every registered original, derivative and ready public object", () => {
  for (let missing = 0; missing < 3; missing++) {
    const source = stableSource();
    source.objects.splice(missing, 1);
    assert.throws(() => assertBackupState(source), /missing referenced media/);
  }
});
test("backup consistency inventory SQL returns an atomic audit, identity and storage observation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema private; create schema storage;
      create table auth.users(id uuid,email text); create table auth.identities(user_id uuid,provider text,provider_id text);
      create table private.audit(id bigint); insert into private.audit values(2),(10);
      create table private.media(id uuid,status text,original_path text,derivative_path text,public_path text);
      create table private.upload_receipts(id uuid,original_path text,derivative_path text);
      create table storage.objects(bucket_id text,name text,metadata jsonb);
      create table storage.buckets(id text,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);
      insert into storage.buckets values('cms-public','cms-public',true,null,null);`);
    const state = (await db.query(backupStateSql)).rows[0].json_build_object;
    assert.deepEqual(state.audit, { count: "2", highwater: "10" });
    assert.deepEqual(state.identities, []);
    assert.equal(state.buckets[0].id, "cms-public");
    assertBackupState(state);
    await db.exec(
      `insert into private.media values('11111111-1111-1111-1111-111111111111','approved','owner/photo.original','photo.webp',null);`,
    );
    const initial = (await db.query(backupStateSql)).rows[0].json_build_object;
    await db.exec(`update private.media set status='promoting';`);
    await db.exec(`update private.media set status='approved';`);
    const canceled = (await db.query(backupStateSql)).rows[0].json_build_object;
    assert.equal(initial.media[0].status, canceled.media[0].status);
    assert.notEqual(initial.media[0].row_version, canceled.media[0].row_version);
  } finally {
    await db.close();
  }
});

test("backup records validated workflow code provenance without guessing a local revision", () => {
  assert.equal(backupCodeRevision({}), null);
  const env = { GITHUB_REPOSITORY: "chapter/site", GITHUB_SHA: "a".repeat(40) };
  assert.deepEqual(backupCodeRevision(env), {
    repository: "chapter/site",
    revision: "a".repeat(40),
  });
  for (const bad of [
    { GITHUB_SHA: "a".repeat(40) },
    { ...env, GITHUB_REPOSITORY: "https://untrusted.invalid/site" },
    { ...env, GITHUB_SHA: "main" },
  ])
    assert.throws(() => backupCodeRevision(bad), /Invalid backup application revision/);
});

test("backup CLI exposes only safe consistency retry guidance and masks provider details", async () => {
  const originalError = console.error,
    originalExit = process.exitCode,
    messages = [];
  console.error = (message) => messages.push(message);
  try {
    await main(async () => {
      throw new Error("Backup source changed during capture; retry during a quiet period");
    });
    await main(async () => {
      throw new Error("provider-secret-token");
    });
    assert.equal(messages[0], "Backup source changed during capture; retry during a quiet period");
    assert.equal(messages[1].includes("provider-secret-token"), false);
    assert.equal(process.exitCode, 1);
  } finally {
    console.error = originalError;
    process.exitCode = originalExit;
  }
});

test("portable archive list omits only existing application schema creation and managed default ACL entries", () => {
  const omitted = [
    "14; 2615 17558 SCHEMA - private postgres",
    "11; 2615 2200 SCHEMA - public pg_database_owner",
    "2447; 826 16454 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES supabase_admin",
  ];
  const retained = [
    "4060; 0 0 ACL - SCHEMA private postgres",
    "4062; 0 0 ACL - SCHEMA public pg_database_owner",
    "2446; 826 16453 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES postgres",
    "2446; 826 16453 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES chapter_custom_role",
    "2447; 826 16454 DEFAULT ACL other DEFAULT PRIVILEGES FOR FUNCTIONS supabase_admin",
    "3000; 0 123 ACL private TABLE staff postgres",
    "3001; 0 124 POLICY private staff staff_policy postgres",
    "1; 1 1 SCHEMA - public_archive postgres",
  ];
  const filtered = portableRestoreList([...omitted, ...retained].join("\n")).split("\n");
  for (const line of omitted) assert.ok(filtered.includes(";" + line));
  for (const line of retained) assert.ok(filtered.includes(line));
});
test("schema default ACL preflight refuses changed managed or customer-owned defaults", () => {
  const expected = [
    {
      owner: "supabase_admin",
      schema: "public",
      kind: "r",
      acl: "{postgres=arwdDxtm/supabase_admin}",
    },
  ];
  assertSchemaDefaults(expected, structuredClone(expected));
  assert.throws(() => assertSchemaDefaults(undefined, []), /schema default privileges differ/);
  assert.throws(() => assertSchemaDefaults(expected, []), /schema default privileges differ/);
  assert.throws(
    () => assertSchemaDefaults(expected, [{ ...expected[0], acl: "different" }]),
    /schema default privileges differ/,
  );
  const customer = [{ ...expected[0], owner: "postgres", acl: "{postgres=arwdDxtm/postgres}" }];
  assert.throws(
    () =>
      assertSchemaDefaults(customer, [
        { ...customer[0], acl: "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres}" },
      ]),
    /schema default privileges differ/,
  );
});

test("retained schema preflight rejects extra effective grants and owner changes before restore", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role authenticated; create schema private;");
    const readAccess = async () => (await db.query(schemaAccessSql)).rows[0].coalesce;
    const expected = await readAccess();
    assertSchemaAccess(expected, expected);
    assertSchemaAccess(
      expected,
      expected.filter((item) => item.schema === "public"),
    );
    assert.throws(
      () => assertSchemaAccess(undefined, expected),
      /retained schema owner or privileges differ/,
    );
    assert.throws(
      () => assertSchemaAccess(expected, []),
      /retained schema owner or privileges differ/,
    );
    await db.exec("grant create on schema public to authenticated;");
    const changed = await readAccess();
    assert.throws(
      () => assertSchemaAccess(expected, changed),
      /retained schema owner or privileges differ/,
    );
    await db.exec("revoke create on schema public from authenticated;");
    assertSchemaAccess(expected, await readAccess());
    await db.exec("alter schema public owner to authenticated;");
    const changedOwner = await readAccess();
    assert.throws(
      () => assertSchemaAccess(expected, changedOwner),
      /retained schema owner or privileges differ/,
    );
    await db.exec(
      "alter schema public owner to pg_database_owner; grant usage on schema private to authenticated;",
    );
    const changedPrivate = await readAccess();
    assert.throws(
      () => assertSchemaAccess(expected, changedPrivate),
      /retained schema owner or privileges differ/,
    );
  } finally {
    await db.close();
  }
});
