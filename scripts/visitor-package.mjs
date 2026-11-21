import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { visitorOrigin } from "../src/lib/visitor-site.ts";

export async function prepareVisitorPackage() {
  const root = resolve("dist");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "chapter-visitor-"));
  const output = join(directory, "public");
  const config = JSON.parse(await readFile("wrangler.visitor.jsonc", "utf8"));
  await mkdir(".wrangler", { recursive: true });
  const bundlerOutput = await mkdtemp(resolve(".wrangler", "visitor-build-"));
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--dry-run",
      "--config",
      "wrangler.visitor.jsonc",
      "--outdir",
      bundlerOutput,
    ],
    { stdio: "inherit" },
  );
  const worker = await readFile(join(bundlerOutput, "visitor-worker.js"), "utf8");
  await writeFile(
    join(directory, "worker.mjs"),
    worker.replace(/^\/\/# sourceMappingURL=.*$/m, ""),
  );
  await mkdir(output);
  const manifest = JSON.parse(await readFile("src/data/static-manifest.json", "utf8"));
  const files = Object.values(manifest.routes).filter(
    (path) => !/^\/(admin|oauth)(?:\/|$)/.test(path),
  );
  for (const file of [
    "assets",
    "media",
    "images",
    "fonts",
    "_headers",
    "favicon.png",
    "sitemap.xml",
    ...files,
  ]) {
    const name = file.replace(/^\//, "");
    await cp(join(".output/public", name), join(output, name), { recursive: true });
  }
  const robots = await readFile(".output/public/robots.txt", "utf8");
  await writeFile(join(output, "robots.txt"), `${robots.trimEnd()}\n\nSitemap: ${visitorOrigin}/sitemap.xml\n`);
  delete config.$schema;
  config.main = "worker.mjs";
  config.assets.directory = "public";
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
