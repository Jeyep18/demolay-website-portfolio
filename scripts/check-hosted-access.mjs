import assert from "node:assert/strict";
const origin = new URL(process.env.SUPABASE_URL);
if (origin.protocol !== "https:") throw new Error("HTTPS project URL required.");
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!key?.startsWith("sb_publishable_")) throw new Error("Use a public publishable key.");
const headers = { apikey: key, "Content-Type": "application/json" };
const request = (path, options = {}) =>
  fetch(new URL(path, origin), { headers, ...options, signal: AbortSignal.timeout(15000) });
const snapshot = await request("/rest/v1/rpc/cms_public_snapshot", { method: "POST", body: "{}" });
assert.equal(snapshot.status, 200);
const data = await snapshot.json();
assert.deepEqual(Object.keys(data).sort(), ["content", "finance", "media", "revision"]);
for (const name of [
  "cms_session",
  "cms_staff_list",
  "cms_media_list",
  "cms_backup_status",
  "cms_rebuild_pending",
]) {
  const response = await request(`/rest/v1/rpc/${name}`, { method: "POST", body: "{}" });
  assert.equal(response.ok, false, `${name} must deny anonymous access`);
}
const privateTable = await request("/rest/v1/staff?select=*");
assert.equal(privateTable.ok, false);
for (const bucket of ["cms-originals", "cms-derivatives"]) {
  const response = await request(`/storage/v1/object/list/${bucket}`, {
    method: "POST",
    body: JSON.stringify({ prefix: "", limit: 10 }),
  });
  if (response.ok) assert.deepEqual(await response.json(), []);
}
const upload = await request("/storage/v1/object/public-assets/security-access-probe.txt", {
  method: "POST",
  body: "anonymous writes must fail",
  headers: { apikey: key, "Content-Type": "text/plain" },
});
assert.equal(upload.ok, false, "Legacy bucket must reject anonymous uploads");
console.log(
  "Hosted anonymous checks passed: public approved snapshot only; staff, private storage and legacy uploads denied.",
);
