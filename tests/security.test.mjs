import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import {
  validMutation,
  boundedJson,
  handleAdminApi,
  cookiesFrom,
} from "../src/server/admin-api.ts";
import { readPublicSnapshot, snapshotSchema } from "../src/lib/public-snapshot.ts";
import { termSummary } from "../src/lib/finance.ts";
import { saveContentSchema, pesosToCentavos } from "../src/lib/cms-schema.ts";

test("administration fails closed without configuration, with foreign origin, and without production rate controls", async () => {
  assert.equal(
    (await handleAdminApi(new Request("https://chapter.example/api/admin/session"), {})).status,
    503,
  );
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SESSION_SECRET: "x".repeat(48),
    APP_ORIGIN: "https://chapter.example",
  };
  assert.equal(
    (await handleAdminApi(new Request("https://evil.example/api/admin/session"), config)).status,
    403,
  );
  assert.equal(
    (await handleAdminApi(new Request("https://chapter.example/api/admin/session"), config)).status,
    503,
  );
  const response = await handleAdminApi(new Request("https://chapter.example/api/admin/session"), {
    ...config,
    AUTH_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(response.status, 429);
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("declined OAuth callbacks fail closed without reflecting provider details or exchanging a code", async () => {
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SESSION_SECRET: "x".repeat(48),
    APP_ORIGIN: "https://chapter.example",
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Unexpected token exchange");
  };
  try {
    for (const query of [
      "error=access_denied&error_description=private-provider-detail",
      "error=&code=untrusted-code",
    ]) {
      const response = await handleAdminApi(
        new Request(`https://chapter.example/api/auth/callback?${query}`),
        config,
      );
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
      const body = await response.text();
      assert.match(body, /Google sign-in was declined/);
      assert.doesNotMatch(body, /private-provider-detail|untrusted-code|Unexpected token exchange/);
      assert.equal(response.headers.has("location"), false);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("database conflicts return a bounded generic 409 during the error-code rollout", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const code of ["PT409", "40001"]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({ code, message: "private-database-detail" }, { status: 409 });
      };
      const response = await handleAdminApi(
        new Request("https://chapter.example/api/public/snapshot"),
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "test-publishable",
          SESSION_SECRET: "x".repeat(48),
          APP_ORIGIN: "https://chapter.example",
          AUTH_LIMITER: { limit: async () => ({ success: true }) },
        },
      );
      assert.equal(response.status, 409);
      assert.match(response.headers.get("cache-control"), /no-store/);
      const body = await response.text();
      assert.match(body, /Someone changed this draft/);
      assert.doesNotMatch(body, /private-database-detail/);
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request-local signing preserves cookie validation, secret rotation and live membership checks", async () => {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "editor@example.test" };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: now + 3600 })}.fixture`,
    refresh_token: "local-fixture",
    expires_at: now + 3600,
    user,
  };
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    SESSION_SECRET: "a".repeat(48),
    APP_ORIGIN: "https://chapter.example",
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
  };
  const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("hex");
  const request = (window, path = "/api/admin/content") =>
    new Request(config.APP_ORIGIN + path, {
      headers: {
        cookie: `__Host-demolay-auth=base64-${encode(session)}; __Host-demolay-window=${window}; __Host-demolay-csrf=${"c".repeat(64)}`,
      },
    });
  const originalFetch = globalThis.fetch;
  const originalImport = crypto.subtle.importKey;
  let calls = [],
    imports = 0,
    denial = null,
    authDenied = false;
  globalThis.fetch = async (input) => {
    const path = new URL(typeof input === "string" ? input : input.url).pathname;
    calls.push(path);
    if (path === "/auth/v1/user")
      return authDenied
        ? Response.json({ message: "invalid" }, { status: 401 })
        : Response.json(user);
    if (path === "/rest/v1/rpc/cms_session")
      return Response.json({ ...user, role: "editor", aal: "aal2", active: true });
    assert.equal(path, "/rest/v1/rpc/cms_list");
    return denial
      ? Response.json({ code: denial }, { status: 403 })
      : Response.json({ items: [], total: 0 });
  };
  crypto.subtle.importKey = function (...args) {
    imports++;
    return originalImport.apply(this, args);
  };
  try {
    const value = `${now}.${now}`;
    for (const secret of ["a".repeat(48), "b".repeat(48)]) {
      calls = [];
      imports = 0;
      const response = await handleAdminApi(request(`${value}.${sign(value, secret)}`), {
        ...config,
        SESSION_SECRET: secret,
      });
      assert.equal(response.status, 200);
      assert.equal(imports, 1);
      assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/rpc/cms_list"]);
      const renewed = decodeURIComponent(
        response.headers
          .getSetCookie()
          .find((c) => c.startsWith("__Host-demolay-window="))
          .split(";")[0]
          .slice("__Host-demolay-window=".length),
      ).split(".");
      assert.equal(renewed[0], String(now));
      assert.equal(renewed[2], sign(renewed.slice(0, 2).join("."), secret));
    }
    for (const invalid of [
      `${value}.${sign(value, "b".repeat(48))}`,
      `${value}.${"0".repeat(64)}`,
      ...[`${now - 28801}.${now}`, `${now - 1801}.${now - 1801}`, `${now}.${now + 60}`].map(
        (v) => `${v}.${sign(v, config.SESSION_SECRET)}`,
      ),
    ]) {
      calls = [];
      assert.equal((await handleAdminApi(request(invalid), config)).status, 401);
      assert.deepEqual(calls, []);
    }
    for (const [code, status] of [
      ["42501", 403],
      ["XX000", 503],
    ]) {
      denial = code;
      calls = [];
      const response = await handleAdminApi(
        request(`${value}.${sign(value, config.SESSION_SECRET)}`),
        config,
      );
      assert.equal(response.status, status);
      assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/rpc/cms_list"]);
      assert.equal(
        response.headers.getSetCookie().some((c) => c.startsWith("__Host-demolay-window=")),
        false,
      );
    }
    denial = null;
    calls = [];
    assert.equal(
      (
        await handleAdminApi(
          request(`${value}.${sign(value, config.SESSION_SECRET)}`, "/api/admin/session"),
          config,
        )
      ).status,
      200,
    );
    assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/rpc/cms_session"]);
    authDenied = true;
    calls = [];
    assert.equal(
      (await handleAdminApi(request(`${value}.${sign(value, config.SESSION_SECRET)}`), config))
        .status,
      401,
    );
    assert.deepEqual(calls, ["/auth/v1/user"]);
  } finally {
    globalThis.fetch = originalFetch;
    crypto.subtle.importKey = originalImport;
  }
});

test("mutations require exact origin and an unguessable same-session CSRF token", () => {
  const token = "a".repeat(64);
  const make = (origin, csrf) =>
    new Request("https://chapter.example/api/admin/content", {
      method: "POST",
      headers: { Origin: origin, "X-CSRF-Token": csrf },
    });
  assert.equal(
    validMutation(make("https://chapter.example", token), "https://chapter.example", token),
    true,
  );
  assert.equal(
    validMutation(make("https://evil.example", token), "https://chapter.example", token),
    false,
  );
  assert.equal(
    validMutation(make("https://chapter.example", "bad"), "https://chapter.example", token),
    false,
  );
  assert.equal(
    validMutation(make("https://chapter.example", token), "https://chapter.example", undefined),
    false,
  );
  assert.deepEqual(
    cookiesFrom(
      new Request("https://chapter.example", {
        headers: { cookie: "bad=%ZZ; good=hello%20world" },
      }),
    ),
    [{ name: "good", value: "hello world" }],
  );
});
test("server form readers reject malformed, oversized and non-JSON bodies", async () => {
  const make = (body, type = "application/json") =>
    new Request("https://chapter.example/api/admin/content", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
  await assert.rejects(boundedJson(make("{")), /could not be read/);
  await assert.rejects(boundedJson(make("x".repeat(262145))), /too large/);
  await assert.rejects(boundedJson(make("{}", "text/plain")), /JSON/);
  assert.deepEqual(await boundedJson(make('{"title":"safe"}')), { title: "safe" });
});
test("content schema accepts real prose but rejects HTML, unknown fields, and invalid dates", () => {
  const value = {
    kind: "article",
    slug: "a-real-story",
    title: "A chapter story",
    payload: {
      date: "2026-10-16",
      kicker: "Chapter",
      excerpt: "Summary",
      body: ["a".repeat(1000)],
    },
    mediaIds: [],
  };
  assert.equal(saveContentSchema.safeParse(value).success, true);
  assert.equal(
    saveContentSchema.safeParse({
      ...value,
      payload: { ...value.payload, body: ["<script>alert(1)</script>"] },
    }).success,
    false,
  );
  assert.equal(
    saveContentSchema.safeParse({ ...value, payload: { ...value.payload, date: "2026-02-30" } })
      .success,
    false,
  );
  assert.equal(
    saveContentSchema.safeParse({ ...value, payload: { ...value.payload, privateNote: "secret" } })
      .success,
    false,
  );
  assert.equal(pesosToCentavos("123.45"), 12345);
  assert.throws(() => pesosToCentavos("1e3"));
});
test("published snapshots reject private/draft fields and keep reused financial IDs separate by term", () => {
  const report = (half, opening, spent) => ({
    term: {
      id: `2026-${half}`,
      year: 2026,
      half,
      opening,
      proposedSponsors: 0,
      proposedFundraising: 0,
    },
    projects: [
      {
        id: "p1",
        title: "Project",
        eventSlug: "chapter-service",
        termId: `2026-${half}`,
        proposed: 100,
        notes: "",
        responsible: "Treasurer",
      },
    ],
    income: [],
    expenses: [
      {
        id: "e1",
        projectId: "p1",
        date: half === "A" ? "2026-01-01" : "2026-07-01",
        category: "Supplies",
        description: "Materials",
        amount: spent,
        responsible: "Treasurer",
      },
    ],
  });
  const snapshot = {
    revision: 1,
    content: [],
    media: [],
    finance: [report("A", 100, 30), report("B", 70, 20)],
  };
  const data = readPublicSnapshot(snapshot, "");
  assert.deepEqual(
    data.terms.map((term) => termSummary(term, data.income, data.projects, data.expenses).balance),
    [70, 50],
  );
  assert.equal(new Set(data.projects.map((p) => p.id)).size, 2);
  assert.equal(
    snapshotSchema.safeParse({ ...snapshot, staff: [{ email: "private@example.com" }] }).success,
    false,
  );
});
