import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(
  new URL("../src/components/ContentStory.tsx", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(import.meta.resolve("react/jsx-runtime")),
  );
const { ArticleBody, StorySections, EventMetadata, StoryHero } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("public and admin story bodies show supplied paragraphs without invented section headings", () => {
  const html = renderToStaticMarkup(
    createElement(ArticleBody, {
      paragraphs: [
        "Actual chapter story.",
        "<script>unsafe</script>",
        "Fourth section is supported.",
      ],
    }),
  );
  assert.ok(html.includes("Actual chapter story."));
  assert.ok(html.includes("Fourth section is supported."));
  assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
  assert.ok(!html.includes("<h2"));
  assert.ok(!html.includes("An everyday beginning"));
});

test("event renderer preserves author headings and meaningful metadata labels", () => {
  const html = renderToStaticMarkup(
    createElement(StorySections, {
      sections: [
        { id: "service", title: "Service outcome", paragraphs: ["Thirty books collected."] },
      ],
    }),
  );
  assert.ok(html.includes('<section id="service"><h2>Service outcome</h2>'));
  assert.ok(html.includes("Thirty books collected."));
  const details = renderToStaticMarkup(
    createElement(EventMetadata, {
      when: "October 16, 2026",
      place: "Naga City",
      host: "Chapter",
      lead: "Project lead",
    }),
  );
  assert.ok(details.includes("<dt>Where</dt><dd>Naga City</dd>"));
  assert.ok(!details.includes("termId"));
  const hero = renderToStaticMarkup(
    createElement(StoryHero, {
      image: "/photo.webp",
      imageAlt: "Members collecting books",
      eyebrow: "Completed",
      title: "Service day",
      summary: "Real summary",
    }),
  );
  assert.ok(hero.includes('alt="Members collecting books"'));
});
