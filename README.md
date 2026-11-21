# Naga City Chapter No. 120 website

[View the live chapter website](https://nccdemolay.naga-demolay-120-b0d24c.workers.dev)

A public website for a local Order of DeMolay chapter. Visitors can learn about the chapter, browse event recaps and find out how to ask about membership.

- React and TanStack Start prerender the visitor pages for Cloudflare Workers.
- The visitor Worker serves the sitemap, a branded 404 and video byte ranges.
- The chapter calendar uses Manila time. A separate staff application manages approved content and publication.

This is a clean portfolio snapshot with independent Git history. The local demo uses an empty publication dataset. Chapter event records, personal membership contacts and operational notes are kept in the original project. The live site shows the approved content.

## Run the local demo

1. Use Node.js 24.14.0 and run `bun install --frozen-lockfile`.
2. Run `node scripts/fetch-demo-assets.mjs` to retrieve public artwork from the live site into ignored local files.
3. Run `npm run dev` for the development preview or `npm run build` to prerender pages.

The fonts are distributed under the included Open Font Licenses. Chapter photography and video are served by the live chapter site. Historical image credits appear on the History page.
