import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  authorizationUrl,
  callbackCode,
  desktopClient,
  finishAuthorization,
  ownerEmail,
  reservePrivateOutput,
} from "../scripts/authorize-backup-drive.mjs";

const client = { client_id: "example.apps.googleusercontent.com", client_secret: "example-secret" };
const redirect = "http://127.0.0.1:54321/callback";
const email = "owner@example.com";
test("dedicated Desktop client and exact loopback URL request only offline drive.file with PKCE", () => {
  assert.deepEqual(
    desktopClient({
      installed: {
        ...client,
        auth_uri: "https://accounts.google.com/o/oauth2/v2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    }),
    client,
  );
  assert.throws(() => desktopClient({ web: client }));
  assert.deepEqual(
    desktopClient({
      installed: {
        ...client,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://accounts.google.com/o/oauth2/token",
      },
    }),
    client,
  );
  assert.throws(() =>
    desktopClient({
      installed: {
        ...client,
        auth_uri: "https://evil.example",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    }),
  );
  const url = new URL(authorizationUrl(client.client_id, email, redirect, "state", "verifier"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent select_account");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.notEqual(url.searchParams.get("code_challenge"), "verifier");
  assert.throws(() =>
    authorizationUrl(client.client_id, email, "https://evil.example/callback", "state", "verifier"),
  );
  assert.throws(() => ownerEmail("owner@example.com\nTOKEN=leak"));
});
test("callback checks exact host, method, path, unique state/code and never follows redirects", () => {
  const valid = "/callback?state=state&code=one-use-code";
  assert.deepEqual(callbackCode("GET", "127.0.0.1:54321", valid, redirect, "state"), {
    code: "one-use-code",
  });
  for (const [method, host, path] of [
    ["POST", "127.0.0.1:54321", valid],
    ["GET", "evil.example", valid],
    ["GET", "127.0.0.1:54321", "//evil.example/callback?state=state&code=x"],
    ["GET", "127.0.0.1:54321", `${valid}&state=state`],
    ["GET", "127.0.0.1:54321", `${valid}&code=other`],
    ["GET", "127.0.0.1:54321", "/callback?state=wrong&code=x"],
  ])
    assert.throws(() => callbackCode(method, host, path, redirect, "state"));
  assert.deepEqual(
    callbackCode(
      "GET",
      "127.0.0.1:54321",
      "/callback?state=state&error=access_denied",
      redirect,
      "state",
    ),
    { denied: true },
  );
});
const response = (json) => new Response(JSON.stringify(json));
function fakeGoogle({
  owner = email,
  refresh = "offline-token",
  permission = "owner",
  scope = "https://www.googleapis.com/auth/drive.file",
} = {}) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      if (url === "https://oauth2.googleapis.com/token")
        return response({
          access_token: "access-token",
          refresh_token: refresh,
          token_type: "Bearer",
          scope,
        });
      if (url.includes("/about?")) return response({ user: { emailAddress: owner } });
      if (url.includes("/permissions?"))
        return response({ permissions: [{ type: "user", role: permission, emailAddress: owner }] });
      return response({ id: "private-folder" });
    },
  };
}
test("owner is checked before private folder creation; secrets are returned only for a verified private folder", async () => {
  const fake = fakeGoogle();
  const result = await finishAuthorization(
    client,
    "code",
    "verifier",
    redirect,
    email,
    fake.request,
  );
  assert.deepEqual(Object.keys(result), [
    "BACKUP_GOOGLE_CLIENT_ID",
    "BACKUP_GOOGLE_CLIENT_SECRET",
    "BACKUP_GOOGLE_REFRESH_TOKEN",
    "BACKUP_DRIVE_FOLDER_ID",
  ]);
  assert.equal(result.BACKUP_DRIVE_FOLDER_ID, "private-folder");
  assert.equal(fake.calls[0].options.body.get("code_verifier"), "verifier");
  assert.ok(fake.calls.every(({ options }) => options.redirect === "error"));
  const wrong = fakeGoogle({ owner: "outsider@example.com" });
  await assert.rejects(
    finishAuthorization(client, "code", "verifier", redirect, email, wrong.request),
    /expected owner/,
  );
  assert.equal(wrong.calls.length, 2);
  for (const settings of [
    { refresh: undefined },
    { permission: "writer" },
    { scope: "https://www.googleapis.com/auth/drive" },
  ]) {
    const bad = fakeGoogle(
      settings.refresh === undefined && "refresh" in settings ? { refresh: "" } : settings,
    );
    await assert.rejects(
      finishAuthorization(client, "code", "verifier", redirect, email, bad.request),
    );
  }
});
test("tracked output is refused before credentials are written", async () => {
  await assert.rejects(reservePrivateOutput("package.json"), /ignored and untracked/);
});
test("private output is reserved empty with verified permissions and refuses replacement", async () => {
  const directory = await mkdtemp(join(homedir(), ".demolay-drive-test-"));
  try {
    const output = join(directory, "credentials.env.local");
    const { file } = await reservePrivateOutput(output);
    await file.close();
    assert.equal((await readFile(output)).length, 0);
    await assert.rejects(reservePrivateOutput(output), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(directory), homedir());
    await rm(directory, { recursive: true, force: true });
  }
});
