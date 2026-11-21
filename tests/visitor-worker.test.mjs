import assert from "node:assert/strict";
import { test } from "node:test";
import visitor from "../src/visitor-worker.ts";

test("visitor pages are indexable and staff routes never reach an admin service", async () => {
  const fetched = [];
  const env = {
    ASSETS: {
      fetch(request) {
        fetched.push(new URL(request.url).pathname);
        return new Response("fixture", { headers: { "Content-Type": "text/html" } });
      },
    },
  };
  const request = (path, method = "GET") =>
    visitor.fetch(new Request("https://chapter.example" + path, { method }), env);
  assert.equal((await request("/events")).headers.get("X-Robots-Tag"), null);
  assert.equal(fetched.pop(), "/events/index.html");
  assert.equal((await request("/sitemap.xml")).status, 200);
  assert.equal(fetched.pop(), "/sitemap.xml");
  for (const path of [
    "/404",
    "/404/",
    "/404.html",
    "/admin",
    "/admin/index.html",
    "/api/admin/session",
    "/oauth",
    "/oauth/privacy.html",
    "/_reports/unavailable",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
    assert.equal(fetched.pop(), "/404.html");
  }
  assert.equal((await request("/api/admin/content", "POST")).status, 405);
  assert.equal(fetched.length, 0);
});

test("installation film serves single byte ranges and preserves full responses when required", async () => {
  const request = (headers, method = "GET") =>
    visitor.fetch(
      new Request("https://chapter.example/media/installation-highlight.mp4", { headers, method }),
      {
        ASSETS: {
          fetch: () =>
            new Response(method === "HEAD" ? null : "0123456789", {
              headers: { "Content-Type": "video/mp4", "Content-Length": "10", ETag: '"film"' },
            }),
        },
      },
    );
  for (const [range, bytes, contentRange] of [
    ["bytes=0-0", "0", "bytes 0-0/10"],
    ["bytes=3-5", "345", "bytes 3-5/10"],
    ["bytes=8-", "89", "bytes 8-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-100", "89", "bytes 8-9/10"],
  ]) {
    const response = await request({ Range: range, "If-Range": '"film"' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), contentRange);
    assert.equal(response.headers.get("Content-Length"), String(bytes.length));
    assert.equal(await response.text(), bytes);
  }
  const missing = await request({ Range: "bytes=10-" });
  assert.equal(missing.status, 416);
  assert.equal(missing.headers.get("Content-Range"), "bytes */10");
  const different = await request({ Range: "bytes=3-5", "If-Range": '"old-film"' });
  assert.equal(different.status, 200);
  assert.equal(await different.text(), "0123456789");
  const head = await request({ Range: "bytes=0-0" }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Accept-Ranges"), "bytes");
});
