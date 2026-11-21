import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import { visitorOrigin } from "../src/lib/visitor-site.ts";
import { snapshotSchema } from "../src/lib/public-snapshot.ts";
import { installationEventSlug } from "../src/lib/chapter-events.ts";

export async function verifyVisitor(request, expectedPages) {
  const snapshot = snapshotSchema.parse(
    JSON.parse(await readFile("src/data/published-content.json", "utf8")),
  );
  const stories = snapshot.content.flatMap((record) => {
    if (record.kind === "event") return [`/events/${record.slug}`];
    if (record.kind === "article") return [`/articles/${record.slug}`];
    return [];
  });
  const discovery = ["/", "/chapter", "/history", "/events", "/contact", ...stories];
  const hasJournal = stories.some((path) => path.startsWith("/articles/"));
  if (hasJournal) discovery.push("/articles");
  const hasInstallation = snapshot.content.some(
    (record) =>
      record.kind === "event" &&
      record.slug === installationEventSlug &&
      record.payload?.state === "completed",
  );

  async function get(path, status, type, method = "GET") {
    const response = await request(path, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, status, path);
    assert.match(response.headers.get("content-type") ?? "", type, path);
    return response;
  }

  const policies = ["/privacy", "/cookies", "/terms"];
  const pages = new Map();
  await Promise.all(
    [...new Set([...discovery, ...policies, "/articles", "/transparency"])].map(async (path) => {
      const response = await get(path, 200, /text\/html/);
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /frame-ancestors 'none'/,
        path,
      );
      const html = await response.text();
      const digest = createHash("sha256").update(html).digest("hex");
      if (expectedPages)
        assert.equal(
          digest,
          expectedPages.get(path),
          path + " does not match the verified package",
        );
      pages.set(path, digest);
      assert.match(html, /<main id="main-content"/);
      if (discovery.includes(path)) {
        assert.ok(
          html.includes(`<link rel="canonical" href="${visitorOrigin}${path}"`),
          `${path} canonical`,
        );
        assert.match(html, /<meta property="og:image" content="https:\/\//, path);
      }
      if (path === "/") {
        assert.match(html, /<a\b[^>]*href="\/contact"[^>]*>Explore membership/);
        assert.doesNotMatch(html, /<a\b[^>]*href="\/(transparency|admin)(?:["/?#])/);
        if (!hasJournal) assert.doesNotMatch(html, /<a\b[^>]*href="\/articles"/);
        for (const policy of policies)
          assert.ok(html.includes(`href="${policy}"`), `${policy} link`);
      }
      if (path === "/contact") {
        assert.match(
          html,
          /class="chapter-button membership-facebook" href="https:\/\/www\.facebook\.com\//,
        );
      }
      if (path === "/transparency" && snapshot.finance.length === 0) {
        assert.match(html, /Financial reports will be published here after chapter review/);
        assert.match(html, /<meta name="robots" content="noindex, follow"/);
      }
      if (hasInstallation && (path === "/" || path === "/events/" + installationEventSlug)) {
        assert.match(html, /<video[^>]*preload="none"/);
        assert.match(html, /id="installation-description"/);
      }
      if (path === "/chapter") assert.doesNotMatch(html, /<video|id="installation-film"/);
      if (path === "/") {
        const style = html.match(/<link rel="stylesheet" href="(\/assets\/[^"/]+\.css)"/)?.[1];
        assert.ok(style, "Homepage has a packaged stylesheet");
        await get(style, 200, /text\/css/, "HEAD");
      }
    }),
  );

  const sitemap = await (await get("/sitemap.xml", 200, /(?:application|text)\/xml/)).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).sort();
  assert.deepEqual(urls, discovery.map((path) => visitorOrigin + path).sort());
  const robots = await (await get("/robots.txt", 200, /text\/plain/)).text();
  assert.ok(robots.includes(`Sitemap: ${visitorOrigin}/sitemap.xml`));
  const missingPage = await (await get("/page-not-found", 404, /text\/html/)).text();
  await get("/404", 404, /text\/html/);
  assert.match(missingPage, /Naga City Chapter No\. 120/);
  assert.match(missingPage, /href="\/">Back to Home/);
  assert.match(missingPage, /href="\/events">Browse events/);
  const filmRange = await request("/media/installation-highlight.mp4", {
    headers: { Range: "bytes=1000000-1000099" },
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(filmRange.status, 206, "The visitor film must be seekable");
  assert.match(filmRange.headers.get("Content-Range") ?? "", /^bytes 1000000-1000099\/\d+$/);
  assert.equal((await filmRange.arrayBuffer()).byteLength, 100);

  await Promise.all([
    get("/images/chapter-seal.webp", 200, /image\/webp/, "HEAD"),
    get("/images/placeholders/chapter-fellowship.webp", 200, /image\/webp/, "HEAD"),
    get("/media/installation-highlight.mp4", 200, /video\/mp4/, "HEAD"),
    ...["/admin", "/api/admin/session", "/oauth/", "/_reports/unavailable", "/page-not-found"].map(
      async (path) => {
        const response = await get(path, 404, /text\/html/, "HEAD");
        assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/, path);
      },
    ),
  ]);
  return pages;
}

export async function verifyVisitorPackage(configPath) {
  const config = resolve(configPath);
  const worker = await unstable_dev(resolve(dirname(config), "worker.mjs"), {
    config,
    local: true,
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    logLevel: "error",
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
      showInteractiveDevSession: false,
    },
  });
  try {
    return await verifyVisitor((path, init) => worker.fetch(path, init));
  } finally {
    await worker.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], "Provide the prepared visitor package configuration path.");
  await verifyVisitorPackage(process.argv[2]);
  console.log("Visitor package passed page, discovery, media and staff isolation checks.");
}
