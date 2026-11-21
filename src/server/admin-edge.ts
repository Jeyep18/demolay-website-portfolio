import type { AdminEnv } from "./admin-api.ts";

export type AdminEdgeEnv = AdminEnv & {
  ADMIN_API_MODE?: string;
  ADMIN_EDGE_SECRET?: string;
  SUPABASE_GATEWAY_JWT?: string;
};
const fields = ["cookie", "origin", "x-csrf-token", "content-type"];
const encoder = new TextEncoder();
const RATE_PATH = "/api/internal/admin-edge-rate";
const unavailable = () =>
  Response.json(
    { error: "Administration is temporarily unavailable." },
    {
      status: 503,
      headers: { "Cache-Control": "no-store, private" },
    },
  );
class BridgeError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Admin bridge rejected request");
    this.status = status;
  }
}
const rejected = (status: number) =>
  Response.json(
    { error: "Administration request was not accepted." },
    {
      status,
      headers: { "Cache-Control": "no-store, private" },
    },
  );
function configured(env: AdminEdgeEnv) {
  if (
    !env.APP_ORIGIN ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32 ||
    !env.ADMIN_EDGE_SECRET ||
    env.ADMIN_EDGE_SECRET.length < 48
  )
    throw new BridgeError(503);
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN) throw new BridgeError(503);
  return origin.origin;
}
async function bytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new BridgeError(413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new BridgeError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
const maxBody = (path: string) =>
  path === "/api/admin/media/upload" ? 5 * 1024 * 1024 + 16384 : 256 * 1024;
const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function key(secret: string, usage: KeyUsage) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}
async function message(
  request: Request,
  digest: string,
  scope: string,
  url: string,
  ip: string,
  timestamp: string,
) {
  return encoder.encode(
    JSON.stringify([
      scope,
      request.method,
      url,
      ip,
      timestamp,
      ...fields.map((name) => request.headers.get(name) ?? ""),
      digest,
    ]),
  );
}
async function signed(
  request: Request,
  destination: string,
  env: AdminEdgeEnv,
  scope: string,
  ip: string,
  authorization?: string,
) {
  const body = await bytes(request, scope === "rate" ? 0 : maxBody(new URL(request.url).pathname));
  const digest = hex(await crypto.subtle.digest("SHA-256", body as BufferSource));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = hex(
    await crypto.subtle.sign(
      "HMAC",
      await key(env.ADMIN_EDGE_SECRET!, "sign"),
      await message(request, digest, scope, request.url, ip, timestamp),
    ),
  );
  const headers = new Headers();
  for (const name of fields) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-demolay-url", request.url);
  headers.set("x-demolay-ip", ip);
  headers.set("x-demolay-time", timestamp);
  headers.set("x-demolay-proof", signature);
  headers.set("x-demolay-digest", digest);
  if (authorization) headers.set("Authorization", `Bearer ${authorization}`);
  return new Request(destination, {
    method: request.method,
    headers,
    ...(body.length ? { body: body as BodyInit } : {}),
    redirect: "manual",
  });
}
async function verified(request: Request, env: AdminEdgeEnv, scope: string) {
  const origin = configured(env);
  const url = request.headers.get("x-demolay-url") ?? "";
  const ip = request.headers.get("x-demolay-ip") ?? "";
  const timestamp = request.headers.get("x-demolay-time") ?? "";
  const proof = request.headers.get("x-demolay-proof") ?? "";
  const digest = request.headers.get("x-demolay-digest") ?? "";
  const now = Math.floor(Date.now() / 1000);
  if (
    !/^\d{10}$/.test(timestamp) ||
    now - Number(timestamp) > 30 ||
    Number(timestamp) > now + 5 ||
    !/^[a-f0-9]{64}$/.test(proof) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !ip ||
    ip.length > 64 ||
    url.length > 8192
  )
    throw new BridgeError(403);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new BridgeError(403);
  }
  if (
    target.origin !== origin ||
    !target.pathname.startsWith("/api/") ||
    (scope === "rate" &&
      (target.pathname !== RATE_PATH || request.method !== "POST" || target.search)) ||
    (scope === "api" && target.pathname === RATE_PATH)
  )
    throw new BridgeError(403);
  const signature = Uint8Array.from(proof.match(/../g)!, (byte) => parseInt(byte, 16));
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      await key(env.ADMIN_EDGE_SECRET!, "verify"),
      signature,
      await message(request, digest, scope, url, ip, timestamp),
    ))
  )
    throw new BridgeError(403);
  const body = await bytes(request, scope === "rate" ? 0 : maxBody(target.pathname));
  if (hex(await crypto.subtle.digest("SHA-256", body as BufferSource)) !== digest)
    throw new BridgeError(403);
  const headers = new Headers();
  for (const name of fields) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("CF-Connecting-IP", ip);
  return new Request(url, {
    method: request.method,
    headers,
    ...(body.length ? { body: body as BodyInit } : {}),
  });
}
async function allowed(env: AdminEdgeEnv, ip: string, prefix = "") {
  if (!env.AUTH_LIMITER || !env.SESSION_SECRET) throw new BridgeError(503);
  const digest = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(ip + env.SESSION_SECRET)),
  );
  return (await env.AUTH_LIMITER.limit({ key: prefix + digest })).success;
}
function gateway(env: AdminEdgeEnv) {
  const token = env.SUPABASE_GATEWAY_JWT ?? env.SUPABASE_PUBLISHABLE_KEY ?? "";
  try {
    const claims = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.role !== "anon") throw new Error();
  } catch {
    throw new BridgeError(503);
  }
  return token;
}
export async function dispatchAdmin(request: Request, env: AdminEdgeEnv): Promise<Response> {
  if (!env.ADMIN_API_MODE || env.ADMIN_API_MODE === "local") {
    const { handleAdminApi } = await import("./admin-api.ts");
    return handleAdminApi(request, env);
  }
  if (env.ADMIN_API_MODE !== "edge") return unavailable();
  try {
    const origin = configured(env);
    if (new URL(request.url).origin !== origin) throw new BridgeError(403);
    if (!["GET", "POST"].includes(request.method)) throw new BridgeError(405);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await allowed(env, ip))) throw new BridgeError(429);
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL ?? ""))
      throw new BridgeError(503);
    const upstream = await signed(
      request,
      `${env.SUPABASE_URL}/functions/v1/cms-admin`,
      env,
      "api",
      ip,
      gateway(env),
    );
    // Redirects include OAuth handoffs and must be returned to the browser without following them.
    return await fetch(upstream, { redirect: "manual", signal: AbortSignal.timeout(35000) });
  } catch (error) {
    return error instanceof BridgeError ? rejected(error.status) : unavailable();
  }
}
export async function handleEdgeRate(request: Request, env: AdminEdgeEnv): Promise<Response> {
  try {
    if (env.ADMIN_API_MODE !== "edge") throw new BridgeError(403);
    const original = await verified(request, env, "rate");
    const success = await allowed(env, original.headers.get("CF-Connecting-IP")!, "edge:");
    return Response.json(
      { success },
      { status: success ? 200 : 429, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    return error instanceof BridgeError ? rejected(error.status) : unavailable();
  }
}
export async function handleAdminEdge(
  request: Request,
  env: AdminEdgeEnv,
  handler: (request: Request, env: AdminEnv) => Promise<Response>,
): Promise<Response> {
  try {
    const original = await verified(request, env, "api");
    const callback = await signed(
      new Request(`${env.APP_ORIGIN}${RATE_PATH}`, { method: "POST" }),
      `${env.APP_ORIGIN}${RATE_PATH}`,
      env,
      "rate",
      original.headers.get("CF-Connecting-IP")!,
    );
    const rate = await fetch(callback, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (rate.status === 429) throw new BridgeError(429);
    if (rate.status !== 200 || (await rate.json()).success !== true) throw new BridgeError(503);
    // Every invocation, including a replayed envelope, consumes the shared Worker rate quota.
    return await handler(original, {
      ...env,
      AUTH_LIMITER: { limit: async () => ({ success: true }) },
    });
  } catch (error) {
    return error instanceof BridgeError ? rejected(error.status) : unavailable();
  }
}
