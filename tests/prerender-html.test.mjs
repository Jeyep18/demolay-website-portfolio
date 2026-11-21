import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { normalizePrerenderHtml } from "../scripts/prerender-html.mjs";

test("router bootstrap survives HTML parsing with an unchanged CSP hash and match IDs", () => {
  const raw =
    '<script data-tsr-stream-part="">globalThis.matches=["__root__\0","\0admin\0admin"];</script>';
  const fixed = normalizePrerenderHtml(raw);
  const code = (html) => html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const htmlParser = (text) => text.replace(/\r\n?/g, "\n").replaceAll("\0", "\ufffd");
  const hash = (text) => createHash("sha256").update(text).digest("base64");
  assert.notEqual(hash(code(raw)), hash(htmlParser(code(raw))));
  assert.equal(hash(code(fixed)), hash(htmlParser(code(fixed))));
  assert.ok(!fixed.includes("\0"));
  const before = {},
    after = {};
  runInNewContext(code(raw), before);
  runInNewContext(code(fixed), after);
  assert.deepEqual([...after.matches], [...before.matches]);
  assert.equal(normalizePrerenderHtml(fixed), fixed);
});

test("prerender normalization preserves script attributes and matches browser line endings", () => {
  assert.equal(
    normalizePrerenderHtml('<script nonce="test">const text="safe";\r\n</script>\r\n'),
    '<script nonce="test">const text="safe";\n</script>\n',
  );
});
