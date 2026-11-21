// Native PostgreSQL/local-storage recovery proof. Drive below is an explicit in-memory test double.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  backupStateSql,
  storagePolicySql,
  schemaDefaultSql,
  schemaAccessSql,
  assertSchemaAccess,
  applicationDumpArgs,
  portableRestoreList,
  portableSchemaSql,
  assertBackupState,
  seal,
  sha,
  mac,
} from "./backup-lib.mjs";
import { recover, extractRecovery, assertIdentityMapping } from "./restore.mjs";

const project = "demolay-local-test";
if (process.env.CONFIRM_LOCAL_NATIVE_RESTORE_TEST !== project)
  throw new Error(
    `Set CONFIRM_LOCAL_NATIVE_RESTORE_TEST=${project}. This creates and removes only a disposable local recovery database.`,
  );
const docker = process.env.LOCAL_TEST_DOCKER || "docker";
const container = `supabase_db_${project}`;
function run(args, input) {
  const result = spawnSync(docker, args, { input, windowsHide: true, maxBuffer: 96 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(
      `Local native recovery operation failed (SQLSTATE ${result.stderr.toString().match(/ERROR: +([0-9A-Z]{5}):/)?.[1] || "unknown"}); inspect the isolated stack privately.`,
    );
  return result.stdout;
}
const inspect = (name) => JSON.parse(run(["inspect", name]))[0];
for (const name of [container, `supabase_kong_${project}`]) {
  const info = inspect(name);
  assert.equal(info.State.Running, true);
  const bindings = Object.values(info.NetworkSettings.Ports).flatMap((item) => item || []);
  assert.ok(
    bindings.length && bindings.every((item) => item.HostIp === "127.0.0.1"),
    "Local stack must bind only to loopback.",
  );
}
const psql = (database, input) =>
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
    ],
    input,
  )
    .toString()
    .trim();
const query = (database, text) => JSON.parse(psql(database, text));
const dump = (args) =>
  run(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", ...args]);
const target = `cms_restore_${randomBytes(8).toString("hex")}`;
assert.ok(/^cms_restore_[a-f0-9]{16}$/.test(target) && target !== "postgres");
assert.equal(psql("postgres", "select current_setting('server_version_num')::int / 10000;"), "17");
const temporary = await mkdtemp(join(tmpdir(), "demolay-native-restore-"));
const output = join(temporary, "recovered");
let created = false;
try {
  const before = query("postgres", backupStateSql);
  assertBackupState(before);
  const archive = dump(applicationDumpArgs);
  const contents = run(["exec", "-i", container, "pg_restore", "--list"], archive).toString();
  const containerList = "/tmp/demolay-restore-" + randomUUID() + ".list";
  let sql;
  try {
    run(
      ["exec", "-i", container, "sh", "-c", 'cat > "$1"', "sh", containerList],
      portableRestoreList(contents),
    );
    sql = Buffer.concat([
      Buffer.from(portableSchemaSql),
      run(
        [
          "exec",
          "-i",
          container,
          "pg_restore",
          "--no-owner",
          "--use-list=" + containerList,
          "--file=-",
        ],
        archive,
      ),
    ]);
  } finally {
    run(["exec", container, "rm", "-f", containerList]);
  }
  assert.ok(sql.length > 0);
  const edgeEnv = Object.fromEntries(
    inspect(`supabase_edge_runtime_${project}`).Config.Env.map((value) => {
      const at = value.indexOf("=");
      return [value.slice(0, at), value.slice(at + 1)];
    }),
  );
  let serviceKey = edgeEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    const gateway = run([
      "exec",
      `supabase_kong_${project}`,
      "cat",
      "/home/kong/kong.yml",
    ]).toString();
    serviceKey = gateway
      .match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)
      ?.find((value) => {
        try {
          return JSON.parse(Buffer.from(value.split(".")[1], "base64url")).role === "service_role";
        } catch {
          return false;
        }
      });
  }
  assert.ok(serviceKey, "Local service configuration is unavailable.");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const indexKey = randomBytes(32).toString("base64"),
    runId = randomUUID(),
    createdAt = new Date().toISOString();
  const files = new Map();
  function put(content, kind) {
    const id = randomUUID();
    files.set(id, seal(content, publicKey, { kind, runId }));
    return { fileId: id, sha256: sha(content), bytes: content.length };
  }
  const database = put(sql, "database"),
    media = [];
  for (const object of before.objects) {
    const path = object.name.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `http://127.0.0.1:54321/storage/v1/object/authenticated/${object.bucket_id}/${path}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    assert.equal(response.status, 200, "Local source object must be readable.");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, Number(object.metadata.size));
    media.push({
      bucket: object.bucket_id,
      path: object.name,
      contentType: response.headers.get("content-type"),
      ...put(bytes, "media"),
    });
  }
  assert.ok(media.length > 0, "Run the local HTTP image fixtures first.");
  assertBackupState(query("postgres", backupStateSql), before);
  const manifest = {
    version: 1,
    id: runId,
    createdAt,
    source: "isolated-local-fixture",
    database,
    identities: before.identities,
    roles: before.roles,
    buckets: before.buckets,
    media,
    schemaDefaults: before.schemaDefaults,
    schemaAccess: before.schemaAccess,
    storagePolicies: before.storagePolicies.map((item) => item.sql).join("\n"),
  };
  const refs = [...files.keys()];
  const manifestId = randomUUID();
  files.set(
    manifestId,
    seal(Buffer.from(JSON.stringify(manifest)), publicKey, { kind: "manifest", runId, refs }),
  );
  const data = {
    version: 2,
    id: runId,
    createdAt,
    manifestId,
    manifestSha256: sha(files.get(manifestId)),
    refs,
    files: refs.map((id) => ({ id, sha256: sha(files.get(id)) })),
  };
  const indexId = randomUUID();
  files.set(
    indexId,
    Buffer.from(JSON.stringify({ data, mac: mac(indexKey, JSON.stringify(data)) })),
  );
  // Test double only: this does not exercise Drive OAuth, network uploads or retention.
  const drive = {
    async get(id) {
      assert.ok(files.has(id));
      return files.get(id);
    },
  };
  const recovered = await recover(drive, indexId, privateKey, indexKey);
  await extractRecovery(recovered, output);
  for (const object of media)
    assert.equal(
      sha(await readFile(join(output, "media", object.bucket, object.path))),
      object.sha256,
    );

  // Native template cloning is unavailable while Supabase clients use postgres; bootstrap matching managed fixture schemas instead.
  const bootstrap = dump([
    "--format=plain",
    "--schema=auth",
    "--schema=storage",
    "--schema=extensions",
    "--encoding=UTF8",
  ])
    .toString()
    .replace(/^CREATE POLICY [\s\S]*?;\r?$/gm, "");
  psql("postgres", `create database ${target} template template0;`);
  created = true;
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "VERBOSITY=verbose",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "supabase_admin",
      "-d",
      target,
    ],
    bootstrap,
  );
  assertIdentityMapping(
    before.identities,
    query(
      target,
      `select coalesce(json_agg(x order by x.id),'[]') from (select u.id,u.email,coalesce((select json_agg(json_build_object('provider',i.provider,'provider_id',i.provider_id) order by i.provider,i.provider_id) from auth.identities i where i.user_id=u.id),'[]') as identities from auth.users u) x;`,
    ),
  );
  // Fixture provisioning emulates the platform's managed defaults; application restoration below uses only postgres.
  const defaultSetup = psql(
    "postgres",
    `select coalesce(string_agg(format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %s%s;',r.rolname,n.nspname,a.privilege_type,case d.defaclobjtype when 'r' then 'TABLES' when 'S' then 'SEQUENCES' when 'f' then 'FUNCTIONS' end,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,case when a.is_grantable then ' WITH GRANT OPTION' else '' end),' '),'') from pg_default_acl d join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) a where n.nspname='public';`,
  );
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "supabase_admin",
      "-d",
      target,
    ],
    defaultSetup,
  );
  assert.deepEqual(query(target, schemaDefaultSql), before.schemaDefaults);
  psql(target, "drop schema if exists private cascade;");
  // Provision the retained platform schema exactly; restoration must not silently keep extra target grants.
  const sourcePublic = before.schemaAccess.find((item) => item.schema === "public");
  const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
  const targetPublic = query(target, schemaAccessSql).find((item) => item.schema === "public");
  const grantees = new Set([...sourcePublic.acl, ...targetPublic.acl].map((item) => item.grantee));
  const setupAccess =
    `ALTER SCHEMA public OWNER TO ${quote(sourcePublic.owner)};` +
    [...grantees]
      .map(
        (role) => `REVOKE ALL ON SCHEMA public FROM ${role === "PUBLIC" ? "PUBLIC" : quote(role)};`,
      )
      .join("\n") +
    sourcePublic.acl
      .map(
        (item) =>
          `SET ROLE ${quote(item.grantor)}; GRANT ${item.privilege} ON SCHEMA public TO ${item.grantee === "PUBLIC" ? "PUBLIC" : quote(item.grantee)}${item.grantable ? " WITH GRANT OPTION" : ""}; RESET ROLE;`,
      )
      .join("\n");
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "supabase_admin",
      "-d",
      target,
    ],
    setupAccess,
  );
  assertSchemaAccess(recovered.manifest.schemaAccess, query(target, schemaAccessSql));
  const alreadyGranted = sourcePublic.acl.some(
    (item) => item.grantee === "authenticated" && item.privilege === "CREATE",
  );
  assert.equal(
    alreadyGranted,
    false,
    "Source fixture must not grant authenticated schema creation",
  );
  psql(target, "grant create on schema public to authenticated;");
  assert.throws(
    () => assertSchemaAccess(recovered.manifest.schemaAccess, query(target, schemaAccessSql)),
    /retained schema owner or privileges differ/,
  );
  assert.equal(
    psql(
      target,
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p');",
    ),
    "0",
  );
  psql(target, "revoke create on schema public from authenticated;");
  assertSchemaAccess(recovered.manifest.schemaAccess, query(target, schemaAccessSql));
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "VERBOSITY=verbose",
      "--single-transaction",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      target,
    ],
    await readFile(join(output, "database.sql")),
  );
  run(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      target,
    ],
    await readFile(join(output, "storage-policies.sql")),
  );
  psql(target, "delete from auth.sessions;");
  assert.equal(psql(target, "select count(*) from auth.sessions;"), "0");
  assert.deepEqual(query(target, schemaDefaultSql), before.schemaDefaults);
  assertSchemaAccess(recovered.manifest.schemaAccess, query(target, schemaAccessSql));
  assert.equal(psql(target, "select count(*) from private.session_activity;"), "0");
  for (const table of [
    "content",
    "content_publications",
    "live_content",
    "media",
    "finance_drafts",
    "finance_publications",
    "audit",
    "staff",
  ])
    assert.equal(
      psql(target, `select count(*) from private.${table};`),
      psql("postgres", `select count(*) from private.${table};`),
      `Native restored ${table} count`,
    );
  const protections = `select coalesce(json_agg(x order by x.relname),'[]') from (select c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('anon',c.oid,'select') as anon_read,has_table_privilege('authenticated',c.oid,'select') as staff_read,has_table_privilege('service_role',c.oid,'select') as service_read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r') x;`;
  assert.deepEqual(query(target, protections), query("postgres", protections));
  const policies = `select coalesce(json_agg(x order by x.tablename,x.policyname),'[]') from (select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='private') x;`;
  assert.deepEqual(query(target, policies), query("postgres", policies));
  assert.deepEqual(query(target, storagePolicySql), before.storagePolicies);
  assert.deepEqual(
    query(target, "set role anon; select public.cms_public_snapshot();"),
    query("postgres", "set role anon; select public.cms_public_snapshot();"),
  );
  assert.throws(() => psql(target, "set role anon; select * from private.staff;"));
  assert.throws(() => psql(target, "set role authenticated; select * from private.staff;"));
  console.log(
    `PASS: native PostgreSQL 17 application dump, encrypted authenticated recovery, isolated ordinary-postgres SQL restoration, identity mappings, RLS/grants and ${media.length} actual local media checksums. Drive was an in-memory test double; recovered media used temporary fixture storage, not a live target bucket. Managed default ACLs were preserved and an extra target schema CREATE grant was rejected before restoration; a real hosted/offsite drill remains separate.`,
  );
} finally {
  try {
    if (created) {
      assert.ok(/^cms_restore_[a-f0-9]{16}$/.test(target) && target !== "postgres");
      psql("postgres", `drop database ${target} with (force);`);
    }
  } finally {
    const absolute = resolve(temporary),
      root = resolve(tmpdir()) + sep;
    assert.ok(
      absolute.startsWith(root) && absolute.split(sep).at(-1).startsWith("demolay-native-restore-"),
    );
    await rm(absolute, { recursive: true, force: true });
  }
}
