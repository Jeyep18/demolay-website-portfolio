import { handleAdminApi, handleAdminEdge } from "./generated.mjs";

Deno.serve((request: Request) =>
  handleAdminEdge(
    request,
    {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
      SUPABASE_PUBLISHABLE_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
      APP_ORIGIN: Deno.env.get("CMS_ADMIN_APP_ORIGIN"),
      SESSION_SECRET: Deno.env.get("CMS_ADMIN_SESSION_SECRET"),
      ADMIN_EDGE_SECRET: Deno.env.get("CMS_ADMIN_BRIDGE_SECRET"),
    },
    handleAdminApi,
  ),
);
