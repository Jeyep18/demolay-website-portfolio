import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";
const output = resolve(".output/public");
const routes = {};
const scriptHashes = new Set();
const reports = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      if ((await stat(file)).size > 25 * 1024 * 1024)
        throw new Error(
          `Asset exceeds Cloudflare's free per-file limit: ${relative(output, file)}`,
        );
      if (!entry.name.endsWith(".html")) continue;
      const name = "/" + relative(output, file).split(sep).join("/");
      const html = await readFile(file, "utf8");
      for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
        if (!/\bsrc\s*=/i.test(script[1]) && script[2])
          scriptHashes.add(createHash("sha256").update(script[2]).digest("base64"));
      if (name.endsWith("/index.html")) routes[name.slice(0, -"/index.html".length) || "/"] = name;
      else if (name === "/index.html") routes["/"] = name;
      else routes[name.slice(0, -".html".length)] = name;
      const report = name.match(/^\/_reports\/(\d{4}-[AB])\/index.html$/);
      if (report) reports.push(report[1]);
    }
  }
}
await walk(output);
if (!routes["/"] || !routes["/admin"])
  throw new Error("Public homepage and admin shell must both be prerendered.");
await writeFile(
  "src/data/static-manifest.json",
  JSON.stringify(
    {
      routes,
      reports: reports.sort(),
      scriptHashes: [...scriptHashes],
      installationVideoBytes: (await stat(resolve(output, "media/installation-highlight.mp4")))
        .size,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${Object.keys(routes).length} static pages with hashed inline scripts; no request-time SSR.`,
);
