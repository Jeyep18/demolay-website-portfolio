import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeQrDataUri } from "./qr";
import { type Api, Field, Notice, RemoteState, errorMessage, useRemote } from "./shared";

type Factor = { id: string; status: string; factor_type: string };
type Enrollment = { id: string; qr: string; secret: string };

export function MfaPanel({ api, verified }: { api: Api; verified: () => void }) {
  const factors = useRemote<{ factors: Factor[]; aal: string }>(api, "/api/auth/mfa");
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const existing =
    factors.data?.factors.filter(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    ) || [];
  const pending =
    factors.data?.factors.filter(
      (factor) => factor.factor_type === "totp" && factor.status === "unverified",
    ) || [];
  const available = existing.length ? existing : pending;
  const qrSource = enrollment ? safeQrDataUri(enrollment.qr) : undefined;
  async function enroll(restartId?: string) {
    setBusy(true);
    setError("");
    try {
      if (restartId) await api("/api/auth/mfa/restart", { factorId: restartId });
      const result = await api<Enrollment>("/api/auth/mfa/enroll", {});
      setEnrollment(result);
      setFactorId(result.id);
    } catch (cause) {
      setError(errorMessage(cause));
      factors.reload();
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/mfa/verify", {
        factorId: enrollment?.id || factorId || available[0]?.id,
        code,
      });
      setCode("");
      setEnrollment(undefined);
      verified();
    } catch (cause) {
      setCode("");
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-mfa">
      <h2>Verify your authenticator</h2>
      <p>
        Administration requires a six-digit code from your authenticator app. Owners also verify
        again before sensitive actions.
      </p>
      <RemoteState {...factors} retry={factors.reload} />
      {error && <Notice error>{error}</Notice>}
      {factors.data && (
        <>
          {!existing.length && !pending.length && !enrollment && (
            <>
              <p>Set up an authenticator app to finish securing your chapter account.</p>
              <Button disabled={busy} onClick={() => enroll()}>
                {busy ? "Preparing…" : "Set up authenticator"}
              </Button>
            </>
          )}
          {!existing.length && pending.length > 0 && !enrollment && (
            <>
              <p>
                Your authenticator setup is unfinished. If you already scanned its QR, enter its
                code below. If you never scanned it, restart setup to get a new QR. The previous
                setup key will stop working.
              </p>
              <Button disabled={busy} onClick={() => enroll(factorId || pending[0]?.id)}>
                {busy ? "Preparing…" : "Restart unfinished setup"}
              </Button>
            </>
          )}
          {enrollment && (
            <div className="admin-enrollment">
              <h3>Connect your authenticator</h3>
              <p>
                Scan this code in your authenticator app, or enter the setup key manually. Keep this
                key private.
              </p>
              {qrSource ? (
                <img src={qrSource} alt="Authenticator setup QR code" width={220} height={220} />
              ) : (
                <Notice error>
                  The QR image could not be displayed safely. Use the setup key below.
                </Notice>
              )}
              <Field label="Authenticator setup key">
                {(id) => <Input id={id} value={enrollment.secret} readOnly autoComplete="off" />}
              </Field>
            </div>
          )}
          {(enrollment || available.length > 0) && (
            <form onSubmit={verify}>
              {available.length > 1 && !enrollment && (
                <Field label="Authenticator" required>
                  {(id) => (
                    <select
                      id={id}
                      value={factorId || available[0]?.id}
                      onChange={(event) => setFactorId(event.target.value)}
                    >
                      {available.map((factor, index) => (
                        <option key={factor.id} value={factor.id}>
                          Authenticator {index + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field label="Six-digit authenticator code" required>
                {(id) => (
                  <Input
                    id={id}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  />
                )}
              </Field>
              <Button type="submit" disabled={busy || !/^\d{6}$/.test(code)}>
                {busy ? "Verifying…" : "Verify code"}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
