import { unstable_dev } from 'wrangler';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { snapshotSchema } from '../src/lib/public-snapshot.ts';
import { normalizePrerenderHtml } from './prerender-html.mjs';
import { visitorOrigin } from '../src/lib/visitor-site.ts';

const snapshot = snapshotSchema.parse(JSON.parse(await readFile('src/data/published-content.json', 'utf8')));
const paths = ['/', '/chapter', '/events', '/articles', '/history', '/contact', '/privacy', '/cookies', '/terms', '/transparency', '/admin'].map(path => ({ path, output: path }));
const discoveryPaths = ['/', '/chapter', '/events', '/history', '/contact'];
const defaultTerm = snapshot.finance.map(report => report.term).sort((a,b) => a.id.localeCompare(b.id)).at(-1);
if (defaultTerm) paths.find(page => page.output === '/transparency').path = `/transparency?year=${defaultTerm.year}&term=${defaultTerm.half}`;
for (const record of snapshot.content) {
  if (record.kind === 'event') {
    const path = `/events/${record.slug}`;
    paths.push({ path, output: path });
    discoveryPaths.push(path);
    if (snapshot.finance.some(report => report.projects.some(project => project.eventSlug === record.slug))) paths.push({ path: `/transparency/${record.slug}`, output: `/transparency/${record.slug}` });
  }
  if (record.kind === 'article') {
    const path = `/articles/${record.slug}`;
    paths.push({ path, output: path });
    discoveryPaths.push(path);
  }
}
if (snapshot.content.some((record) => record.kind === 'article')) discoveryPaths.push('/articles');
for (const report of snapshot.finance) paths.push({ path: `/transparency?year=${report.term.year}&term=${report.term.half}`, output: `/_reports/${report.term.id}` });
paths.push({ path: '/transparency?year=0&term=B', output: '/_reports/unavailable' });

const worker = await unstable_dev(resolve('.output/server/index.mjs'), { config: resolve('.output/server/wrangler.json'), local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0, compatibilityDate: '2026-10-12', logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, showInteractiveDevSession: false } });
try {
  for (const page of paths) {
    const response = await worker.fetch(page.path, { redirect: 'manual' });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Prerender failed for ${page.path}: ${response.status}; redirect=${response.headers.get('location') ?? 'none'}`);
    const html = normalizePrerenderHtml(await response.text());
    if (!html.includes('</html>')) throw new Error(`Incomplete prerender for ${page.path}`);
    if (html.includes("This page didn&#x27;t load") || html.includes("This page didn't load") || html.includes('data-tanstack-error')) throw new Error(`An error boundary rendered for ${page.path}`);
    const target = resolve('.output/public', '.' + page.output, 'index.html');
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, html);
  }
  const urls = discoveryPaths.map((path) => `  <url><loc>${visitorOrigin}${path}</loc></url>`);
  await writeFile('.output/public/sitemap.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n'));
  console.log(`Prerendered ${paths.length} pages through Cloudflare workerd.`);
} finally { await worker.stop(); }
