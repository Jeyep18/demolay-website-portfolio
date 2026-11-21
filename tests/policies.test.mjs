import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.HOMEPAGE_TEST_URL ?? "http://127.0.0.1:5173";
const policies = [
  ["/privacy", "Privacy Notice", "privacy-rights", "photos", "young-visitors"],
  ["/cookies", "Cookies &amp; Browser Storage", "theme-storage", "storage-controls"],
  ["/terms", "Terms of Use", "content-rights", "terms-requests"],
];
const withoutScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

test("policy routes describe chapter procedures and link to the request contacts", async () => {
  for (const [path, title, ...anchors] of policies) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    const html = withoutScripts(await response.text());
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, path);
    assert.ok(html.includes(title), path);
    assert.match(html, /24 October 2026/);
    assert.match(html, /datetime="2026-11-21"/i);
    assert.doesNotMatch(
      html,
      /Draft for chapter approval|This draft|public release pending|before public release|before launch|undergoing production verification/i,
    );
    assert.match(html, /<main id="main-content"/);
    assert.match(html, /aria-label="Related website policies"/);
    for (const anchor of anchors) assert.ok(html.includes(`id="${anchor}"`), anchor);
    for (const [href] of policies) assert.ok(html.includes(`href="${href}"`), href);
    assert.doesNotMatch(html, /<form\b|type="checkbox"|id="cookie-banner"/);
  }
});

test("homepage and public footer expose policies; membership links explain first contact", async () => {
  for (const path of [
    "/",
    "/contact",
    "/events",
    "/transparency",
    "/history",
    "/articles",
    "/chapter",
  ]) {
    const html = withoutScripts(await (await fetch(`${base}${path}`)).text());
    const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
    assert.ok(footer, path);
    assert.match(footer, /aria-label="Website policies"/);
    for (const [href] of policies) assert.ok(footer.includes(`href="${href}"`), `${path}: ${href}`);
    if (path === "/contact") {
      assert.match(html, /Message the chapter on Facebook/);
      assert.match(html, /leave out IDs, addresses/);
      assert.match(html, /href="\/privacy#photos"/);
      assert.match(html, /parent or guardian/);
      assert.doesNotMatch(html, /<form\b/);
    }
  }
});

test("storage notice describes the actual preference and distinguishes external requests", async () => {
  const cookies = withoutScripts(await (await fetch(`${base}/cookies`)).text());
  assert.match(cookies, /chapter-theme/);
  assert.match(cookies, /No automatic expiry/);
  assert.match(cookies, /Clearing cookies alone may not clear local storage/);
  assert.match(cookies, /The chapter website serves its fonts directly/);
  assert.doesNotMatch(cookies, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const privacy = withoutScripts(await (await fetch(`${base}/privacy`)).text());
  assert.match(privacy, /mailto:nagacitychapter120@gmail.com/);
  assert.match(privacy, /Chapter privacy officer/);
  assert.match(privacy, /owner reports that current public assets do not show identifiable minors/);
  assert.match(privacy, /Incomplete permission records do not/);
  assert.match(privacy, /Blurring a face is not enough/);
  assert.doesNotMatch(privacy, /href="tel:/);
  assert.match(privacy, /legitimate interest in answering/);
  assert.match(privacy, /object to processing based on legitimate interests/);
  assert.match(privacy, /90 days after closure/);
  assert.match(privacy, /one year after closure/);
  assert.match(privacy, /reviews and mailbox deletions manually/);
  assert.match(privacy, /No automatic staff or audit-record purge/);
  assert.match(
    privacy,
    /Remaining contractual and provider-specific retention details are under review/,
  );
  assert.match(privacy, /Your browser requests published event photographs from Supabase storage/);
  assert.match(privacy, /Lovable reporting hooks are disabled in production/);
  assert.match(privacy, /individual publication records for the current material are complete/);
  assert.match(privacy, /does not independently certify/);
  assert.doesNotMatch(privacy, /adults remains under review/);
  assert.doesNotMatch(privacy, /scheduled process once configured/);
  assert.match(privacy, /https:\/\/privacy.gov.ph\/data-subject-rights\//);
});
