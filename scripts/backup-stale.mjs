import { required, verifyIndex, driveClient, checkedFetch, isMain, main } from "./backup-lib.mjs";

export async function checkStale(drive, secret, now = Date.now()) {
  const files = (await drive.list()).filter((file) => file.appProperties.kind === "index");
  const valid = [];
  for (const file of files) valid.push(verifyIndex(await drive.get(file.id), secret));
  const newest = valid.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (
    !newest ||
    now - Date.parse(newest.createdAt) > 30 * 3600_000 ||
    Date.parse(newest.createdAt) > now + 300_000
  )
    throw new Error("No completed backup within 30 hours");
  // Check that the recovery point and all referenced encrypted objects still exist.
  const present = new Set((await drive.list()).map((file) => file.id));
  if (![newest.manifestId, ...newest.refs].every((id) => present.has(id)))
    throw new Error("Completed backup has missing files");
  return newest;
}
if (isMain(import.meta.url))
  await main(async () => {
    await checkStale(await driveClient(process.env), required(process.env, "BACKUP_INDEX_KEY"));
    await checkedFetch(required(process.env, "BACKUP_STALE_HEARTBEAT_URL"), {
      method: "POST",
      body: "Recent complete backup found",
    });
    console.log("Latest completed encrypted backup is within 30 hours.");
  });
