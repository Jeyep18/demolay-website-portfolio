import { publishedPeriod } from "./lib/report-period.ts";
import manifest from "./data/static-manifest.json" with { type: "json" };
export function assetPath(url: URL): string | null {
  if (url.pathname.replace(/\/$/, "") === "/transparency" && url.search) {
    if (!url.searchParams.has("year") && !url.searchParams.has("term"))
      return "/transparency/index.html";
    const year = url.searchParams.get("year");
    const half = url.searchParams.get("term");
    const id = publishedPeriod(manifest.reports, year === null ? undefined : Number(year), half ?? undefined);
    return id
      ? `/_reports/${id}/index.html`
      : "/_reports/unavailable/index.html";
  }
  return (
    (manifest.routes as Record<string, string>)[url.pathname.replace(/\/$/, "") || "/"] ?? null
  );
}
export function protect(response: Response, released: boolean, admin: boolean, uploadSource = "") {
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
    `default-src 'self'; script-src 'self' ${scriptSources}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://*.supabase.co; media-src 'self'; connect-src 'self'${uploadSource}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`,
  );
  if (admin) {
    headers.set("Cache-Control", "no-store, private");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  } else if (!released) headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!admin && headers.get("content-type")?.includes("text/html"))
    headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
}
