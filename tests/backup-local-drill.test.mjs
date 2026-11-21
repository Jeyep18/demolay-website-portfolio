import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDisposable,
  identifier,
  roleStatements,
  identityStatements,
  defaultAclQuery,
  assertLocalDockerEndpoint,
  assertRecoveryPoint,
} from "../scripts/restore-local-drill.mjs";
import {
  runPg,
  roleSql,
  identitySql,
  schemaAccessSql,
  schemaDefaultSql,
  storagePolicySql,
  portableSchemaSql,
  portableRestoreList,
  applicationDumpArgs,
  sha,
} from "../scripts/backup-lib.mjs";
import { localDrill } from "../scripts/restore-local-drill.mjs";
import { randomBytes } from "node:crypto";

test("private recovery refuses remote Docker endpoints and relabeled old recovery indexes", () => {
  for (const endpoint of [
    "unix:///var/run/docker.sock",
    "npipe:////./pipe/dockerDesktopLinuxEngine",
  ])
    assertLocalDockerEndpoint(endpoint);
  for (const endpoint of [
    "tcp://127.0.0.1:2375",
    "ssh://server",
    "npipe:////server/pipe/docker",
    undefined,
  ])
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
  const newest = { id: "new", createdAt: "2026-10-18T15:00:00Z" };
  assertRecoveryPoint({ ...newest }, newest);
  assert.throws(() => assertRecoveryPoint({ ...newest, id: "old" }, newest));
  assert.throws(() =>
    assertRecoveryPoint({ ...newest, createdAt: "2026-10-17T15:00:00Z" }, newest),
  );
});

test("disposable guard rejects network, persistent mounts, ports and wrong identity", () => {
  const token = "a".repeat(24),
    name = "demolay-recovery-" + token;
  const info = {
    Name: "/" + name,
    Config: { Labels: { "org.demolay.recovery-drill": token } },
    HostConfig: { NetworkMode: "none", LogConfig: { Type: "none" }, PortBindings: {}, Binds: [] },
    Mounts: [{ Type: "tmpfs" }],
  };
  assertDisposable(info, name, token);
  for (const change of [
    { HostConfig: { ...info.HostConfig, NetworkMode: "bridge" } },
    { HostConfig: { ...info.HostConfig, LogConfig: { Type: "json-file" } } },
    { Mounts: [{ Type: "volume" }] },
    { HostConfig: { ...info.HostConfig, PortBindings: { "5432/tcp": [] } } },
    { Name: "/source" },
    { Config: { Labels: {} } },
  ])
    assert.throws(() => assertDisposable({ ...info, ...change }, name, token));
});
test("SQL quoting and default ACL parsing retain PostgreSQL as parser", () => {
  assert.equal(identifier('a"b'), '"a""b"');
  assert.throws(() => identifier("a\0b"));
  const sql = defaultAclQuery([
    { owner: 'a"b', schema: "public", kind: "r", acl: '{"quoted role"=r/owner}' },
  ]);
  assert.match(sql, /aclexplode/);
  assert.match(sql, /::aclitem\[\]/);
  assert.throws(() =>
    defaultAclQuery([{ owner: "postgres", schema: "auth", kind: "r", acl: "{}" }]),
  );
  assert.throws(() => roleStatements([{ rolname: "postgres", rolsuper: "false" }]));
});
test("identity provisioner rejects credentials and copies only approved identifiers", () => {
  const identity = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "fixture@example.invalid",
    identities: [{ provider: "google", provider_id: "fixture" }],
  };
  const sql = identityStatements([identity]);
  assert.doesNotMatch(sql, /encrypted_password|refresh_token|mfa|sessions/);
  assert.throws(() => identityStatements([{ ...identity, encrypted_password: "forbidden" }]));
  assert.throws(() =>
    identityStatements([
      { ...identity, identities: [{ ...identity.identities[0], token: "forbidden" }] },
    ]),
  );
});

test(
  "public local fixture restores in disposable cluster",
  { skip: process.env.RUN_LOCAL_RECOVERY_FIXTURE !== "true" },
  async () => {
    const source = "supabase_db_demolay-local-test";
    const docker = (args, input) => runPg("docker", args, process.env, input);
    const exec = (args, input) => docker(["exec", "-i", source, ...args], input);
    const query = async (sql) =>
      JSON.parse(
        (await exec(["psql", "-U", "postgres", "-d", "postgres", "-qAt", "-c", sql])).toString(),
      );
    const archive = await exec([
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      ...applicationDumpArgs,
    ]);
    const toc = portableRestoreList((await exec(["pg_restore", "--list"], archive)).toString());
    const path = "/tmp/demolay-drill-toc-" + randomBytes(12).toString("hex");
    try {
      await exec(["sh", "-c", 'umask 077; cat > "$1"', "toc", path], Buffer.from(toc));
      const dump = Buffer.concat([
        Buffer.from(portableSchemaSql),
        await exec(["pg_restore", "--no-owner", "--use-list=" + path, "--file=-"], archive),
      ]);
      const media = Buffer.from("Public disposable recovery fixture");
      const manifest = {
        roles: await query(roleSql),
        identities: await query(identitySql),
        schemaAccess: await query(schemaAccessSql),
        schemaDefaults: await query(schemaDefaultSql),
        database: { fileId: "fixture" },
        media: [
          { bucket: "cms-originals", path: "fixture.txt", fileId: "media", sha256: sha(media) },
        ],
        storagePolicies: (await query(storagePolicySql)).map((row) => row.sql).join("\n"),
      };
      const expected = await query(
        "select json_build_object('audit',(select count(*) from private.audit),'staff',(select count(*) from private.staff),'content',(select count(*) from private.content))",
      );
      const result = await localDrill({
        manifest,
        values: new Map([
          ["fixture", dump],
          ["media", media],
        ]),
      });
      for (const key of ["audit", "staff", "content"]) assert.equal(result[key], expected[key]);
      assert.equal(result.media, 1);
      assert.equal(result.sessions, 0);
      assert.equal(result.passwords, 0);
      assert.ok(result.snapshotKeys > 0);
    } finally {
      await exec(["rm", "--", path]);
    }
  },
);
