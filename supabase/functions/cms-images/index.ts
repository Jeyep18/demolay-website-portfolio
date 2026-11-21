import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import * as magick from "npm:@imagemagick/magick-wasm@0.0.44";
import { createImageHandler } from "./handler.mjs";
import { initializeImages, transformImage } from "./transform.mjs";

const wasm = await Deno.readFile(
  new URL(import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.44/magick.wasm")),
);
await initializeImages(magick, wasm);

Deno.serve(
  createImageHandler({
    clients(authorization: string) {
      const url = Deno.env.get("SUPABASE_URL");
      const anon = Deno.env.get("SUPABASE_ANON_KEY");
      const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !anon || !secret) throw new Error("Image processing is unconfigured");
      const auth = { persistSession: false, autoRefreshToken: false };
      return {
        user: createClient(url, anon, {
          auth,
          global: { headers: { Authorization: authorization } },
        }),
        service: createClient(url, secret, { auth }),
      };
    },
    transform: (data: Uint8Array) => transformImage(data, magick),
  }),
);
