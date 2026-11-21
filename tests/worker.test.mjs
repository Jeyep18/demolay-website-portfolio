import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { assetPath } from "../src/worker.ts";

test("staging denies anonymous pages and media while keeping the sign-in shell usable", async () => {
  let assets = 0;
  const env = {
    STAGING_REQUIRE_STAFF: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
    SESSION_SECRET: "x".repeat(48),
    APP_ORIGIN: "http://127.0.0.1:8787",
    ASSETS: {
      fetch: async () => {
        assets++;
        return new Response("Sign-in shell");
      },
    },
  };
  for (const path of ["/", "/images/chapter.webp", "/media/chapter.mp4"]) {
    const response = await worker.fetch(new Request(env.APP_ORIGIN + path), env);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/admin");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(assets, 0);
  assert.equal((await worker.fetch(new Request(env.APP_ORIGIN + "/admin"), env)).status, 200);
  assert.equal(
    (await worker.fetch(new Request(env.APP_ORIGIN + "/assets/admin.js"), env)).status,
    200,
  );
  assert.equal(assets, 2);
});

test("static routing ignores marketing queries and rejects unknown report selections", () => {
  assert.equal(
    assetPath(new URL("https://chapter.example/transparency?utm_source=chapter")),
    "/transparency/index.html",
  );
  assert.equal(
    assetPath(new URL("https://chapter.example/transparency?year=0&term=B")),
    "/_reports/unavailable/index.html",
  );
  assert.equal(assetPath(new URL("https://chapter.example/admin/")), "/admin/index.html");
});

test("only exact OAuth information assets bypass staging, even when authentication is unavailable", async () => {
  const fetched = [];
  const env = {
    STAGING_REQUIRE_STAFF: "true",
    RELEASE_APPROVED: "false",
    ASSETS: {
      fetch: async (request) => {
        fetched.push(new URL(request.url).pathname);
        return new Response("Application information", {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  };
  for (const path of [
    "/oauth",
    "/oauth/",
    "/oauth/index.html",
    "/oauth/privacy.html",
    "/oauth/terms.html",
    "/oauth/style.css",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await worker.fetch(
        new Request("https://chapter.example" + path + "?review=1", { method }),
        env,
      );
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      assert.doesNotMatch(response.headers.get("cache-control"), /private/);
    }
  }
  assert.equal(fetched[0], "/oauth/index.html");
  const before = fetched.length;
  for (const path of [
    "/",
    "/privacy",
    "/terms",
    "/events",
    "/images/chapter.webp",
    "/media/chapter.mp4",
    "/oauth/private.json",
    "/oauth/admin",
    "/oauth/privacy.html/",
    "/oauth/style.css/extra",
    "/oauth%2fprivacy.html",
    "/OAUTH/",
    "/oauth/../events",
  ]) {
    const response = await worker.fetch(new Request("https://chapter.example" + path), env);
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(fetched.length, before);
  assert.equal(
    (await worker.fetch(new Request("https://chapter.example/oauth/", { method: "POST" }), env))
      .status,
    405,
  );
  assert.equal(
    (await worker.fetch(new Request("https://chapter.example/api/admin/session"), env)).status,
    503,
  );
});

test("admin HTML cannot be cached and every response has restrictive browser headers", async () => {
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
    },
  };
  const response = await worker.fetch(new Request("https://chapter.example/admin"), env);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(
    response.headers.get("content-security-policy"),
    /script-src[^;]*unsafe-inline/,
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
});
