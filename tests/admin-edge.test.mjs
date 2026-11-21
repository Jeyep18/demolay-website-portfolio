import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { dispatchAdmin, handleAdminEdge, handleEdgeRate } from "../src/server/admin-edge.ts";
import { handleAdminApi } from "../src/server/admin-api.ts";

const origin = "https://chapter.example";
const upstream = "https://example.supabase.co/functions/v1/cms-admin";
const rateUrl = origin + "/api/internal/admin-edge-rate";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const gateway = (role) => `${encode({ alg: "HS256" })}.${encode({ role })}.fixture`;
const config = () => ({
  APP_ORIGIN: origin,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: gateway("anon"),
  SESSION_SECRET: "session-fixture-".repeat(4),
  ADMIN_EDGE_SECRET: "bridge-fixture-".repeat(4),
  ADMIN_API_MODE: "edge",
  AUTH_LIMITER: { limit: async () => ({ success: true }) },
});
const browserRequest = (path = "/api/admin/content?kind=article", body) =>
  new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: "fixture=private",
      origin,
      "x-csrf-token": "c".repeat(64),
      "content-type": "application/json",
      "CF-Connecting-IP": "192.0.2.1",
      "x-demolay-proof": "client-forged",
      "x-demolay-ip": "192.0.2.99",
      Authorization: "Bearer client-forged",
    },
    ...(body === undefined ? {} : { body }),
  });
async function envelope(request = browserRequest(), env = config()) {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (input) => {
    captured = input.clone();
    return Response.json({});
  };
  try {
    assert.equal((await dispatchAdmin(request, env)).status, 200);
    return captured;
  } finally {
    globalThis.fetch = original;
  }
}
async function withRoutes(env, handler, work, callback) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    calls.push(request.url);
    assert.equal(options?.redirect, "manual");
    if (request.url === upstream) return handleAdminEdge(request, env, handler);
    assert.equal(request.url, rateUrl);
    // Cloudflare supplies its own connecting IP; the signed original IP must remain authoritative.
    const headers = new Headers(request.headers);
    headers.set("CF-Connecting-IP", "198.51.100.20");
    return callback
      ? callback(new Request(request, { headers }))
      : handleEdgeRate(new Request(request, { headers }), env);
  };
  try {
    await work(calls);
  } finally {
    globalThis.fetch = original;
  }
}
function signedFixture(
  env,
  {
    path = "/api/admin/content",
    timestamp = Math.floor(Date.now() / 1000),
    body = "",
    scope = "api",
  } = {},
) {
  const headers = new Headers({
    "x-demolay-url": origin + path,
    "x-demolay-ip": "192.0.2.1",
    "x-demolay-time": String(timestamp),
  });
  const digest = createHash("sha256").update(body).digest("hex");
  headers.set("x-demolay-digest", digest);
  headers.set(
    "x-demolay-proof",
    createHmac("sha256", env.ADMIN_EDGE_SECRET)
      .update(
        JSON.stringify([
          scope,
          "POST",
          origin + path,
          "192.0.2.1",
          String(timestamp),
          "",
          "",
          "",
          "",
          digest,
        ]),
      )
      .digest("hex"),
  );
  return new Request(upstream, { method: "POST", headers, ...(body ? { body } : {}) });
}

test("Edge forwarding preserves original request and all cookies without forwarding client proof or authorization", async () => {
  const env = config();
  const quotas = [];
  let received = 0;
  env.AUTH_LIMITER = {
    limit: async ({ key }) => {
      quotas.push(key);
      return { success: true };
    },
  };
  await withRoutes(
    env,
    async (request, backendEnv) => {
      received++;
      assert.equal(request.url, origin + "/api/admin/content?kind=article");
      assert.equal(request.headers.get("cookie"), "fixture=private");
      assert.equal(request.headers.get("origin"), origin);
      assert.equal(request.headers.get("x-csrf-token"), "c".repeat(64));
      assert.equal(request.headers.get("CF-Connecting-IP"), "192.0.2.1");
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("x-demolay-proof"), null);
      assert.equal(await request.text(), '{"draft":"local"}');
      assert.equal((await backendEnv.AUTH_LIMITER.limit({ key: "unused" })).success, true);
      const headers = new Headers({ Location: "https://accounts.google.com/fixture" });
      headers.append("Set-Cookie", "first=one; HttpOnly; Secure; Path=/");
      headers.append("Set-Cookie", "second=two; HttpOnly; Secure; Path=/");
      return new Response(null, { status: 303, headers });
    },
    async (calls) => {
      const response = await dispatchAdmin(browserRequest(undefined, '{"draft":"local"}'), env);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://accounts.google.com/fixture");
      assert.equal(response.headers.getSetCookie().length, 2);
      assert.deepEqual(calls, [upstream, rateUrl]);
    },
  );
  assert.equal(received, 1);
  assert.equal(quotas.length, 2);
  assert.equal(quotas[1], "edge:" + quotas[0]);
});

test("a replayed valid envelope still consumes shared Edge callback quota on every invocation", async () => {
  const env = config();
  const proof = await envelope();
  let count = 0,
    handled = 0;
  env.AUTH_LIMITER = {
    limit: async ({ key }) => ({ success: !key.startsWith("edge:") || ++count <= 2 }),
  };
  await withRoutes(
    env,
    async () => {
      handled++;
      return Response.json({});
    },
    async () => {
      for (const expected of [200, 200, 429])
        assert.equal(
          (
            await handleAdminEdge(proof.clone(), env, async () => {
              handled++;
              return Response.json({});
            })
          ).status,
          expected,
        );
    },
  );
  assert.equal(count, 3);
  assert.equal(handled, 2);
});

test("signed fields and content cannot be changed, and invalid proof rejects before reading the body", async () => {
  const env = config();
  const proof = await envelope(browserRequest(undefined, "fixture"));
  let handled = 0;
  const mutations = [
    ["cookie", "different"],
    ["origin", "https://other.example"],
    ["x-csrf-token", "different"],
    ["content-type", "text/plain"],
    ["x-demolay-url", origin + "/api/admin/staff"],
    ["x-demolay-ip", "192.0.2.2"],
    ["x-demolay-digest", "0".repeat(64)],
  ];
  for (const [name, value] of mutations) {
    const headers = new Headers(proof.headers);
    headers.set(name, value);
    assert.equal(
      (
        await handleAdminEdge(new Request(proof.clone(), { headers }), env, async () => {
          handled++;
          return Response.json({});
        })
      ).status,
      403,
      name,
    );
  }
  assert.equal(
    (
      await handleAdminEdge(
        new Request(proof.url, { method: "POST", headers: proof.headers, body: "tampered" }),
        env,
        async () => {
          handled++;
          return Response.json({});
        },
      )
    ).status,
    403,
  );
  const headers = new Headers(proof.headers);
  headers.set("x-demolay-proof", "0".repeat(64));
  const invalid = new Request(proof.clone(), { headers });
  Object.defineProperty(invalid, "body", {
    get() {
      throw Error("Body must not be read for invalid proof");
    },
  });
  assert.equal(
    (
      await handleAdminEdge(invalid, env, async () => {
        handled++;
        return Response.json({});
      })
    ).status,
    403,
  );
  assert.equal(handled, 0);
});

test("expired, future, cross-scope and foreign-origin proofs fail closed", async () => {
  const env = config();
  let handled = 0;
  for (const options of [
    { timestamp: Math.floor(Date.now() / 1000) - 31 },
    { timestamp: Math.floor(Date.now() / 1000) + 6 },
    { scope: "rate" },
  ]) {
    assert.equal(
      (
        await handleAdminEdge(signedFixture(env, options), env, async () => {
          handled++;
          return Response.json({});
        })
      ).status,
      403,
    );
  }
  const foreign = signedFixture(env);
  foreign.headers.set("x-demolay-url", "https://foreign.example/api/admin/content");
  assert.equal(
    (
      await handleAdminEdge(foreign, env, async () => {
        handled++;
        return Response.json({});
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await handleEdgeRate(
        signedFixture(env, { path: "/api/internal/admin-edge-rate?x=1", scope: "rate" }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(handled, 0);
});

test("backend never runs when the mandatory rate callback fails, redirects or returns an unexpected success status", async () => {
  const env = config();
  const proof = await envelope();
  let handled = 0;
  for (const [callback, status] of [
    [
      async () => {
        throw Error("timeout");
      },
      503,
    ],
    [
      async () =>
        new Response(null, { status: 303, headers: { Location: "https://other.example" } }),
      503,
    ],
    [async () => Response.json({ success: true }, { status: 201 }), 503],
    [async () => Response.json({ success: false }), 503],
    [async () => Response.json({ success: false }, { status: 429 }), 429],
  ])
    await withRoutes(
      env,
      async () => Response.json({}),
      async () => {
        assert.equal(
          (
            await handleAdminEdge(proof.clone(), env, async () => {
              handled++;
              return Response.json({});
            })
          ).status,
          status,
        );
      },
      callback,
    );
  assert.equal(handled, 0);
});

test("proxy configuration, caller origin, gateway role and request bounds fail closed", async () => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    throw Error("Unexpected upstream call");
  };
  try {
    for (const patch of [
      { ADMIN_API_MODE: "unknown" },
      { ADMIN_EDGE_SECRET: "short" },
      { AUTH_LIMITER: undefined },
      { SUPABASE_URL: "https://foreign.example" },
      { SUPABASE_GATEWAY_JWT: gateway("service_role") },
    ]) {
      assert.equal((await dispatchAdmin(browserRequest(), { ...config(), ...patch })).status, 503);
    }
    assert.equal(
      (await dispatchAdmin(new Request("https://foreign.example/api/admin/content"), config()))
        .status,
      403,
    );
    assert.equal(
      (
        await dispatchAdmin(browserRequest(), {
          ...config(),
          AUTH_LIMITER: { limit: async () => ({ success: false }) },
        })
      ).status,
      429,
    );
    assert.equal(
      (await dispatchAdmin(browserRequest(undefined, "x".repeat(256 * 1024 + 1)), config())).status,
      413,
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    assert.equal(
      (
        await dispatchAdmin(
          new Request(origin + "/api/admin/content", {
            method: "POST",
            body: stream,
            duplex: "half",
          }),
          config(),
        )
      ).status,
      413,
    );
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("the original BFF still rejects database authorization and CSRF failures through the adapter", async () => {
  const env = config(),
    now = Math.floor(Date.now() / 1000);
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "editor@example.test" };
  const session = {
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: now + 3600 })}.fixture`,
    refresh_token: "fixture",
    expires_at: now + 3600,
    user,
  };
  const value = `${now}.${now}`;
  const cookie = `__Host-demolay-auth=base64-${encode(session)}; __Host-demolay-window=${value}.${createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex")}; __Host-demolay-csrf=${"c".repeat(64)}`;
  const original = globalThis.fetch;
  let providerCalls = [];
  globalThis.fetch = async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    const path = new URL(request.url).pathname;
    if (request.url === upstream) return handleAdminEdge(request, env, handleAdminApi);
    if (request.url === rateUrl) return handleEdgeRate(request, env);
    providerCalls.push(path);
    if (path === "/auth/v1/user") return Response.json(user);
    if (path === "/rest/v1/rpc/cms_session")
      return Response.json({ active: true, aal: "aal2", role: "editor" });
    assert.equal(path, "/rest/v1/rpc/cms_list");
    return Response.json({ code: "42501" }, { status: 403 });
  };
  try {
    const read = new Request(origin + "/api/admin/content", { headers: { cookie } });
    const response = await dispatchAdmin(read, env);
    assert.equal(response.status, 403);
    assert.deepEqual(providerCalls, ["/auth/v1/user", "/rest/v1/rpc/cms_list"]);
    assert.equal(
      response.headers.getSetCookie().some((value) => value.startsWith("__Host-demolay-window=")),
      false,
    );
    providerCalls = [];
    const save = new Request(origin + "/api/admin/content", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://foreign.example",
        "content-type": "application/json",
        "x-csrf-token": "c".repeat(64),
      },
      body: "{}",
    });
    assert.equal((await dispatchAdmin(save, env)).status, 403);
    assert.deepEqual(providerCalls, ["/auth/v1/user", "/rest/v1/rpc/cms_session"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("the Worker and Edge adapter preserve OAuth, MFA, staging, refresh cookies and logout", async () => {
  const { default: worker } = await import("../src/worker.ts");
  const env = config(),
    now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "editor@example.test",
    factors: [],
  };
  const factor = "00000000-0000-4000-8000-000000000002";
  let aal = "aal1",
    assets = 0,
    refreshes = 0;
  const session = (expiry = now + 3600) => ({
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: expiry, aal })}.fixture`,
    refresh_token: "local-refresh-fixture",
    expires_at: expiry,
    expires_in: 3600,
    token_type: "bearer",
    user,
  });
  const workerEnv = {
    ...env,
    STAGING_REQUIRE_STAFF: "true",
    RELEASE_APPROVED: "false",
    ASSETS: {
      fetch: async () => {
        assets++;
        return new Response("protected page", { headers: { "Content-Type": "text/html" } });
      },
    },
  };
  const jar = new Map();
  const providerCalls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    const url = new URL(request.url);
    if (request.url === upstream) {
      assert.equal(request.headers.get("Authorization"), `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`);
      assert.equal(options.redirect, "manual");
      return handleAdminEdge(request, env, handleAdminApi);
    }
    if (request.url === rateUrl) {
      assert.equal(options.redirect, "manual");
      return worker.fetch(request, workerEnv);
    }
    assert.equal(url.origin, env.SUPABASE_URL);
    providerCalls.push(url.pathname);
    if (url.pathname === "/auth/v1/token") {
      const body = await request.json();
      if (url.searchParams.get("grant_type") === "pkce") {
        assert.equal(body.auth_code, "local-code-fixture");
        assert.ok(body.code_verifier.length > 20);
      } else {
        assert.equal(url.searchParams.get("grant_type"), "refresh_token");
        assert.equal(body.refresh_token, "local-refresh-fixture");
        refreshes++;
      }
      return Response.json(session());
    }
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    if (url.pathname === "/rest/v1/rpc/cms_session")
      return Response.json({ active: true, aal, role: "editor" });
    if (url.pathname === "/auth/v1/factors") {
      assert.equal(request.method, "POST");
      user.factors = [{ id: factor, factor_type: "totp", status: "unverified" }];
      return Response.json({
        id: factor,
        type: "totp",
        totp: {
          qr_code: "synthetic-local-qr",
          secret: "synthetic-local-key",
          uri: "otpauth://synthetic",
        },
      });
    }
    if (url.pathname === `/auth/v1/factors/${factor}/challenge`)
      return Response.json({ id: "challenge-fixture", expires_at: now + 60 });
    if (url.pathname === `/auth/v1/factors/${factor}/verify`) {
      const body = await request.json();
      assert.equal(body.challenge_id, "challenge-fixture");
      assert.equal(body.code, "123456");
      aal = "aal2";
      user.factors[0].status = "verified";
      return Response.json(session());
    }
    assert.equal(url.pathname, "/auth/v1/logout");
    return new Response(null, { status: 204 });
  };
  async function visit(path, body) {
    const response = await worker.fetch(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
          origin,
          "x-csrf-token": decodeURIComponent(jar.get("__Host-demolay-csrf") ?? ""),
          "content-type": "application/json",
          "CF-Connecting-IP": "192.0.2.1",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      workerEnv,
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        at = pair.indexOf("="),
        name = pair.slice(0, at);
      if (/Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
      else jar.set(name, pair.slice(at + 1));
    }
    return response;
  }
  try {
    const google = await visit("/api/auth/google");
    assert.equal(google.status, 302);
    const destination = new URL(google.headers.get("location"));
    assert.equal(destination.origin, env.SUPABASE_URL);
    assert.equal(destination.searchParams.get("provider"), "google");
    assert.equal(destination.searchParams.get("redirect_to"), origin + "/api/auth/callback");
    assert.ok([...jar.keys()].some((name) => name.includes("code-verifier")));
    const callback = await visit("/api/auth/callback?code=local-code-fixture");
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), origin + "/admin");
    assert.ok(jar.has("__Host-demolay-window"));
    assert.ok(jar.has("__Host-demolay-csrf"));
    assert.equal((await visit("/chapter")).status, 303, "AAL1 cannot open protected pages");
    assert.equal(assets, 0);
    assert.equal((await visit("/api/auth/mfa")).status, 200);
    assert.equal((await visit("/api/auth/mfa/enroll", {})).status, 200);
    const verified = await visit("/api/auth/mfa/verify", { factorId: factor, code: "123456" });
    assert.equal(verified.status, 200);
    assert.ok(
      verified.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-demolay-auth=")),
    );
    const page = await visit("/chapter");
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "protected page");
    assert.equal(assets, 1);
    assert.match(page.headers.get("cache-control"), /no-store/);
    assert.ok(
      page.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-demolay-window=")),
    );
    for (const name of jar.keys()) if (name.startsWith("__Host-demolay-auth")) jar.delete(name);
    jar.set("__Host-demolay-auth", `base64-${encode(session(now - 60))}`);
    const refreshed = await visit("/api/admin/session");
    assert.equal(refreshed.status, 200);
    assert.equal(refreshes, 1);
    assert.ok(
      refreshed.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-demolay-auth=")),
    );
    const logout = await visit("/api/auth/logout", {});
    assert.equal(logout.status, 200);
    assert.ok(providerCalls.includes("/auth/v1/logout"));
    assert.equal(jar.has("__Host-demolay-window"), false);
    assert.equal(jar.has("__Host-demolay-csrf"), false);
    assert.equal(
      [...jar.keys()].some((name) => name.startsWith("__Host-demolay-auth")),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
