import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateBackupKeys } from "../scripts/backup-keygen.mjs";

test("key generation verifies private directory permissions and all fixture keys inherit owner-only access", async () => {
  const parent = await mkdtemp(join(tmpdir(), "demolay-key-acl-test-"));
  const destination = join(parent, "fixture-offline-keys");
  try {
    await generateBackupKeys(destination);
    const names = await readdir(destination);
    assert.deepEqual(names.sort(), ["backup-index.key", "backup-private.pem", "backup-public.pem"]);
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
        $ErrorActionPreference = 'Stop';
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User;
        $directory = [System.IO.Directory]::GetAccessControl($env:DEMOLAY_TEST_KEYS);
        if (!$directory.AreAccessRulesProtected) { throw 'Directory inheritance is not protected' }
        foreach ($name in @('backup-private.pem', 'backup-index.key', 'backup-public.pem')) {
          $file = [System.IO.Path]::Combine($env:DEMOLAY_TEST_KEYS, $name);
          $acl = [System.IO.File]::GetAccessControl($file);
          $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]));
          if ($rules.Count -ne 1 -or !$rules[0].IsInherited -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'A key is accessible outside its owner' }
        }
      `,
        ],
        {
          env: { ...process.env, DEMOLAY_TEST_KEYS: destination },
          stdio: "pipe",
          windowsHide: true,
        },
      );
    } else {
      assert.equal((await stat(destination)).mode & 0o777, 0o700);
      for (const name of names)
        assert.equal((await stat(join(destination, name))).mode & 0o777, 0o600);
    }
    await assert.rejects(generateBackupKeys(destination), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(destination), parent);
    assert.equal(dirname(parent), tmpdir());
    await rm(parent, { recursive: true, force: true });
  }
});
