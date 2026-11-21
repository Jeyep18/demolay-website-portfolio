import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  runPg,
  driveClient,
  required,
  roleSql,
  identitySql,
  schemaAccessSql,
  schemaDefaultSql,
  storagePolicySql,
  assertSchemaAccess,
  assertSchemaDefaults,
  isMain,
  main,
  sha,
} from "./backup-lib.mjs";
import { recover, safePath, assertIdentityMapping } from "./restore.mjs";
import { checkStale } from "./backup-stale.mjs";

const IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.004";
const LABEL = "org.demolay.recovery-drill";
export function assertLocalDockerEndpoint(endpoint) {
  if (
    typeof endpoint !== "string" ||
    !/^(unix:\/\/\/[^\r\n\0]+|npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+)$/.test(endpoint)
  )
    throw new Error("Recovery requires a local Docker socket");
}
export function assertRecoveryPoint(manifest, newest) {
  if (manifest.id !== newest.id || manifest.createdAt !== newest.createdAt)
    throw new Error("Recovered index does not match the verified newest recovery point");
}
export const identifier = (value) => {
  if (typeof value !== "string" || !value || value.includes("\0"))
    throw new Error("Invalid SQL identifier");
  return '"' + value.replaceAll('"', '""') + '"';
};
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const docker = (args, input) => runPg("docker", args, process.env, input);
async function applicationSql(id, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        "PGHOST=/drill",
        id,
        "psql",
        "-Xq",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=sqlstate",
        "--single-transaction",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let diagnostic = "";
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.stderr.on("data", (data) => {
      if (diagnostic.length < 4096) diagnostic += data.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Application restore unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Application restore SQLSTATE " +
                (diagnostic.match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1] || "unknown"),
            ),
          );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export function assertDisposable(info, name, token) {
  if (
    !/^demolay-recovery-[a-f0-9]{24}$/.test(name) ||
    info.Name !== "/" + name ||
    info.Config.Labels?.[LABEL] !== token ||
    info.HostConfig.NetworkMode !== "none" ||
    info.HostConfig.LogConfig?.Type !== "none" ||
    Object.keys(info.HostConfig.PortBindings || {}).length ||
    info.Mounts.some((mount) => mount.Type !== "tmpfs") ||
    (info.HostConfig.Binds || []).length
  )
    throw new Error("Unsafe disposable recovery container");
}
export function roleStatements(roles) {
  const flags = {
    rolsuper: "SUPERUSER",
    rolinherit: "INHERIT",
    rolcreaterole: "CREATEROLE",
    rolcreatedb: "CREATEDB",
    rolcanlogin: "LOGIN",
    rolreplication: "REPLICATION",
    rolbypassrls: "BYPASSRLS",
  };
  if (!Array.isArray(roles) || !roles.some((r) => r.rolname === "postgres" && !r.rolsuper))
    throw new Error("Expected ordinary postgres role");
  // PostgreSQL serializes ACLs in role OID order; platform postgres predates API roles.
  return (
    [...roles]
      .sort((a, b) => Number(b.rolname === "postgres") - Number(a.rolname === "postgres"))
      .map((role) => {
        if (
          Object.keys(flags).some((key) => typeof role[key] !== "boolean") ||
          !Array.isArray(role.memberships)
        )
          throw new Error("Invalid role attributes");
        return (
          (role.rolname === "supabase_admin" ? "ALTER ROLE " : "CREATE ROLE ") +
          identifier(role.rolname) +
          " " +
          Object.entries(flags)
            .map(([key, flag]) => (role[key] ? "" : "NO") + flag)
            .join(" ") +
          ";"
        );
      })
      .join("\n") +
    "\n" +
    roles
      .flatMap((role) =>
        role.memberships.map(
          (parent) => `GRANT ${identifier(parent)} TO ${identifier(role.rolname)};`,
        ),
      )
      .join("\n")
  );
}
export function identityStatements(users) {
  return users
    .map((user) => {
      if (
        !/^[a-f0-9-]{36}$/i.test(user.id) ||
        typeof user.email !== "string" ||
        !Array.isArray(user.identities) ||
        Object.keys(user).some((key) => !["id", "email", "identities"].includes(key))
      )
        throw new Error("Invalid credential-free identity");
      return (
        `INSERT INTO auth.users(id,email) VALUES (${literal(user.id)},${literal(user.email)});\n` +
        user.identities
          .map((identity) => {
            if (
              typeof identity.provider !== "string" ||
              typeof identity.provider_id !== "string" ||
              Object.keys(identity).some((key) => !["provider", "provider_id"].includes(key))
            )
              throw new Error("Invalid provider identity");
            return `INSERT INTO auth.identities(id,user_id,provider,provider_id,identity_data) VALUES (gen_random_uuid(),${literal(user.id)},${literal(identity.provider)},${literal(identity.provider_id)},'{}');`;
          })
          .join("\n")
      );
    })
    .join("\n");
}
export function defaultAclQuery(defaults) {
  if (!Array.isArray(defaults)) throw new Error("Missing schema defaults");
  const kinds = { r: "TABLES", S: "SEQUENCES", f: "FUNCTIONS", T: "TYPES", n: "SCHEMAS" };
  return defaults
    .map((row) => {
      if (
        !kinds[row.kind] ||
        !["public", "private"].includes(row.schema) ||
        typeof row.acl !== "string"
      )
        throw new Error("Invalid default ACL");
      const prefix = `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(row.owner)} IN SCHEMA ${identifier(row.schema)}`;
      return `select format('%s GRANT %s ON %s TO %s%s;',${literal(prefix)},privilege_type,${literal(kinds[row.kind])},case when grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grantee)) end,case when is_grantable then ' WITH GRANT OPTION' else '' end) from aclexplode(${literal(row.acl)}::aclitem[]);`;
    })
    .join("\n");
}

export async function localDrill(recovery, source = "supabase_db_demolay-local-test") {
  if (source !== "supabase_db_demolay-local-test") throw new Error("Unapproved schema fixture");
  const endpoint =
    process.env.DOCKER_CONTEXT || !process.env.DOCKER_HOST
      ? JSON.parse(
          (
            await docker([
              "context",
              "inspect",
              ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
            ])
          ).toString(),
        )[0]?.Endpoints?.docker?.Host
      : process.env.DOCKER_HOST;
  assertLocalDockerEndpoint(endpoint);
  const { manifest, values } = recovery;
  const token = randomBytes(12).toString("hex"),
    name = "demolay-recovery-" + token;
  let id;
  let stage = "container initialization";
  const exec = (args, input) => docker(["exec", "-i", "-e", "PGHOST=/drill", id, ...args], input);
  const sql = (text, user = "supabase_admin") =>
    exec(
      [
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        "-U",
        user,
        "-d",
        "postgres",
      ],
      Buffer.from(text),
    );
  const query = async (text, user) => JSON.parse((await sql(text, user)).toString());
  const inspect = async () => {
    const info = JSON.parse((await docker(["inspect", id])).toString())[0];
    assertDisposable(info, name, token);
    return info;
  };
  try {
    id = (
      await docker([
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        `${LABEL}=${token}`,
        "--network",
        "none",
        "--log-driver=none",
        "--user",
        "100:101",
        "--tmpfs",
        "/drill:rw,noexec,nosuid,size=3g,uid=100,gid=101,mode=0700",
        "--entrypoint",
        "sh",
        IMAGE,
        "-c",
        "initdb -D /drill/db -U supabase_admin --auth=trust >/dev/null && exec postgres -D /drill/db -k /drill -c listen_addresses='' -c unix_socket_directories=/drill",
      ])
    )
      .toString()
      .trim();
    await inspect();
    await docker(["start", id]);
    // All psql access uses the private Unix socket; no TCP listener is started.
    const oldExec = exec;
    // docker exec needs the socket environment even though no host credentials are inherited.
    const ready = async () => oldExec(["pg_isready", "-h", "/drill", "-U", "supabase_admin"]);
    for (let attempt = 0; ; attempt++) {
      try {
        await ready();
        break;
      } catch {
        if (attempt === 29) throw new Error("Recovery database not ready");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await sql("select 1;");
    stage = "platform role provisioning";
    await sql(roleStatements(manifest.roles));
    await sql("ALTER DATABASE postgres OWNER TO postgres;");
    const archive = await docker([
      "exec",
      source,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--format=custom",
      "--schema-only",
      "--schema=auth",
      "--schema=storage",
      "--schema=extensions",
    ]);
    await exec(["sh", "-c", "cat > /drill/bootstrap.dump"], archive);
    const toc = (await exec(["pg_restore", "--list", "/drill/bootstrap.dump"]))
      .toString()
      .split("\n")
      .map((line) => (/\bPOLICY storage\b/.test(line) ? ";" + line : line))
      .join("\n");
    await exec(["sh", "-c", "cat > /drill/bootstrap.list"], Buffer.from(toc));
    const bootstrap = await exec([
      "pg_restore",
      "--file=-",
      "--use-list=/drill/bootstrap.list",
      "/drill/bootstrap.dump",
    ]);
    stage = "schema-only platform bootstrap";
    await sql(bootstrap.toString());
    stage = "schema ownership and ACL provisioning";
    await sql(
      "CREATE SCHEMA private;\n" +
        manifest.schemaAccess
          .map(
            (row) =>
              `ALTER SCHEMA ${identifier(row.schema)} OWNER TO ${identifier(row.owner)}; REVOKE ALL ON SCHEMA ${identifier(row.schema)} FROM PUBLIC;\n` +
              row.acl
                .map((acl) => {
                  if (
                    !["USAGE", "CREATE"].includes(acl.privilege) ||
                    typeof acl.grantable !== "boolean"
                  )
                    throw new Error("Invalid schema ACL");
                  return `SET ROLE ${identifier(acl.grantor)}; GRANT ${acl.privilege} ON SCHEMA ${identifier(row.schema)} TO ${acl.grantee === "PUBLIC" ? "PUBLIC" : identifier(acl.grantee)}${acl.grantable ? " WITH GRANT OPTION" : ""}; RESET ROLE;`;
                })
                .join("\n"),
          )
          .join("\n"),
    );
    const defaultGrants = await sql(defaultAclQuery(manifest.schemaDefaults));
    await sql(defaultGrants.toString());
    assertSchemaAccess(manifest.schemaAccess, await query(schemaAccessSql));
    const actualDefaults = await query(schemaDefaultSql);
    assertSchemaDefaults(manifest.schemaDefaults, actualDefaults);
    const actualRoles = await query(roleSql);
    if (JSON.stringify(actualRoles) !== JSON.stringify(manifest.roles))
      throw new Error("Role inventory differs");
    stage = "credential-free identity provisioning";
    await sql(identityStatements(manifest.identities));
    assertIdentityMapping(manifest.identities, await query(identitySql));
    stage = "ordinary-role application restore";
    await applicationSql(id, values.get(manifest.database.fileId));
    // Plain PostgreSQL lacks hosted Supabase's managed Storage administration.
    stage = "platform Storage policy provisioning";
    await sql(manifest.storagePolicies || "");
    if (
      (await query(storagePolicySql)).map((row) => row.sql).join("\n") !==
      (manifest.storagePolicies || "")
    )
      throw new Error("Storage policy inventory differs");
    stage = "recovery verification";
    for (const object of manifest.media) {
      const path = `/drill/media/${object.bucket}/${safePath(object.path)}`;
      if (!["cms-public", "cms-derivatives", "cms-originals"].includes(object.bucket))
        throw new Error("Invalid media bucket");
      await exec(["mkdir", "-p", path.slice(0, path.lastIndexOf("/"))]);
      // Positional shell argument prevents names from becoming shell code.
      await exec(["sh", "-c", 'cat > "$1"', "write-media", path], values.get(object.fileId));
      if (sha(await exec(["cat", path])) !== object.sha256)
        throw new Error("Media readback mismatch");
    }
    const mediaCount = Number(
      (
        await exec([
          "sh",
          "-c",
          "if [ -d /drill/media ]; then find /drill/media -type f | wc -l; else echo 0; fi",
        ])
      )
        .toString()
        .trim(),
    );
    if (mediaCount !== manifest.media.length) throw new Error("Media file count differs");
    assertSchemaAccess(manifest.schemaAccess, await query(schemaAccessSql));
    assertSchemaDefaults(manifest.schemaDefaults, await query(schemaDefaultSql));
    const counts = await query(
      `select json_build_object('audit',(select count(*) from private.audit),'staff',(select count(*) from private.staff),'content',(select count(*) from private.content),'sessions',(select count(*) from auth.sessions),'mfa',(select count(*) from auth.mfa_factors),'activity',(select count(*) from private.session_activity),'passwords',(select count(*) from auth.users where coalesce(encrypted_password,'')<>''),'unprotected',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and not c.relrowsecurity))`,
    );
    if (counts.sessions || counts.mfa || counts.activity || counts.passwords || counts.unprotected)
      throw new Error("Recovery isolation verification failed");
    const readable = await query(
      "select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))",
    );
    if (readable !== 0) throw new Error("Private table access grants are not isolated");
    const authTables = await query(
      "select coalesce(json_agg(tablename),'[]') from pg_tables where schemaname='auth' and tablename not in ('users','identities')",
    );
    for (const table of authTables)
      if (await query(`select count(*)::int from auth.${identifier(table)}`))
        throw new Error("Unexpected authentication state restored");
    for (const role of ["anon", "authenticated"]) {
      const tables = await query(
        "select coalesce(json_agg(tablename),'[]') from pg_tables where schemaname='private'",
      );
      for (const table of tables) {
        let denied = false;
        try {
          await sql(
            `SET ROLE ${identifier(role)}; SELECT * FROM private.${identifier(table)} LIMIT 1;`,
            "postgres",
          );
        } catch {
          denied = true;
        }
        if (!denied) throw new Error("Private table directly readable");
      }
    }
    const snapshot = await query("SET ROLE anon; select public.cms_public_snapshot();", "postgres");
    if (!snapshot || typeof snapshot !== "object") throw new Error("Public snapshot failed");
    await inspect();
    return { ...counts, media: manifest.media.length, snapshotKeys: Object.keys(snapshot).length };
  } catch (error) {
    const sqlstate = error.message.match(
      /^Application restore SQLSTATE ([A-Z0-9]{5}|unknown)$/,
    )?.[1];
    throw new Error(
      `Local recovery failed during ${stage}${sqlstate ? " (SQLSTATE " + sqlstate + ")" : ""}; source and container errors suppressed`,
    );
  } finally {
    if (id) {
      await inspect();
      await docker(["rm", "-f", id]);
    }
  }
}
if (isMain(import.meta.url))
  await main(async () => {
    const privateKey = await readFile(required(process.env, "RESTORE_PRIVATE_KEY_FILE"), "utf8");
    const indexKey = await readFile(required(process.env, "RESTORE_INDEX_KEY_FILE"), "utf8");
    const drive = await driveClient(process.env);
    const newest = await checkStale(drive, indexKey);
    const files = await drive.list();
    const index =
      files.find(
        (file) => file.appProperties.kind === "index" && file.appProperties.runId === newest.id,
      ) || files.find((file) => file.name === `${newest.id}-complete.json`);
    if (!index) throw new Error("Completed recovery index missing");
    const recovery = await recover(drive, index.id, privateKey, indexKey);
    assertRecoveryPoint(recovery.manifest, newest);
    const result = await localDrill(recovery);
    console.log(
      "Disposable local recovery passed; container removed. Counts:",
      JSON.stringify(result),
    );
  });
