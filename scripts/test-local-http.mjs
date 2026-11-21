// Real HTTP boundary tests. Fixtures impersonate local identities; they do not test Google or TOTP enrollment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { handleAdminApi } from "../src/server/admin-api.ts";
import worker from "../src/worker.ts";

const base = "http://127.0.0.1:54321";
const project = "demolay-local-test";
const docker =
  process.env.LOCAL_TEST_DOCKER ||
  "C:/Users/john2/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe";
if (process.env.CONFIRM_LOCAL_HTTP_TEST !== project)
  throw new Error(
    `Set CONFIRM_LOCAL_HTTP_TEST=${project}. This creates fictional records only in the dedicated local stack.`,
  );

function run(args, input) {
  const result = spawnSync(docker, args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  // Never echo Docker environment, SQL fixtures or signed credentials on failure.
  if (result.error || result.status !== 0)
    throw new Error("Local Docker operation failed. Check that the isolated stack is running.");
  return result.stdout;
}
for (const service of ["kong", "db"]) {
  const container = JSON.parse(run(["inspect", `supabase_${service}_${project}`]))[0];
  assert.equal(container.State.Running, true, `Start local ${service} first.`);
  const bindings = Object.values(container.NetworkSettings.Ports).flatMap((value) => value || []);
  assert.ok(
    bindings.length && bindings.every((value) => value.HostIp === "127.0.0.1"),
    "Local services must bind only to IPv4 loopback before fixtures are created.",
  );
}
const containerEnv = (service) =>
  Object.fromEntries(
    JSON.parse(run(["inspect", `supabase_${service}_${project}`]))[0].Config.Env.map((item) => {
      const at = item.indexOf("=");
      return [item.slice(0, at), item.slice(at + 1)];
    }),
  );
const authEnv = containerEnv("auth"),
  kongEnv = containerEnv("kong");
const secret = authEnv.GOTRUE_JWT_SECRET;
const gatewayConfig = run(["exec", `supabase_kong_${project}`, "cat", "/home/kong/kong.yml"]);
const anon =
  kongEnv.SUPABASE_ANON_KEY ??
  gatewayConfig.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)?.find((token) => {
    try {
      return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role === "anon";
    } catch {
      return false;
    }
  });
assert.ok(secret && anon, "Local signing configuration is unavailable.");
const sql = (query) =>
  run(
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
    ],
    query,
  );
assert.equal(sql("select current_database();").trim(), "postgres");
assert.equal(
  sql("select to_regprocedure('public.cms_session()') is not null;").trim(),
  "t",
  "Apply the CMS migration locally first.",
);

const now = Math.floor(Date.now() / 1000);
const sign = (claims) => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: `${base}/auth/v1`,
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
      ...claims,
    }),
  ).toString("base64url");
  return `${header}.${body}.${createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")}`;
};
const users = Object.fromEntries(
  ["owner", "editor", "suspended", "uninvited", "aal1"].map((role) => {
    const id = randomUUID(),
      session = randomUUID(),
      factor = randomUUID();
    return [
      role,
      {
        id,
        session,
        factor,
        email: `${role}-${id}@local-test.invalid`,
        aal: role === "aal1" ? "aal1" : "aal2",
      },
    ];
  }),
);
for (const [role, user] of Object.entries(users)) {
  sql(`begin;
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmation_token,recovery_token,email_change_token_new,email_change,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('${user.id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${user.email}','','','','','',now(),'{"provider":"google","providers":["google"]}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at,aal) values('${user.session}','${user.id}',now(),now(),'${user.aal}');
    ${user.aal === "aal2" ? `insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values('${user.factor}','${user.id}','Local fixture','totp','verified','',now(),now());` : ""}
    ${role !== "uninvited" ? `insert into private.staff(email,user_id,role,active) values('${user.email}','${user.id}','${role === "owner" ? "owner" : "editor"}',${role !== "suspended"});` : ""}
    commit;`);
  user.token = sign({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    session_id: user.session,
    aal: user.aal,
    is_anonymous: false,
    app_metadata: { provider: "google", providers: ["google"] },
    amr: [
      { method: "oauth", timestamp: now },
      ...(user.aal === "aal2" ? [{ method: "totp", timestamp: now }] : []),
    ],
  });
}
let assertions = 0;
async function call(path, user, body, extra = {}) {
  const target = new URL(path, base);
  assert.equal(target.origin, base, "Tests must never contact a hosted project.");
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${user?.token || anon}`,
    ...extra.headers,
  };
  if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob))
    headers["Content-Type"] = "application/json";
  const response = await fetch(target, {
    method: body === undefined ? "GET" : "POST",
    ...extra,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData || body instanceof Blob
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
    redirect: "manual",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data, headers: response.headers };
}
const rpc = (name, user, body = {}) => call(`/rest/v1/rpc/${name}`, user, body);
function status(result, expected, label) {
  assert.equal(
    result.status,
    expected,
    `${label}${result.status !== expected ? ` (${result.data?.error_code || result.data?.code || ""}: ${result.data?.msg || result.data?.message || (typeof result.data?.error === "string" ? result.data.error : "")})` : ""}`,
  );
  assertions++;
  return result.data;
}
function denied(result, label) {
  assert.ok(
    [400, 401, 403, 404].includes(result.status),
    `${label}: expected denial, got ${result.status}`,
  );
  assertions++;
}
const article = {
  date: "2026-10-16",
  kicker: "Isolated test",
  excerpt: "Fictional security test record.",
  body: ["Only for the local authorization harness."],
};
const save = (user, overrides = {}) =>
  rpc("cms_save", user, {
    p_id: null,
    p_kind: "article",
    p_slug: `local-test-${randomUUID()}`,
    p_title: "Local test draft",
    p_payload: article,
    p_media_ids: [],
    p_expected_version: null,
    ...overrides,
  });
const transition = (user, row, action) =>
  rpc("cms_transition", user, {
    p_id: row.id,
    p_expected_version: row.version,
    p_action: action,
    p_reason: "Isolated HTTP verification",
  });

for (const role of ["owner", "editor", "suspended", "uninvited", "aal1"])
  status(
    await call("/auth/v1/user", users[role]),
    200,
    `GoTrue recognizes isolated ${role} fixture`,
  );
status(await rpc("cms_public_snapshot"), 200, "Anonymous public snapshot");
denied(await rpc("cms_list"), "Anonymous drafts");
for (const role of ["suspended", "uninvited"]) {
  denied(await rpc("cms_session", users[role]), `${role} session`);
  denied(await rpc("cms_list", users[role]), `${role} drafts`);
  denied(await save(users[role]), `${role} mutation`);
}
status(await rpc("cms_session", users.aal1), 200, "AAL1 onboarding session");
denied(await rpc("cms_list", users.aal1), "AAL1 drafts");
denied(await save(users.aal1), "AAL1 mutation");
denied(await rpc("cms_staff_list", users.editor), "Editor staff listing");
denied(
  await rpc("cms_staff_save", users.editor, {
    p_email: users.editor.email,
    p_role: "owner",
    p_active: true,
  }),
  "Editor role escalation",
);
denied(await call("/rest/v1/staff?select=*", users.owner), "Private staff table not exposed");
denied(await call("/rest/v1/content?select=*", users.owner), "Private draft table not exposed");
denied(
  await rpc("cms_media_upload_ready", users.owner, {
    p_id: randomUUID(),
    p_user_id: users.owner.id,
    p_original_path: "forged",
    p_derivative_path: "forged",
    p_width: 1,
    p_height: 1,
  }),
  "Owner cannot forge service upload receipt",
);

let row = status(await save(users.editor), 200, "Editor saves draft");
const id = row.id;
assert.ok(
  !(await rpc("cms_public_snapshot")).data.content.some((item) => item.id === id),
  "Draft absent from anonymous snapshot",
);
assertions++;
status(await rpc("cms_content_get", users.editor, { p_id: id }), 200, "Authorized draft retrieval");
denied(
  await rpc("cms_content_get", users.uninvited, { p_id: id }),
  "Record substitution does not bypass membership",
);
const stale = row.version;
row = status(
  await save(users.editor, {
    p_id: id,
    p_slug: row.slug,
    p_expected_version: row.version,
    p_title: "Updated local draft",
  }),
  200,
  "Editor updates draft",
);
const conflict = status(
  await save(users.editor, { p_id: id, p_slug: row.slug, p_expected_version: stale }),
  409,
  "PostgREST reports business conflict without serialization retries",
);
assert.equal(conflict.code, "PT409");
assertions++;
denied(
  await save(users.editor, { p_payload: { ...article, body: ["<script>alert(1)</script>"] } }),
  "Stored HTML rejected directly in database",
);
row = status(await transition(users.editor, row, "submit"), 200, "Editor requests approval");
denied(await transition(users.editor, row, "publish"), "Editor publication denied");
row = status(
  await transition(users.owner, row, "publish"),
  200,
  "Owner publishes reviewed revision",
);
assert.ok(
  (await rpc("cms_public_snapshot")).data.content.some((item) => item.id === id),
  "Published revision visible",
);
assertions++;
row = status(
  await save(users.editor, {
    p_id: id,
    p_slug: row.slug,
    p_expected_version: row.version,
    p_title: "Unpublished replacement",
  }),
  200,
  "Replacement stays draft",
);
assert.equal(
  (await rpc("cms_public_snapshot")).data.content.find((item) => item.id === id).title,
  "Updated local draft",
);
assertions++;
row = status(await transition(users.owner, row, "archive"), 200, "Owner archives publication");
assert.ok(!(await rpc("cms_public_snapshot")).data.content.some((item) => item.id === id));
assertions++;

// A valid, unexpired token must lose access immediately after suspension or server-side session revocation.
sql(`update private.staff set active=false where email='${users.editor.email}';`);
denied(await rpc("cms_list", users.editor), "Suspension blocks existing JWT");
sql(
  `update private.staff set active=true where email='${users.editor.email}'; delete from auth.sessions where id='${users.editor.session}';`,
);
denied(await rpc("cms_list", users.editor), "Session revocation blocks existing JWT");

for (const role of [null, "uninvited", "suspended", "aal1", "owner"]) {
  const user = role ? users[role] : null;
  denied(
    await call(
      "/storage/v1/object/cms-public/forged.webp",
      user,
      new Blob(["not an image"], { type: "image/webp" }),
    ),
    `${role || "anonymous"} direct public upload`,
  );
  const listing = await call("/storage/v1/object/list/cms-originals", user, {
    prefix: "",
    limit: 10,
    offset: 0,
  });
  if (listing.status === 200) {
    assert.deepEqual(listing.data, [], `${role || "anonymous"} original listing is empty`);
    assertions++;
  } else denied(listing, `${role || "anonymous"} original listing`);
}
for (const role of [null, "uninvited", "suspended", "aal1"])
  denied(
    await call("/functions/v1/cms-images", role ? users[role] : null, {
      action: "promote",
      contentId: id,
      expectedVersion: row.version,
    }),
    `${role || "anonymous"} direct Edge promotion`,
  );
const malformed = new FormData();
malformed.set("file", new Blob(["<html>disguised</html>"], { type: "image/png" }), "fake.png");
malformed.set("alt", "Local test");
malformed.set("caption", "");
malformed.set("rightsConfirmed", "true");
status(
  await call("/functions/v1/cms-images", users.owner, malformed),
  400,
  "Disguised upload through real function",
);

// A tiny RGB PNG generated in memory exercises the actual deployed WASM decoder and storage pipeline.
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(2, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 0, 255, 0]))),
  chunk("IEND", Buffer.alloc(0)),
]);
function imageForm(bytes = png, rights = "true") {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/png" }), "local-test.png");
  form.set("alt", "Fictional local test red and green pixels");
  form.set("caption", "Isolated test");
  form.set("rightsConfirmed", rights);
  return form;
}
status(
  await call("/functions/v1/cms-images", users.owner, imageForm(png, "false")),
  400,
  "Rights confirmation required by real function",
);
const oversized = status(
  await call("/functions/v1/cms-images", users.owner, imageForm(Buffer.alloc(5 * 1024 * 1024 + 1))),
  400,
  "Oversized upload rejected by real function",
);
assert.match(oversized.error, /at most 5 MiB/);
assertions++;
const media = status(
  await call("/functions/v1/cms-images", users.owner, imageForm()),
  201,
  "Real PNG is decoded and private derivative registered",
);
denied(
  await call(
    `/storage/v1/object/cms-originals/${users.owner.id}/${media.id}.original`,
    users.owner,
  ),
  "Even owner cannot directly download original",
);
let illustrated = status(
  await save(users.owner, { p_media_ids: [media.id] }),
  200,
  "Image attached to draft",
);
illustrated = status(
  await transition(users.owner, illustrated, "submit"),
  200,
  "Illustrated revision submitted",
);
status(
  await call("/functions/v1/cms-images", users.owner, {
    action: "promote",
    contentId: illustrated.id,
    expectedVersion: illustrated.version,
  }),
  200,
  "Owner promotes exact reviewed media revision",
);
illustrated = status(
  await transition(users.owner, illustrated, "publish"),
  200,
  "Illustrated revision published",
);
status(
  await call(`/storage/v1/object/public/cms-public/${media.id}.webp`),
  200,
  "Approved derivative is publicly available",
);
illustrated = status(
  await transition(users.owner, illustrated, "archive"),
  200,
  "Illustrated publication archived",
);
status(
  await call("/functions/v1/cms-images", users.owner, {
    action: "retire",
    contentId: illustrated.id,
  }),
  200,
  "Archived public derivative retired through real function",
);
denied(
  await call(`/storage/v1/object/public/cms-public/${media.id}.webp`),
  "Retired derivative removed from origin",
);

const appSecret = randomUUID() + randomUUID();
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handleAdminApi(
      new Request(`${origin}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
      {
        SUPABASE_URL: base,
        SUPABASE_PUBLISHABLE_KEY: anon,
        APP_ORIGIN: origin,
        SESSION_SECRET: appSecret,
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Local test server failed");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
function appCookies(user, staleMfa = false) {
  const window = `${now}.${now}`;
  const session = {
    access_token: staleMfa
      ? sign({
          sub: user.id,
          role: "authenticated",
          email: user.email,
          session_id: user.session,
          aal: "aal2",
          is_anonymous: false,
          amr: [{ method: "totp", timestamp: now - 601 }],
        })
      : user.token,
    refresh_token: "isolated-local-fixture",
    expires_at: now + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: user.id },
  };
  return `demolay-auth=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}; demolay-window=${window}.${createHmac("sha256", appSecret).update(window).digest("hex")}; demolay-csrf=${"a".repeat(64)}`;
}
try {
  const stagingEnv = {
    SUPABASE_URL: base,
    SUPABASE_PUBLISHABLE_KEY: anon,
    APP_ORIGIN: origin,
    SESSION_SECRET: appSecret,
    STAGING_REQUIRE_STAFF: "true",
    ASSETS: {
      fetch: async () =>
        new Response("Private staging page", { headers: { "Content-Type": "text/html" } }),
    },
  };
  for (const user of [users.aal1, users.suspended]) {
    const response = await worker.fetch(
      new Request(origin + "/", { headers: { cookie: appCookies(user) } }),
      stagingEnv,
    );
    status(response, 303, "Staging denies non-MFA and suspended sessions");
  }
  const stage = await worker.fetch(
    new Request(origin + "/", { headers: { cookie: appCookies(users.owner) } }),
    stagingEnv,
  );
  status(stage, 200, "Staging accepts a live MFA owner session");
  assert.match(stage.headers.get("cache-control"), /no-store/);
  assertions++;
  assert.ok(stage.headers.getSetCookie().length > 0);
  assertions++;
  const bff = async (path, user, body, headers = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(user ? { cookie: appCookies(user) } : {}),
        ...(body
          ? { "content-type": "application/json", origin, "X-CSRF-Token": "a".repeat(64) }
          : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  };
  status(await bff("/api/admin/content", null), 401, "Anonymous BFF rejection");
  const session = await bff("/api/admin/session", users.owner);
  status(session, 200, "BFF validates real GoTrue session and database membership");
  assert.match(session.headers.get("cache-control"), /no-store/);
  assertions++;
  status(await bff("/api/admin/content", users.aal1), 403, "BFF blocks AAL1 draft access");
  status(await bff("/api/admin/content", users.suspended), 403, "BFF blocks suspended identity");
  status(
    await bff(
      "/api/admin/content",
      users.owner,
      {
        kind: "article",
        slug: `bff-${randomUUID()}`,
        title: "Local BFF test",
        payload: article,
        mediaIds: [],
      },
      { origin: "https://attacker.invalid" },
    ),
    403,
    "Cross-site mutation rejection",
  );
  status(
    await bff(
      "/api/admin/content",
      users.owner,
      {
        kind: "article",
        slug: `bff-${randomUUID()}`,
        title: "Local BFF test",
        payload: article,
        mediaIds: [],
      },
      { "X-CSRF-Token": "wrong" },
    ),
    403,
    "CSRF token rejection",
  );
  status(
    await bff(
      "/api/admin/staff",
      users.owner,
      { email: `new-${randomUUID()}@local-test.invalid`, role: "editor", active: true },
      { cookie: appCookies(users.owner, true) },
    ),
    403,
    "Stale MFA rejects sensitive BFF mutation",
  );
  status(
    await bff("/api/admin/content", users.owner, {
      kind: "article",
      slug: `bff-${randomUUID()}`,
      title: "Local BFF test",
      payload: article,
      mediaIds: [],
    }),
    200,
    "Authorized BFF draft save",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `PASS: ${assertions} actual local HTTP boundary checks. Local fixtures remain for inspection. Google sign-in and TOTP enrollment were not simulated as proof.`,
);
