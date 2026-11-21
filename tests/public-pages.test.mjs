import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { events, articles, terms, photos, leaders } from "../src/data/content.ts";
import { installationEventSlug, manilaDate, sortChapterEvents } from "../src/lib/chapter-events.ts";
import { formatMoney, termSummary, eventFinanceSummary } from "../src/lib/finance.ts";
const base = process.env.HOMEPAGE_TEST_URL ?? "http://127.0.0.1:5173";
const paths = [
  "/",
  "/chapter",
  "/history",
  "/events",
  "/articles",
  "/contact",
  "/transparency",
  ...events.map((event) => `/events/${event.slug}`),
  ...events
    .filter((event) => eventFinanceSummary(event.slug))
    .map((event) => `/transparency/${event.slug}`),
  ...articles.map((article) => `/articles/${article.slug}`),
];
test("About gallery and completed archive preserve navigation and readable content", async () => {
  const about = await (await fetch(`${base}/chapter`)).text();
  assert.match(about, /About the Chapter · Naga City/);
  if (photos.length) assert.match(about, /id="chapter-gallery"/);
  assert.equal((about.match(/aria-label="Inspect photo /g) ?? []).length, photos.length);
  const calendar = await (await fetch(`${base}/events`)).text();
  assert.equal(
    (calendar.match(/class="event-card"/g) ?? []).length,
    sortChapterEvents(events, manilaDate()).upcoming.length,
  );
  assert.equal(
    (calendar.match(/class="completed-event-row"/g) ?? []).length,
    events.filter((event) => event.state === "completed").length,
  );
  for (const event of events) assert.ok(calendar.includes(`/events/${event.slug}`));
});
test("public routes render readable HTML, real assets, clean content and working internal links", async () => {
  const assets = new Set();
  for (const path of paths) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, path);
    assert.match(html, /<main id="main-content"/);
    if ((path === "/articles" && !articles.length) || (path === "/transparency" && !terms.length))
      assert.match(html, /<meta[^>]+name="robots"[^>]+noindex/i);
    else assert.doesNotMatch(html, /<meta[^>]+name="robots"[^>]+noindex/i);
    assert.doesNotMatch(
      html,
      /\/__l5e\/assets|March 3, 2024|Third Sunday of the month|<form\b|Confirm attendance/,
    );
    assert.doesNotMatch(
      html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
      /fictional|sample|illustrative|content preview/i,
    );
    for (const match of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assets.add(match[1]);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `Duplicate ids on ${path}`);
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g))
      assert.ok(ids.includes(id), `${path} missing ${id}`);
  }
  for (const path of assets) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /image\//, path);
  }
});
test("term links reconcile to the same shared figures; unavailable selections and slugs fail honestly", async () => {
  for (const term of terms) {
    const html = await (
      await fetch(`${base}/transparency?year=${term.year}&term=${term.half}`)
    ).text();
    assert.ok(html.includes(formatMoney(termSummary(term).balance)));
    for (const project of termSummary(term).termProjects) {
      assert.ok(html.includes(`/transparency/${project.eventSlug}`));
      const detail = await (await fetch(`${base}/transparency/${project.eventSlug}`)).text();
      assert.ok(detail.includes(`id="${project.id}"`));
    }
  }
  const landing = await (await fetch(`${base}/transparency`)).text();
  if (terms.length === 0) {
    assert.match(landing, /Financial reports will be published here after chapter review/);
    assert.doesNotMatch(landing, /Choose a reporting period|Choose another reporting period/);
  }
  for (const query of ["year=nonsense&term=Z", "year=0&term=B"]) {
    const unavailable = await (await fetch(`${base}/transparency?${query}`)).text();
    assert.match(
      unavailable,
      terms.length
        ? /Report unavailable/
        : /Financial reports will be published here after chapter review/,
    );
  }

  for (const path of [
    "/events/not-a-real-event",
    "/articles/not-a-real-article",
    "/does-not-exist",
    "/transparency/not-a-real-event",
    "/transparency/community-reading-day",
  ])
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  const html = await (await fetch(`${base}/events/community-reading-day`)).text();
  assert.doesNotMatch(html, /id="event-finance"|href="#event-finance"/);
  assert.doesNotMatch(html, /₱0/);
});
test("web film is served, within asset limits and not automatically requested by markup", async () => {
  const about = await (await fetch(new URL("/chapter", base))).text();
  assert.doesNotMatch(about, /<video|id="installation-film"/);
  const installation = events.find(
    (event) => event.slug === installationEventSlug && event.state === "completed",
  );
  if (installation) {
    for (const path of ["/", "/events/" + installation.slug]) {
      const html = await (await fetch(new URL(path, base))).text();
      assert.match(html, /<video[^>]*controls=""[^>]*preload="none"/);
      assert.doesNotMatch(html, /<video[^>]*autoplay/);
      assert.match(html, /aria-describedby="installation-description"/);
      assert.match(html, /Seven Cardinal Virtues into practice/);
      assert.doesNotMatch(html, /installation-visual-description/);
      if (path !== "/") {
        assert.match(html, /class="story-hero event-hero"/);
        assert.match(html, /id="event-overview"/);
      }
    }
  }
  const media = JSON.parse(
    await readFile(new URL("../docs/public-media.json", import.meta.url), "utf8"),
  );
  assert.ok(media);
  const response = await fetch(`${base}/media/installation-highlight.mp4`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /video\/mp4/);
  assert.ok(Number(response.headers.get("content-length")) < 24 * 1024 * 1024);
});

test("archive fallback preserves full term narratives and favorable variances stay visible", async () => {
  const history = await (await fetch(`${base}/history`)).text();
  const fallback = [...history.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/g)]
    .map((match) => match[1])
    .find((html) => html.includes('class="archive-nojs"'));
  if (leaders.length) assert.ok(fallback, "A readable archive fallback is required");
  for (const leader of leaders) {
    assert.ok(fallback.includes(leader.summary));
    assert.ok(fallback.includes(leader.lesson));
  }
  if (!leaders.length)
    assert.doesNotMatch(history, /Past Master Councilors|Adrian Mercado|Rafael Santos/);
});
