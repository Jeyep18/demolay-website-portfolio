// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

export default defineConfig({
  plugins: [{
    name: "chapter-server-development-environment",
    config(_config, { mode, command }) {
      if (command !== "serve") return;
      const values = loadEnv(mode, process.cwd(), "");
      for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_ORIGIN", "SESSION_SECRET"]) {
        if (values[key]) process.env[key] = values[key];
      }
    },
  }],
  tanstackStart: {
    // The Nitro Cloudflare output is prerendered by scripts/prerender.mjs.
    prerender: { enabled: false },
    sitemap: { enabled: false },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
