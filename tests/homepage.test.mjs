import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { articles } from "../src/data/content.ts";

const baseUrl = process.env.HOMEPAGE_TEST_URL ?? "http://127.0.0.1:5173";
const response = await fetch(baseUrl);
assert.equal(response.status, 200, "The homepage must return HTTP 200");
const html = await response.text();

test("chapter identity and a native membership link appear in server-rendered HTML", () => {
  assert.match(html, /Naga City Chapter/);
  assert.match(html, /Masonic Lodge No\. 257/);
  assert.doesNotMatch(html, /Sample data|not actual chapter accounts|Discover our chapter/);
  assert.match(html, /<a\b[^>]*href="\/contact"[^>]*>Explore membership/);
  assert.doesNotMatch(html, /<a\b[^>]*href="\/transparency(?:["/?#])|id="transparency"/);
  if (!articles.length) assert.doesNotMatch(html, /<a\b[^>]*href="\/articles"/);
  assert.doesNotMatch(html, /Pause animations|Enable animations/);
  assert.match(html, /Naga City Chapter No\. 120/);
  assert.match(html, /International Order of DeMolay/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<main id="main-content"/);
});

test("preview navigation links resolve to real homepage sections", () => {
  const anchors = [...html.matchAll(/<a\b[^>]*href="#([^"]+)"/g)];
  assert.ok(anchors.length >= 2, "Expected skip and chapter activities links");
  for (const [, id] of anchors) {
    assert.ok(html.includes(`id="${id}"`), `Missing anchor target: ${id}`);
  }
});

test("chapter contact links use the supplied Facebook page and email", () => {
  assert.match(
    html,
    /href="https:\/\/www\.facebook\.com\/profile\.php\?id=61568910982860"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
  );
  assert.match(html, /href="mailto:nagacitychapter120@gmail\.com"/);
  assert.match(html, /aria-label="Contact the chapter"/);
});

test("the preview collects no personal information and has no Lovable asset dependency", () => {
  assert.doesNotMatch(html, /<(form|input|textarea)\b/);
  assert.doesNotMatch(html, /\/__l5e\/assets/);
  assert.doesNotMatch(html, /March 3, 2024/);
});

test("homepage images and all nine supplied placeholders are served as actual WebP images", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("../docs/placeholder-images.json", import.meta.url), "utf8"),
  );
  assert.equal(catalog.images.length, 9);
  const sources = new Set([
    ...[...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map((match) => match[1]),
    ...catalog.images.map((image) => image.url),
  ]);
  for (const src of sources) {
    const image = await fetch(new URL(src, baseUrl));
    assert.equal(image.status, 200, `${src} should be available`);
    assert.match(image.headers.get("content-type") ?? "", /image\/webp/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
  }
});
