import manifest from "./data/static-manifest.json" with { type: "json" };
import { dispatchAdmin, handleEdgeRate, type AdminEdgeEnv } from "./server/admin-edge.ts";

type Env = AdminEdgeEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RELEASE_APPROVED?: string;
  STAGING_REQUIRE_STAFF?: string;
};
// Only reviewed application information can bypass the staff staging gate.
const oauthAssets = new Map([
  ["/oauth", "/oauth/index.html"],
  ["/oauth/", "/oauth/index.html"],
  ["/oauth/index.html", "/oauth/index.html"],
  ["/oauth/privacy.html", "/oauth/privacy.html"],
  ["/oauth/terms.html", "/oauth/terms.html"],
  ["/oauth/style.css", "/oauth/style.css"],
]);
export function assetPath(url: URL): string | null {
  if (url.pathname.replace(/\/$/, "") === "/transparency" && url.search) {
    if (!url.searchParams.has("year") && !url.searchParams.has("term"))
      return "/transparency/index.html";
    const latest = manifest.reports.at(-1) ?? "2026-B";
    const year = Number(url.searchParams.get("year") ?? latest.slice(0, 4));
    const half = url.searchParams.get("term") ?? latest.slice(-1);
    const id = `${year}-${half}`;
    return (manifest.reports as string[]).includes(id)
      ? `/_reports/${id}/index.html`
      : "/_reports/unavailable/index.html";
  }
  return (
    (manifest.routes as Record<string, string>)[url.pathname.replace(/\/$/, "") || "/"] ?? null
  );
}
function protect(response: Response, env: Env, admin: boolean) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const scriptSources = (manifest.scriptHashes as string[])
    .map((hash) => `'sha256-${hash}'`)
    .join(" ");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' ${scriptSources}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`,
  );
  if (admin) {
    headers.set("Cache-Control", "no-store, private");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  } else if (env.RELEASE_APPROVED !== "true") headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!admin && headers.get("content-type")?.includes("text/html"))
    headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/internal/admin-edge-rate")
      return protect(await handleEdgeRate(request, env), env, true);
    if (url.pathname.startsWith("/api/"))
      return protect(await dispatchAdmin(request, env), env, true);
    if (!["GET", "HEAD"].includes(request.method))
      return protect(new Response("Method not allowed", { status: 405 }), env, true);
    const oauthAsset = oauthAssets.get(url.pathname);
    if (oauthAsset) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = oauthAsset;
      assetUrl.search = "";
      return protect(await env.ASSETS.fetch(new Request(assetUrl, request)), env, false);
    }
    const admin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    const staging = env.STAGING_REQUIRE_STAFF === "true";
    let refreshedCookies: string[] = [];
    if (staging && !admin && !/^\/assets\/[^/]+\.(js|css)$/.test(url.pathname)) {
      const session = await dispatchAdmin(
        new Request(new URL("/api/admin/session", url), { headers: request.headers }),
        env,
      );
      if (!session.ok) {
        if (session.status === 401 || session.status === 403)
          return protect(
            new Response(null, { status: 303, headers: { Location: "/admin" } }),
            env,
            true,
          );
        return protect(
          new Response("Staging is temporarily unavailable.", { status: 503 }),
          env,
          true,
        );
      }
      const staff = (await session.json()) as { active?: boolean; aal?: string };
      if (!staff.active || staff.aal !== "aal2")
        return protect(
          new Response(null, { status: 303, headers: { Location: "/admin" } }),
          env,
          true,
        );
      refreshedCookies = session.headers.getSetCookie();
    }
    const path = assetPath(url);
    const assetUrl = new URL(request.url);
    if (path) {
      assetUrl.pathname = path;
      assetUrl.search = "";
    }
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const protectedResponse = protect(response, env, admin || staging);
    for (const cookie of refreshedCookies) protectedResponse.headers.append("Set-Cookie", cookie);
    return protectedResponse;
  },
};
