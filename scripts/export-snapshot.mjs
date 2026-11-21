import { writeFile } from 'node:fs/promises';
import { snapshotSchema, readPublicSnapshot } from '../src/lib/public-snapshot.ts';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('Set the Supabase URL and publishable key before exporting approved content.');
const url = new URL(SUPABASE_URL);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('Use the approved Supabase HTTPS project address.');
const response = await fetch(`${url.origin}/rest/v1/rpc/cms_public_snapshot`, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Approved-content export failed (${response.status}); previous snapshot retained.`);
const snapshot = snapshotSchema.parse(await response.json());
readPublicSnapshot(snapshot, url.origin);
await writeFile(new URL('../src/data/published-content.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Exported ${snapshot.content.length} approved records and ${snapshot.finance.length} financial reports.`);
