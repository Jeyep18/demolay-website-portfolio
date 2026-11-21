import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type Api,
  Field,
  Notice,
  RemoteState,
  TextField,
  errorMessage,
  useRemote,
  useUnsaved,
} from "./shared";

type Staff = { id: string; email: string; role: "owner" | "editor"; active: boolean };
type Backup = {
  id: string;
  status: string;
  created_at: string;
  manifest_id: string | null;
  detail: string | null;
};

export function StaffManager({ api }: { api: Api }) {
  const list = useRemote<{ items: Staff[] }>(api, "/api/admin/staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [active, setActive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useUnsaved(dirty);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/admin/staff", { email: email.trim(), role, active });
      setDirty(false);
      setEmail("");
      setRole("editor");
      setActive(true);
      setNotice(
        "Staff access saved. Invited staff can sign in with their matching Google account.",
      );
      list.reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>Staff</h2>
          <p>
            Invite chapter staff by Google account email, or update an existing membership.
            Sensitive changes require recent authenticator verification.
          </p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>{email ? "Staff access" : "Invite or update staff"}</legend>
          <div className="admin-form-grid">
            <TextField
              label="Google account email"
              type="email"
              required
              value={email}
              maxLength={254}
              onChange={(value) => {
                setEmail(value);
                setDirty(true);
              }}
            />
            <Field label="Role" required>
              {(id) => (
                <select
                  id={id}
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
              )}
            </Field>
          </div>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => {
                setActive(event.target.checked);
                setDirty(true);
              }}
            />
            Active membership
          </label>
          <p className="admin-help">
            Owners can publish, manage staff and view backup status. The final active owner cannot
            be deactivated.
          </p>
          <div className="admin-actions">
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save staff access"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!dirty || window.confirm("Discard unsaved staff access changes?")) {
                  setEmail("");
                  setRole("editor");
                  setActive(true);
                  setDirty(false);
                }
              }}
            >
              Cancel
            </Button>
          </div>
        </fieldset>
      </form>
      <RemoteState {...list} retry={list.reload} />
      {list.data && (
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Membership</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((staff) => (
                <tr key={staff.email}>
                  <th scope="row">{staff.email}</th>
                  <td>{staff.role}</td>
                  <td>{staff.active ? "Active" : "Inactive"}</td>
                  <td>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !dirty ||
                          window.confirm("Discard unsaved changes and edit this member?")
                        ) {
                          setEmail(staff.email);
                          setRole(staff.role);
                          setActive(staff.active);
                          setDirty(false);
                        }
                      }}
                    >
                      Edit<span className="sr-only"> {staff.email}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.data.items.length && <p className="admin-empty">No staff records returned.</p>}
        </div>
      )}
    </section>
  );
}

export function BackupStatus({ api }: { api: Api }) {
  const backups = useRemote<{
    items: Backup[];
    rebuilds: { id: number; status: string; created_at: string; completed_at: string | null }[];
  }>(api, "/api/admin/backups");
  const successful = backups.data?.items
    .filter(
      (item) =>
        item.status === "success" || item.status === "succeeded" || item.status === "completed",
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const stale =
    !successful || Date.now() - new Date(successful.created_at).getTime() > 30 * 60 * 60 * 1000;
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>Backups</h2>
          <p>
            Check the recorded backup result. A successful backup does not by itself confirm that a
            restore has been tested.
          </p>
        </div>
        <Button variant="outline" onClick={backups.reload}>
          Refresh status
        </Button>
      </div>
      <RemoteState {...backups} retry={backups.reload} />
      {backups.data && (
        <>
          <h3>Website updates</h3>
          <p>
            Approved updates appear publicly after a successful website rebuild. Pending or failed
            updates require the publishing automation to complete.
          </p>
          {backups.data.rebuilds.length === 0 ? (
            <p>No approved updates are waiting or recorded.</p>
          ) : (
            <ul>
              {backups.data.rebuilds.map((update) => (
                <li key={update.id}>
                  Update {update.id}:{" "}
                  {update.status === "success"
                    ? "Live"
                    : update.status === "failure"
                      ? "Rebuild failed - contact the owner to retry publishing"
                      : "Waiting for website rebuild"}{" "}
                  - {new Date(update.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
          <h3>Backup recovery points</h3>
          <Notice error={stale}>
            {successful
              ? `Last successful backup: ${new Date(successful.created_at).toLocaleString()}.`
              : "No successful backup is recorded."}
            {stale &&
              " Backup status is missing or older than 30 hours. Check the backup automation before relying on recovery."}
          </Notice>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Status</th>
                  <th scope="col">Manifest</th>
                </tr>
              </thead>
              <tbody>
                {backups.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                    <td>{item.status}</td>
                    <td>{item.manifest_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
