import { assetPath, protect } from "./static-response.ts";
import manifest from "./data/static-manifest.json" with { type: "json" };
import { installationVideoRange } from "./installation-video-range.ts";

type VisitorEnv = { ASSETS: { fetch(request: Request): Promise<Response> } };

export default {
  async fetch(request: Request, env: VisitorEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method))
      return protect(
        new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }),
        true,
        true,
      );
    const pathname = url.pathname.replace(/\/$/, "");
    const page =
      pathname === "/transparency" && manifest.reports.length === 0
        ? "/transparency/index.html"
        : assetPath(url);
    // Resolve only known public routes or files inside the visitor asset directories.
    // Never forward arbitrary HTML paths, encoded separators or staff namespaces.
    const file =
      /^\/(assets|images|media|fonts)\/(?:[\w.-]+\/)*[\w.-]+$/.test(url.pathname) ||
      ["/robots.txt", "/sitemap.xml", "/favicon.png"].includes(url.pathname);
    const publicPage =
      page && page !== "/404.html" && !/^\/(admin|oauth|_reports)(?:\/|$)/.test(pathname);
    if (!publicPage && !file) {
      url.pathname = "/404.html";
      url.search = "";
      const missing = await env.ASSETS.fetch(new Request(url, request));
      return protect(
        new Response(missing.body, { status: 404, headers: missing.headers }),
        true,
        true,
      );
    }
    if (publicPage) url.pathname = page;
    url.search = "";
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response =
      pathname === "/media/installation-highlight.mp4"
        ? installationVideoRange(
            request,
            asset,
            (manifest as { installationVideoBytes?: number }).installationVideoBytes,
          )
        : asset;
    return protect(response, true, !response.ok && response.status !== 304);
  },
};
