import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import {
  actionSchema,
  contentKindSchema,
  saveContentSchema,
  saveFinanceSchema,
  publishFinanceSchema,
  staffSchema,
} from "../lib/cms-schema.ts";

export type AdminEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  APP_ORIGIN?: string;
  SESSION_SECRET?: string;
  AUTH_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
};
const SESSION_SECONDS = 8 * 60 * 60;
const IDLE_SECONDS = 30 * 60;
const MAX_JSON = 256 * 1024;
const encoder = new TextEncoder();
const secureHeaders = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: secureHeaders });
class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function cookiesFrom(request: Request): { name: string; value: string }[] {
  return (request.headers.get("cookie") ?? "").split(";").flatMap((piece) => {
    const at = piece.indexOf("=");
    if (at < 1) return [];
    try {
      return [{ name: piece.slice(0, at).trim(), value: decodeURIComponent(piece.slice(at + 1)) }];
    } catch {
      return [];
    }
  });
}
export function validMutation(request: Request, origin: string, csrf: string | undefined): boolean {
  return (
    request.headers.get("origin") === origin &&
    !!csrf &&
    csrf.length >= 32 &&
    request.headers.get("X-CSRF-Token") === csrf
  );
}
export async function boundedJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    throw new ApiError(415, "Send this form as JSON.");
  const bytes = await limitedBody(request, MAX_JSON);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "The form could not be read. Reload and try again.");
  }
}
async function limitedBody(request: Request, max: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > max)
    throw new ApiError(413, "This upload or form is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(413, "This upload or form is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function windowCookie(
  value: string | undefined,
  signature: (value: string) => Promise<string>,
): Promise<{ start: number; last: number } | null> {
  if (!value) return null;
  const [start, last, mac] = value.split(".");
  const payload = `${start}.${last}`;
  if (!mac || !/^\d+\.\d+$/.test(payload)) return null;
  const expected = await signature(payload);
  let diff = mac.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
  const now = Math.floor(Date.now() / 1000);
  const result = { start: Number(start), last: Number(last) };
  return diff === 0 &&
    now >= result.last &&
    result.last >= result.start &&
    now - result.start < SESSION_SECONDS &&
    now - result.last < IDLE_SECONDS
    ? result
    : null;
}
const rpcError = (error: { code?: string } | null) => {
  if (!error) return;
  const status =
    error.code === "P0001"
      ? 429
      : error.code === "42501"
        ? 403
        : error.code === "PT409" || error.code === "40001"
          ? 409
          : ["22023", "23514", "23503", "23505"].includes(error.code ?? "")
            ? 400
            : 503;
  const message =
    status === 429
      ? "Too many changes. Wait a minute before trying again."
      : status === 403
        ? "Access denied. Confirm your invitation and verify your authenticator again for sensitive changes."
        : status === 409
          ? "Someone changed this draft. Reload it before saving or publishing."
          : status === 400
            ? "Check required fields, unique names, linked records and financial balances."
            : "The service is unavailable. Your changes have not been confirmed; please try again.";
  throw new ApiError(status, message);
};
const items = (data: unknown) => (Array.isArray(data) ? { items: data } : data);

export async function handleAdminApi(request: Request, env: AdminEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return json({ error: "Not found." }, 404);
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLISHABLE_KEY ||
    !env.APP_ORIGIN ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  )
    return json(
      {
        configured: false,
        error: "Administration is not configured. The site owner must complete the secure setup.",
      },
      503,
    );
  const origin = new URL(env.APP_ORIGIN).origin;
  if (url.origin !== origin)
    return json({ error: "This address is not approved for administration." }, 403);
  const secure = url.protocol === "https:";
  if (!secure && !["localhost", "127.0.0.1"].includes(url.hostname))
    return json({ error: "A secure connection is required." }, 403);
  if (secure && !env.AUTH_LIMITER)
    return json({ error: "Administration security controls are not configured." }, 503);
  if (env.AUTH_LIMITER) {
    const address = request.headers.get("CF-Connecting-IP") ?? "local";
    const key = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(address + env.SESSION_SECRET)),
      ),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (!(await env.AUTH_LIMITER.limit({ key })).success)
      return json({ error: "Too many requests. Wait a minute before trying again." }, 429);
  }
  const prefix = secure ? "__Host-demolay" : "demolay";
  let signingKey: Promise<CryptoKey> | undefined;
  const signature = async (value: string) => {
    const key = await (signingKey ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ));
    return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  };
  const requestCookies = cookiesFrom(request);
  const getCookie = (name: string) =>
    requestCookies.find((c) => c.name === `${prefix}-${name}`)?.value;
  const pending: string[] = [];
  const cookie = (name: string, value: string, age: number) =>
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const set = (name: string, value: string, age = SESSION_SECONDS) =>
    pending.push(cookie(`${prefix}-${name}`, value, age));
  const done = (response: Response) => {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(secureHeaders)) headers.set(key, value);
    for (const value of pending) headers.append("Set-Cookie", value);
    return new Response(response.body, { status: response.status, headers });
  };
  const client = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: {
      name: `${prefix}-auth`,
      path: "/",
      secure,
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_SECONDS,
    },
    cookies: {
      getAll: () => requestCookies,
      setAll: (values) => {
        for (const value of values) {
          pending.push(
            cookie(value.name, value.value, value.options.maxAge === 0 ? 0 : SESSION_SECONDS),
          );
          const old = requestCookies.find((c) => c.name === value.name);
          if (old) old.value = value.value;
          else requestCookies.push({ name: value.name, value: value.value });
        }
      },
    },
  });
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    rpcError(error);
    return data;
  };
  try {
    if (path === "/api/public/snapshot" && request.method === "GET")
      return done(json(await rpc("cms_public_snapshot")));
    if (path === "/api/auth/google" && request.method === "GET") {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${origin}/api/auth/callback`, skipBrowserRedirect: true },
      });
      if (error || !data.url)
        throw new ApiError(503, "Google sign-in is unavailable. Contact the site owner.");
      return done(new Response(null, { status: 302, headers: { Location: data.url } }));
    }
    if (path === "/api/auth/callback" && request.method === "GET") {
      if (url.searchParams.has("error"))
        throw new ApiError(
          401,
          "Google sign-in was declined. If you are invited, contact the chapter owner or start again from the admin page.",
        );
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048)
        throw new ApiError(400, "Sign-in expired. Start again from the admin page.");
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error)
        throw new ApiError(
          401,
          "Sign-in expired or was declined. Start again from the admin page.",
        );
      const staff = await rpc("cms_session");
      if (!staff?.active) {
        await client.auth.signOut();
        throw new ApiError(403, "This Google account has not been invited.");
      }
      const now = Math.floor(Date.now() / 1000);
      const value = `${now}.${now}`;
      set("window", `${value}.${await signature(value)}`);
      set("csrf", crypto.randomUUID() + crypto.randomUUID());
      return done(new Response(null, { status: 303, headers: { Location: `${origin}/admin` } }));
    }
    const window = await windowCookie(getCookie("window"), signature);
    if (!window) {
      set("window", "", 0);
      throw new ApiError(401, "Your session expired. Sign in again.");
    }
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) throw new ApiError(401, "Sign in to administer the website.");
    const csrf = getCookie("csrf") ?? crypto.randomUUID() + crypto.randomUUID();
    const renewWindow = async () => {
      if (!getCookie("csrf")) set("csrf", csrf);
      const value = `${window.start}.${Math.floor(Date.now() / 1000)}`;
      set("window", `${value}.${await signature(value)}`);
    };
    if (path === "/api/admin/content" && request.method === "GET") {
      // cms_list enforces live staff, session and verified TOTP checks before returning data.
      const data = await rpc("cms_list", {
        p_kind: contentKindSchema.parse(url.searchParams.get("kind") ?? "event"),
        p_query: (url.searchParams.get("q") ?? "").slice(0, 100),
        p_page: z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(url.searchParams.get("page") ?? 1),
      });
      await renewWindow();
      return done(json(data));
    }
    const staff = await rpc("cms_session");
    if (!staff?.active)
      throw new ApiError(403, "Your staff access is unavailable. Contact the owner.");
    await renewWindow();
    if (request.method !== "GET" && request.method !== "POST")
      throw new ApiError(405, "This action is not supported.");
    if (request.method === "POST" && !validMutation(request, origin, csrf))
      throw new ApiError(
        403,
        "This form expired or came from another website. Reload and try again.",
      );
    if (path === "/api/admin/session" && request.method === "GET")
      return done(json({ ...staff, configured: true, csrfToken: csrf }));
    if (path === "/api/auth/logout" && request.method === "POST") {
      await client.auth.signOut();
      set("window", "", 0);
      set("csrf", "", 0);
      return done(json({ success: true }));
    }
    if (path === "/api/auth/mfa" && request.method === "GET") {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw new ApiError(503, "Authenticator status could not be loaded.");
      return done(json({ factors: data.all, aal: staff.aal }));
    }
    if (path === "/api/auth/mfa/restart" && request.method === "POST") {
      const { factorId } = z
        .object({ factorId: z.string().uuid() })
        .strict()
        .parse(await boundedJson(request));
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw new ApiError(503, "Authenticator status could not be loaded.");
      const factor = data.all.find((item) => item.id === factorId);
      if (!factor || factor.factor_type !== "totp" || factor.status !== "unverified")
        throw new ApiError(409, "Only an unfinished authenticator setup can be restarted.");
      const { error: removeError } = await client.auth.mfa.unenroll({ factorId });
      if (removeError) throw new ApiError(400, "Authenticator setup could not be restarted.");
      return done(json({ success: true }));
    }
    if (path === "/api/auth/mfa/enroll" && request.method === "POST") {
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Chapter administration",
      });
      if (error)
        throw new ApiError(
          400,
          "An authenticator could not be added. Check your existing enrollment or contact the owner.",
        );
      return done(json({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }));
    }
    if (path === "/api/auth/mfa/verify" && request.method === "POST") {
      const body = z
        .object({ factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(await boundedJson(request));
      const { error } = await client.auth.mfa.challengeAndVerify({
        factorId: body.factorId,
        code: body.code,
      });
      if (error)
        throw new ApiError(
          400,
          "That authenticator code was not accepted. Use the current six-digit code.",
        );
      return done(json({ success: true }));
    }
    if (staff.aal !== "aal2")
      throw new ApiError(403, "Verify your authenticator before opening administration.");
    if (request.method === "GET") {
      const lists: Record<string, string> = {
        "/api/admin/finance": "cms_finance_list",
        "/api/admin/staff": "cms_staff_list",
        "/api/admin/media": "cms_media_list",
        "/api/admin/backups": "cms_backup_status",
      };
      if (lists[path]) return done(json(items(await rpc(lists[path]))));
      if (path === "/api/admin/media/preview") {
        const id = z.string().uuid().parse(url.searchParams.get("id"));
        const media = items(await rpc("cms_media_list")) as {
          items: { id: string; derivative_path: string }[];
        };
        const found = media.items.find((m) => m.id === id);
        if (!found) throw new ApiError(404, "Image not found.");
        const { data, error } = await client.storage
          .from("cms-derivatives")
          .download(found.derivative_path);
        if (error || !data) throw new ApiError(404, "Image not found.");
        return done(new Response(data, { headers: { "Content-Type": "image/webp" } }));
      }
    }
    const imageAction = async (body: Record<string, unknown>) => {
      const {
        data: { session },
      } = await client.auth.getSession();
      return fetch(`${env.SUPABASE_URL}/functions/v1/cms-images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: env.SUPABASE_PUBLISHABLE_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    };
    if (request.method === "POST") {
      if (path === "/api/admin/media/upload") {
        const body = await limitedBody(request, 5 * 1024 * 1024 + 16384);
        const {
          data: { session },
        } = await client.auth.getSession();
        const upload = await fetch(`${env.SUPABASE_URL}/functions/v1/cms-images`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": request.headers.get("content-type") ?? "",
          },
          body: body as BodyInit,
          signal: AbortSignal.timeout(30000),
        });
        if (!upload.ok)
          throw new ApiError(
            upload.status >= 500 ? 503 : 400,
            "The image could not be uploaded. Use JPEG, PNG or WebP up to 5 MiB and 20 megapixels, with alt text and publication rights confirmed.",
          );
        return done(json(await upload.json()));
      }
      const body = await boundedJson(request);
      if (path === "/api/admin/content") {
        const b = saveContentSchema.parse(body);
        return done(
          json(
            await rpc("cms_save", {
              p_id: b.id ?? null,
              p_kind: b.kind,
              p_slug: b.slug,
              p_title: b.title,
              p_payload: b.payload,
              p_media_ids: b.mediaIds,
              p_expected_version: b.expectedVersion ?? null,
            }),
          ),
        );
      }
      if (path === "/api/admin/content/action") {
        const b = actionSchema.parse(body);
        if (b.action === "publish") {
          const promoted = await imageAction({
            action: "promote",
            contentId: b.id,
            expectedVersion: b.expectedVersion,
          });
          if (!promoted.ok)
            throw new ApiError(
              promoted.status === 403 ? 403 : 503,
              "Publication could not be prepared. Verify your authenticator, check the images, and try again.",
            );
        }
        const result = await rpc("cms_transition", {
          p_id: b.id,
          p_expected_version: b.expectedVersion,
          p_action: b.action,
          p_reason: b.reason,
        });
        if (b.action === "archive") {
          try {
            const retired = await imageAction({ action: "retire", contentId: b.id });
            if (!retired.ok) throw new Error("Retirement incomplete");
          } catch {
            return done(
              json({
                ...result,
                warning:
                  "Archived. Public image removal is incomplete; retry image cleanup. Previously downloaded copies cannot be recalled. The public page changes after the next successful website rebuild.",
              }),
            );
          }
        }
        return done(json(result));
      }
      if (path === "/api/admin/media/retire") {
        const b = z.object({ contentId: z.string().uuid() }).strict().parse(body);
        const retired = await imageAction({ action: "retire", contentId: b.contentId });
        if (!retired.ok)
          throw new ApiError(
            retired.status === 403 ? 403 : 503,
            "Public image removal is incomplete. Verify your authenticator and retry cleanup.",
          );
        return done(json({ success: true }));
      }
      if (path === "/api/admin/finance") {
        const b = saveFinanceSchema.parse(body);
        return done(
          json(
            await rpc("cms_finance_save", {
              p_payload: b.payload,
              p_expected_version: b.expectedVersion ?? null,
            }),
          ),
        );
      }
      if (path === "/api/admin/finance/publish") {
        const b = publishFinanceSchema.parse(body);
        return done(
          json(
            await rpc("cms_finance_publish", {
              p_term_id: b.termId,
              p_expected_version: b.expectedVersion,
              p_reason: b.reason,
            }),
          ),
        );
      }
      if (path === "/api/admin/staff") {
        const b = staffSchema.parse(body);
        return done(
          json(
            await rpc("cms_staff_save", { p_email: b.email, p_role: b.role, p_active: b.active }),
          ),
        );
      }
    }
    return done(json({ error: "Not found." }, 404));
  } catch (error) {
    if (error instanceof z.ZodError)
      return done(
        json(
          {
            error: error.issues
              .map((i) => `${i.path.join(" · ")}: ${i.message}`)
              .join("; ")
              .slice(0, 1000),
          },
          400,
        ),
      );
    if (error instanceof ApiError) return done(json({ error: error.message }, error.status));
    return done(
      json(
        {
          error:
            "The service is unavailable. Please retry; no successful change has been confirmed.",
        },
        503,
      ),
    );
  }
}
