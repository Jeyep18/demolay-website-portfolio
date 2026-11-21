import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { isMain, main } from "./backup-lib.mjs";

export async function generateBackupKeys(destination) {
  if (!destination) throw new Error("Missing offline destination directory");
  const path = resolve(destination);
  // mkdir without recursive refuses existing destinations, preventing accidental key replacement.
  await mkdir(path, { mode: 0o700 });
  if (process.platform === "win32") {
    try {
      // Directory inheritance protects every key before it is written, including on removable drives.
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
        $ErrorActionPreference = 'Stop';
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User;
        $acl = New-Object System.Security.AccessControl.DirectorySecurity;
        $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($sid);
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'));
        [System.IO.Directory]::SetAccessControl($env:DEMOLAY_KEY_DIRECTORY, $acl);
        $check = [System.IO.Directory]::GetAccessControl($env:DEMOLAY_KEY_DIRECTORY);
        $rules = @($check.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]));
        if (!$check.AreAccessRulesProtected -or $check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl' -or $rules[0].InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $rules[0].PropagationFlags -ne 'None') { throw 'Private directory ACL verification failed' }
      `,
        ],
        {
          env: { ...process.env, DEMOLAY_KEY_DIRECTORY: path },
          stdio: "ignore",
          windowsHide: true,
        },
      );
    } catch {
      throw new Error(
        "Destination does not support verified private Windows permissions. No keys were generated.",
      );
    }
  } else if (((await stat(path)).mode & 0o777) !== 0o700) {
    throw new Error(
      "Destination does not support private directory permissions. No keys were generated.",
    );
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await writeFile(join(path, "backup-public.pem"), publicKey, { flag: "wx", mode: 0o600 });
  await writeFile(join(path, "backup-private.pem"), privateKey, { flag: "wx", mode: 0o600 });
  await writeFile(join(path, "backup-index.key"), randomBytes(32).toString("base64"), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Keys created. Keep private key offline; copy only public key and index key into backup CI secrets.",
  );
}
if (isMain(import.meta.url)) await main(() => generateBackupKeys(process.argv[2]));
