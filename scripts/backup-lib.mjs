import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  constants,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export const LIMIT = 64 * 1024 * 1024;
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function required(env, name) {
  if (!env[name]) throw new Error(`Missing ${name}`);
  return env[name];
}
export function keyId(key) {
  const publicKey = createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "rsa" || publicKey.asymmetricKeyDetails.modulusLength < 3072)
    throw new Error("RSA key must have at least 3072 bits");
  return sha(publicKey.export({ type: "spki", format: "der" }));
}
export function seal(bytes, publicKey, header = {}) {
  if (bytes.length > LIMIT) throw new Error("Backup file exceeds 64 MiB safety limit");
  const metadata = { ...header, version: 1, keyId: keyId(publicKey) };
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      metadata,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      wrapped: publicEncrypt(
        { key: publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
        key,
      ).toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }),
  );
}
export function open(bytes, privateKey) {
  const value = JSON.parse(bytes);
  if (value.metadata.version !== 1 || value.metadata.keyId !== keyId(privateKey))
    throw new Error("Wrong backup key or format");
  const key = privateDecrypt(
    { key: privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(value.wrapped, "base64"),
  );
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  cipher.setAAD(Buffer.from(JSON.stringify(value.metadata)));
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const plaintext = Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, "base64")),
    cipher.final(),
  ]);
  if (plaintext.length > LIMIT) throw new Error("Backup file exceeds safety limit");
  return { metadata: value.metadata, plaintext };
}
export const mac = (secret, data) => createHmac("sha256", secret).update(data).digest("hex");
export function verifyIndex(file, secret) {
  if (!secret) throw new Error("Missing trusted backup index key");
  const index = JSON.parse(file);
  const expected = Buffer.from(mac(secret, JSON.stringify(index.data)), "hex");
  const actual = Buffer.from(index.mac ?? "", "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Backup index authentication failed");
  const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id);
  const validHash = (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
  if (
    index.data.version !== 2 ||
    !validId(index.data.id) ||
    !validId(index.data.manifestId) ||
    !validHash(index.data.manifestSha256) ||
    !Array.isArray(index.data.refs) ||
    !Array.isArray(index.data.files) ||
    index.data.files.some((entry) => !validId(entry.id) || !validHash(entry.sha256)) ||
    JSON.stringify(index.data.refs) !== JSON.stringify(index.data.files.map((entry) => entry.id)) ||
    new Set(index.data.refs).size !== index.data.refs.length ||
    index.data.refs.includes(index.data.manifestId) ||
    !Number.isFinite(Date.parse(index.data.createdAt))
  )
    throw new Error("Invalid backup index");
  return index.data;
}
export async function checkedFetch(url, options = {}, request = fetch) {
  let result;
  try {
    result = await request(url, {
      ...options,
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Backup network request failed");
  }
  if (!result.ok) throw new Error(`Backup remote request failed (${result.status})`);
  return result;
}
export async function bytes(response, max = LIMIT * 1.5) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) {
      await response.body.cancel?.().catch(() => {});
      throw new Error("Remote backup file exceeds safety limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function driveClient(env, request = fetch) {
  const body = new URLSearchParams({
    client_id: required(env, "BACKUP_GOOGLE_CLIENT_ID"),
    client_secret: required(env, "BACKUP_GOOGLE_CLIENT_SECRET"),
    refresh_token: required(env, "BACKUP_GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const tokenResponse = await checkedFetch(
    "https://oauth2.googleapis.com/token",
    { method: "POST", body },
    request,
  );
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error("Drive OAuth did not return an access token");
  const folder = required(env, "BACKUP_DRIVE_FOLDER_ID");
  if (folder && !/^[A-Za-z0-9_-]+$/.test(folder)) throw new Error("Invalid Drive folder ID");
  const call = (path, options = {}) =>
    checkedFetch(
      `https://www.googleapis.com/${path}`,
      {
        ...options,
        headers: { Authorization: `Bearer ${token.access_token}`, ...options.headers },
      },
      request,
    );
  return {
    async list() {
      const all = [];
      let pageToken;
      do {
        const query = new URLSearchParams({
          q: `trashed = false and appProperties has { key='application' and value='demolay-backup-v1' }${folder ? ` and '${folder}' in parents` : ""}`,
          fields: "nextPageToken,files(id,name,createdTime,appProperties)",
          pageSize: "1000",
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await (await call(`drive/v3/files?${query}`)).json();
        all.push(...page.files);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return all;
    },
    async put(name, body, properties) {
      const boundary = `backup-${randomBytes(16).toString("hex")}`;
      const metadata = {
        name,
        appProperties: { application: "demolay-backup-v1", ...properties },
        ...(folder ? { parents: [folder] } : {}),
      };
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      return (
        await call(
          "upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,appProperties",
          {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body: payload,
          },
        )
      ).json();
    },
    async get(id) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Drive file ID");
      return bytes(await call(`drive/v3/files/${id}?alt=media`));
    },
    async remove(id) {
      await call(`drive/v3/files/${id}`, { method: "DELETE" });
    },
  };
}
export async function runPg(binary, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const output = [];
    let size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 10 * 60_000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        failed = true;
        child.kill();
      } else output.push(chunk);
    });
    // Provider errors may include connection strings or private rows; never print stderr.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("PostgreSQL executable unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 && !failed
        ? resolve(Buffer.concat(output))
        : reject(new Error("PostgreSQL command failed; inspect privately on the operator machine"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export function pgEnvironment(url, env = process.env) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Invalid PostgreSQL URL");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
    parsed.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error("Remote database requires sslmode=verify-full");
  return {
    ...env,
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "disable",
    PGSSLROOTCERT: env.PGSSLROOTCERT || "system",
    PGCONNECT_TIMEOUT: "30",
    PGOPTIONS: "-c statement_timeout=600000",
    PGPASSFILE: env.PGPASSFILE || (process.platform === "win32" ? "NUL" : "/dev/null"),
  };
}
export function assertProjectDatabase(databaseUrl, origin) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin)) {
    throw new Error("Invalid Supabase project origin");
  }
  const host = new URL(origin).hostname;
  const parsed = new URL(databaseUrl);
  const direct = parsed.hostname === `db.${host}`;
  const session =
    parsed.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(parsed.username) === `postgres.${host.split(".")[0]}`;
  if ((!direct && !session) || (parsed.port && parsed.port !== "5432")) {
    throw new Error("Database connection must match project and use direct/session port 5432");
  }
}
export const pgBinary = (env, name) =>
  env.BACKUP_PG_BIN
    ? `${env.BACKUP_PG_BIN}/${name}${process.platform === "win32" ? ".exe" : ""}`
    : name;
export const identitySql = `select coalesce(json_agg(x order by x.id), '[]') from (select u.id,u.email,coalesce((select json_agg(json_build_object('provider',i.provider,'provider_id',i.provider_id) order by i.provider,i.provider_id) from auth.identities i where i.user_id=u.id),'[]') as identities from auth.users u) x`;
export const roleSql = `select coalesce(json_agg(x order by x.rolname),'[]') from (select r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls,coalesce((select json_agg(parent.rolname order by parent.rolname) from pg_auth_members m join pg_roles parent on parent.oid=m.roleid where m.member=r.oid),'[]') as memberships from pg_roles r where r.rolname !~ '^pg_') x`;
export const storagePolicySql = `select coalesce(json_agg(x),'[]') from (select format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',policyname,schemaname,tablename,permissive,cmd,(select string_agg(quote_ident(r),',') from unnest(roles) r),case when qual is null then '' else ' USING (' || qual || ')' end,case when with_check is null then '' else ' WITH CHECK (' || with_check || ')' end) as sql from pg_policies where schemaname='storage' and tablename in ('objects','buckets') order by tablename,policyname) x`;
export const storageSql = `select coalesce(json_agg(x order by x.bucket_id,x.name),'[]') from (select bucket_id,name,metadata from storage.objects where bucket_id in ('cms-originals','cms-derivatives','cms-public')) x`;
export const schemaDefaultSql = `select coalesce(json_agg(x order by x.owner,x.schema,x.kind),'[]') from (select r.rolname as owner,n.nspname as schema,d.defaclobjtype as kind,d.defaclacl::text as acl from pg_default_acl d join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in ('public','private')) x`;
export const schemaAccessSql = `select coalesce(json_agg(x order by x.schema),'[]') from (select n.nspname as schema,pg_get_userbyid(n.nspowner) as owner,coalesce((select json_agg(a order by a.grantor,a.grantee,a.privilege,a.grantable) from (select pg_get_userbyid(e.grantor) as grantor,case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end as grantee,e.privilege_type as privilege,e.is_grantable as grantable from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) e) a),'[]') as acl from pg_namespace n where n.nspname in ('public','private')) x`;
export function assertSchemaAccess(expected, actual) {
  if (
    !Array.isArray(expected) ||
    !Array.isArray(actual) ||
    !expected.some((item) => item.schema === "public") ||
    !actual.some((item) => item.schema === "public") ||
    actual.some(
      (item) =>
        !["public", "private"].includes(item.schema) ||
        JSON.stringify(item) !==
          JSON.stringify(expected.find((source) => source.schema === item.schema)),
    )
  )
    throw new Error(
      "Target retained schema owner or privileges differ; review the empty recovery target before restore",
    );
}
export function assertSchemaDefaults(expected, actual) {
  if (!Array.isArray(expected) || JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error(
      "Target schema default privileges differ; use a compatible platform target and review before restore",
    );
}
export const applicationDumpArgs = [
  "--format=custom",
  "--schema=public",
  "--schema=private",
  "--exclude-table-data=private.session_activity",
  "--encoding=UTF8",
];
export const portableSchemaSql =
  "CREATE SCHEMA IF NOT EXISTS public;\nCREATE SCHEMA IF NOT EXISTS private;\n";
export function portableRestoreList(contents) {
  // Filter archive entries, never SQL/COPY text that could resemble a privilege statement.
  return contents
    .split("\n")
    .map((line) =>
      /^\d+; \d+ \d+ SCHEMA - (public|private) \S+$/.test(line) ||
      /^\d+; \d+ \d+ DEFAULT ACL (public|private) DEFAULT PRIVILEGES FOR (TABLES|FUNCTIONS|SEQUENCES|TYPES|SCHEMAS) supabase_admin$/.test(
        line,
      )
        ? ";" + line
        : line,
    )
    .join("\n");
}
export async function applicationDump(env) {
  const archive = await runPg(pgBinary(env, "pg_dump"), applicationDumpArgs, env);
  const contents = (await runPg(pgBinary(env, "pg_restore"), ["--list"], env, archive)).toString();
  const directory = await mkdtemp(join(tmpdir(), "demolay-backup-toc-"));
  try {
    const list = join(directory, "restore.list");
    await writeFile(list, portableRestoreList(contents), { mode: 0o600 });
    return Buffer.concat([
      Buffer.from(portableSchemaSql),
      await runPg(
        pgBinary(env, "pg_restore"),
        ["--no-owner", "--use-list=" + list, "--file=-"],
        env,
        archive,
      ),
    ]);
  } finally {
    const target = resolve(directory),
      temporaryRoot = resolve(tmpdir()) + sep;
    if (
      !target.startsWith(temporaryRoot) ||
      !target.split(sep).at(-1).startsWith("demolay-backup-toc-")
    )
      throw new Error("Unsafe backup temporary directory");
    await rm(target, { recursive: true, force: true });
  }
}
export const backupStateSql = `select json_build_object(
  'schemaDefaults', (${schemaDefaultSql}),
  'schemaAccess', (${schemaAccessSql}),
  'audit', (select json_build_object('count',count(*)::text,'highwater',coalesce(max(id),0)::text) from private.audit),
  'identities', (${identitySql}),
  'roles', (${roleSql}),
  'storagePolicies', (${storagePolicySql}),
  'objects', (${storageSql}),
  'buckets', (select coalesce(json_agg(x order by x.id),'[]') from (select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('cms-originals','cms-derivatives','cms-public')) x),
  'media', (select coalesce(json_agg(to_jsonb(m)||jsonb_build_object('row_version',m.xmin::text) order by m.id),'[]') from private.media m),
  'receipts', (select coalesce(json_agg(x order by x.id),'[]') from (select id,original_path,derivative_path from private.upload_receipts) x)
)`;
export function backupCodeRevision(env) {
  if (!env.GITHUB_REPOSITORY && !env.GITHUB_SHA) return null;
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || "") ||
    !/^[a-f0-9]{40,64}$/.test(env.GITHUB_SHA || "")
  )
    throw new Error("Invalid backup application revision");
  return { repository: env.GITHUB_REPOSITORY, revision: env.GITHUB_SHA };
}
export function assertBackupState(state, before = state) {
  if (state.media.some((item) => ["promoting", "revoking"].includes(item.status)))
    throw new Error(
      "Backup capture has an unfinished media operation; resolve it and retry during a quiet period",
    );
  const objects = new Set(state.objects.map((item) => `${item.bucket_id}/${item.name}`));
  for (const item of [...state.receipts, ...state.media]) {
    const paths = [
      `cms-originals/${item.original_path}`,
      `cms-derivatives/${item.derivative_path}`,
    ];
    if (item.status === "ready") paths.push(`cms-public/${item.public_path}`);
    if (paths.some((path) => !objects.has(path)))
      throw new Error(
        "Backup capture has missing referenced media; repair storage before retrying",
      );
  }
  if (JSON.stringify(state) !== JSON.stringify(before))
    throw new Error("Backup source changed during capture; retry during a quiet period");
}
export async function captureConsistentBackup(env, capture, read = query) {
  const before = await read(backupStateSql, env);
  assertBackupState(before);
  const result = await capture(before);
  assertBackupState(await read(backupStateSql, env), before);
  return result;
}
export async function query(sql, env) {
  return JSON.parse(
    (
      await runPg(
        pgBinary(env, "psql"),
        ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env,
      )
    ).toString(),
  );
}
export function isMain(meta) {
  return process.argv[1] && meta === pathToFileURL(process.argv[1]).href;
}
export async function main(action) {
  try {
    await action();
  } catch (error) {
    // Only errors we construct may reach logs. JSON/crypto errors contain no payload, but do not expose them either.
    console.error(
      error.message.startsWith("Missing ") ||
        [
          "Backup capture has an unfinished media operation; resolve it and retry during a quiet period",
          "Backup capture has missing referenced media; repair storage before retrying",
          "Backup source changed during capture; retry during a quiet period",
        ].includes(error.message)
        ? error.message
        : "Backup operation failed. Check credentials, integrity, quotas and prerequisites privately.",
    );
    process.exitCode = 1;
  }
}
