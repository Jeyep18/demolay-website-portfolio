import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { handleAdminApi } from "../src/server/admin-api.ts";

test("MFA restart removes only the signed-in user's unfinished TOTP factor", async () => {
  const now = Math.floor(Date.now() / 1000);
  const factorId = "00000000-0000-4000-8000-000000000002";
  const user = { id: "00000000-0000-4000-8000-000000000001", factors: [] };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: now + 3600 })}.fixture`,
    refresh_token: "fixture",
    expires_at: now + 3600,
    user,
  };
  const secret = "s".repeat(48),
    csrf = "c".repeat(64),
    window = `${now}.${now}`;
  const signature = createHmac("sha256", secret).update(window).digest("hex");
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test",
    SESSION_SECRET: secret,
    APP_ORIGIN: "https://chapter.example",
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
  };
  const originalFetch = globalThis.fetch;
  let removed = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    if (url.pathname === "/rest/v1/rpc/cms_session")
      return Response.json({ active: true, role: "owner", aal: "aal1" });
    assert.equal(init.method, "DELETE");
    assert.equal(url.pathname, `/auth/v1/factors/${factorId}`);
    removed.push(factorId);
    return Response.json({ id: factorId });
  };
  const restart = (body = { factorId }) =>
    handleAdminApi(
      new Request(config.APP_ORIGIN + "/api/auth/mfa/restart", {
        method: "POST",
        headers: {
          origin: config.APP_ORIGIN,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          cookie: `__Host-demolay-auth=base64-${encode(session)}; __Host-demolay-window=${window}.${signature}; __Host-demolay-csrf=${csrf}`,
        },
        body: JSON.stringify(body),
      }),
      config,
    );
  try {
    for (const factors of [
      [],
      [{ id: factorId, factor_type: "totp", status: "verified" }],
      [{ id: factorId, factor_type: "phone", status: "unverified" }],
      [{ id: "00000000-0000-4000-8000-000000000003", factor_type: "totp", status: "unverified" }],
    ]) {
      user.factors = factors;
      assert.equal((await restart()).status, 409);
      assert.deepEqual(removed, []);
    }
    assert.equal((await restart({ factorId: "invalid" })).status, 400);
    assert.deepEqual(removed, []);
    user.factors = [{ id: factorId, factor_type: "totp", status: "unverified" }];
    assert.equal((await restart()).status, 200);
    assert.deepEqual(removed, [factorId]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
