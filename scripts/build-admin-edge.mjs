import { build } from "esbuild";
import { stat } from "node:fs/promises";

// Bundle the canonical handler so Supabase need not resolve files outside its function mount.
const result = await build({
  stdin: {
    contents:
      'export { handleAdminApi } from "./src/server/admin-api.ts"; export { handleAdminEdge } from "./src/server/admin-edge.ts";',
    resolveDir: process.cwd(),
    sourcefile: "admin-edge-entry.ts",
  },
  outfile: "supabase/functions/cms-admin/generated.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  metafile: true,
});
const output = await stat("supabase/functions/cms-admin/generated.mjs");
if (output.size > 5 * 1024 * 1024) throw new Error("Admin Edge bundle exceeds deployment limit");
if (
  Object.values(result.metafile.outputs).some((file) => file.imports.some((item) => item.external))
)
  throw new Error("Admin Edge bundle has unresolved runtime imports");
console.log(`Admin Edge bundle ready (${output.size} bytes), using locked local dependencies.`);
