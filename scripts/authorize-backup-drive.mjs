import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { bytes, checkedFetch, isMain } from "./backup-lib.mjs";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3/";
const safeValue = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._~+/=-]{1,4096}$/.test(value);

export function desktopClient(json) {
  const client = json?.installed;
  if (
    !client ||
    !safeValue(client.client_id) ||
    !client.client_id.endsWith(".apps.googleusercontent.com") ||
    !safeValue(client.client_secret) ||
    ![AUTH, "https://accounts.google.com/o/oauth2/auth"].includes(client.auth_uri) ||
    ![TOKEN, "https://accounts.google.com/o/oauth2/token"].includes(client.token_uri)
  ) {
    throw new Error(
      "Use the original Google Desktop OAuth client JSON with Google's standard endpoints.",
    );
  }
  return { client_id: client.client_id, client_secret: client.client_secret };
}
export function ownerEmail(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  )
    throw new Error("A valid expected owner email is required.");
  return value.toLowerCase();
}
export function authorizationUrl(clientId, email, redirect, state, verifier) {
  const callback = new URL(redirect);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    !callback.port ||
    callback.pathname !== "/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("Invalid loopback callback.");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    login_hint: ownerEmail(email),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${AUTH}?${query}`;
}
export function callbackCode(method, host, path, redirect, state) {
  const target = new URL(redirect);
  if (
    method !== "GET" ||
    host !== target.host ||
    typeof path !== "string" ||
    path.length > 8192 ||
    !path.startsWith("/callback?")
  )
    throw new Error("Invalid callback.");
  const url = new URL(path, redirect);
  const incoming = url.searchParams.get("state") ?? "";
  const actual = Buffer.from(incoming),
    expected = Buffer.from(state);
  if (
    url.origin !== target.origin ||
    url.pathname !== target.pathname ||
    url.hash ||
    url.searchParams.getAll("state").length !== 1 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new Error("Invalid callback state.");
  if (url.searchParams.has("error")) return { denied: true };
  const code = url.searchParams.get("code");
  if (
    url.searchParams.getAll("code").length !== 1 ||
    typeof code !== "string" ||
    !code ||
    code.length > 4096
  )
    throw new Error("Invalid authorization code.");
  return { code };
}
async function jsonRequest(url, options, request) {
  const response = await checkedFetch(url, options, request);
  return JSON.parse((await bytes(response, 64 * 1024)).toString());
}
export async function finishAuthorization(
  client,
  code,
  verifier,
  redirect,
  email,
  request = fetch,
) {
  const tokens = await jsonRequest(
    TOKEN,
    {
      method: "POST",
      body: new URLSearchParams({
        ...client,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    },
    request,
  );
  if (
    !safeValue(tokens.refresh_token) ||
    !safeValue(tokens.access_token) ||
    tokens.token_type?.toLowerCase() !== "bearer"
  )
    throw new Error(
      "Google did not return offline authorization. Repeat consent for this Desktop client.",
    );
  if (tokens.scope !== undefined && tokens.scope !== SCOPE)
    throw new Error("Google returned an unexpected scope. Use a dedicated backup OAuth client.");
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  // Drive about.get supports drive.file, avoiding an additional identity scope.
  const about = await jsonRequest(`${DRIVE}about?fields=user(emailAddress)`, { headers }, request);
  if (about?.user?.emailAddress?.toLowerCase() !== ownerEmail(email))
    throw new Error("The authorized Google account does not match the expected owner.");
  const folder = await jsonRequest(
    `${DRIVE}files?fields=id`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Naga Chapter website backups",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { application: "demolay-backup-v1" },
      }),
    },
    request,
  );
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(folder?.id ?? ""))
    throw new Error("Drive did not return a valid folder.");
  const permissions = await jsonRequest(
    `${DRIVE}files/${folder.id}/permissions?fields=nextPageToken,permissions(type,role,emailAddress)`,
    { headers },
    request,
  );
  if (
    permissions.nextPageToken ||
    permissions.permissions?.length !== 1 ||
    permissions.permissions[0].type !== "user" ||
    permissions.permissions[0].role !== "owner" ||
    permissions.permissions[0].emailAddress?.toLowerCase() !== ownerEmail(email)
  )
    throw new Error(
      "Backup folder privacy could not be verified. Inspect Drive permissions privately before retrying.",
    );
  return {
    BACKUP_GOOGLE_CLIENT_ID: client.client_id,
    BACKUP_GOOGLE_CLIENT_SECRET: client.client_secret,
    BACKUP_GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
    BACKUP_DRIVE_FOLDER_ID: folder.id,
  };
}
export async function reservePrivateOutput(output) {
  const parent = await realpath(dirname(resolve(output)));
  const destination = resolve(parent, basename(output));
  const home = await realpath(homedir());
  const insideHome = relative(home, destination);
  if (
    isAbsolute(insideHome) ||
    insideHome === ".." ||
    insideHome.startsWith(`..${sep}`) ||
    resolve(home, insideHome) !== destination
  )
    throw new Error("Save backup credentials in your own user directory.");
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: parent,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* Outside a repository is allowed. */
  }
  if (root) {
    try {
      execFileSync("git", ["check-ignore", "--", destination], { cwd: root, stdio: "ignore" });
      if (
        execFileSync("git", ["ls-files", "--", destination], { cwd: root, encoding: "utf8" }).trim()
      )
        throw new Error();
    } catch {
      throw new Error("Credential output must be ignored and untracked by Git.");
    }
  }
  let file = await open(destination, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      await file.close();
      // Set and read back a current-user-only DACL before writing any credentials.
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
        $ErrorActionPreference = 'Stop';
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User;
        $acl = New-Object System.Security.AccessControl.FileSecurity;
        $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($sid);
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'));
        [System.IO.File]::SetAccessControl($env:DEMOLAY_BACKUP_OUTPUT, $acl);
        $check = [System.IO.File]::GetAccessControl($env:DEMOLAY_BACKUP_OUTPUT);
        $rules = @($check.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]));
        if (!$check.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow') { throw 'Private ACL verification failed' }
      `,
        ],
        {
          env: { ...process.env, DEMOLAY_BACKUP_OUTPUT: destination },
          stdio: "ignore",
          windowsHide: true,
        },
      );
      file = await open(destination, "r+");
    } else if (((await file.stat()).mode & 0o077) !== 0)
      throw new Error("Private file permissions could not be verified.");
  } catch {
    await file.close();
    await unlink(destination);
    throw new Error("Could not secure the credential file. No credentials were written.");
  }
  return { file, destination };
}
export async function authorize(clientPath, expectedEmail, output) {
  const email = ownerEmail(expectedEmail);
  const source = await readFile(clientPath);
  if (source.length > 64 * 1024) throw new Error("OAuth client file is too large.");
  const client = desktopClient(JSON.parse(source.toString()));
  const { file, destination } = await reservePrivateOutput(output);
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  let saved = false,
    consumed = false,
    timer;
  const server = createServer();
  try {
    await new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", accept);
    });
    const redirect = `http://127.0.0.1:${server.address().port}/callback`;
    const code = await new Promise((accept, reject) => {
      timer = setTimeout(
        () => reject(new Error("Authorization timed out after ten minutes.")),
        600_000,
      );
      server.on("request", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        try {
          if (consumed) throw new Error("Authorization already received.");
          const result = callbackCode(req.method, req.headers.host, req.url, redirect, state);
          consumed = true;
          res.end(
            "<!doctype html><title>Backup authorization</title><p>Authorization received. Return to the terminal for the result.</p>",
          );
          if (result.denied) reject(new Error("Google authorization was declined."));
          else accept(result.code);
        } catch {
          res.statusCode = 400;
          res.end(
            "<!doctype html><title>Invalid callback</title><p>Invalid or expired authorization request.</p>",
          );
        }
      });
      console.log(
        "Open this Google authorization link in your browser. Use the expected owner account:",
      );
      console.log(authorizationUrl(client.client_id, email, redirect, state, verifier));
    });
    clearTimeout(timer);
    const credentials = await finishAuthorization(client, code, verifier, redirect, email);
    await file.writeFile(
      Object.entries(credentials)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
    await file.sync();
    saved = true;
    console.log(
      "Drive authorization saved in the private local output file. Keep it out of chat and source control.",
    );
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await file.close();
    if (!saved) await unlink(destination);
  }
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error(
      "Usage: node scripts/authorize-backup-drive.mjs <desktop-client.json> <owner-email> <ignored-output.env.local>",
    );
    process.exitCode = 1;
  } else {
    authorize(...args).catch(() => {
      console.error(
        "Drive setup failed. Check the Desktop client, owner account, private output permissions and OAuth consent privately. No credential details are logged.",
      );
      process.exitCode = 1;
    });
  }
}
