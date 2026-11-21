import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const origin = "https://nccdemolay.naga-demolay-120-b0d24c.workers.dev";
const assets = JSON.parse(await readFile(new URL("./demo-assets.json", import.meta.url), "utf8"));

for (const asset of assets) {
  const url = new URL(asset.slice("public".length), origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw new Error(`Could not download ${url.pathname} (${response.status})`);
  const file = fileURLToPath(new URL("../" + asset, import.meta.url));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, new Uint8Array(await response.arrayBuffer()));
}
console.log(`Retrieved ${assets.length} public demo assets.`);
