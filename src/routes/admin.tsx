import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  Newspaper,
  Landmark,
  Wallet,
  Images,
  Settings,
  Users,
  ShieldCheck,
  Archive,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ContentManager } from "@/components/admin/ContentManager";
import { FinanceManager } from "@/components/admin/FinanceManager";
import { MediaManager } from "@/components/admin/MediaManager";
import { MfaPanel } from "@/components/admin/MfaPanel";
import { BackupStatus, StaffManager } from "@/components/admin/OwnerTools";
import {
  ApiError,
  Notice,
  UnsavedContext,
  apiMessage,
  type Api,
  type Session,
} from "@/components/admin/shared";
import adminCss from "../admin.css?url";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Chapter administration · Naga City Chapter" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  component: AdminPage,
});

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "articles", label: "Articles", icon: Newspaper },
  { id: "history", label: "History & officers", icon: Landmark },
  { id: "finance", label: "Finances", icon: Wallet },
  { id: "media", label: "Media", icon: Images },
  { id: "settings", label: "Chapter settings", icon: Settings },
  { id: "staff", label: "Staff", icon: Users, owner: true },
  { id: "policies", label: "Policies", icon: ShieldCheck, owner: true },
  { id: "backups", label: "Backups", icon: Archive, owner: true },
];

function AdminPage() {
  const [session, setSession] = useState<Session>();
  const [status, setStatus] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [section, setSection] = useState("overview");
  const [historyKind, setHistoryKind] = useState<"history" | "officer">("history");
  const [menu, setMenu] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [expired, setExpired] = useState(false);
  const loadSession = useCallback(async () => {
    setSessionError("");
    try {
      const response = await fetch("/api/admin/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        setStatus(response.status);
        setSession(undefined);
        return;
      }
      const next = (await response.json()) as Session;
      if (!next.configured || !next.active || !next.csrfToken) {
        setStatus(next.configured ? 403 : 503);
        setSession(undefined);
        return;
      }
      setSession(next);
      setExpired(false);
      setStatus(undefined);
    } catch {
      setSessionError(
        "The administration service could not be reached. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  const api: Api = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...(body === undefined
          ? {}
          : {
              method: "POST",
              headers: {
                ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
                "X-CSRF-Token": session?.csrfToken || "",
              },
              body: body instanceof FormData ? body : JSON.stringify(body),
            }),
      });
      if (!response.ok) {
        if (response.status === 401) setExpired(true);
        throw new ApiError(response.status, apiMessage(response.status));
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    [session?.csrfToken],
  );
  function navigate(next: string) {
    if (
      next === section ||
      !dirty ||
      window.confirm("Discard unsaved changes and leave this section?")
    ) {
      setSection(next);
      setMenu(false);
    }
  }
  async function logout() {
    if (dirty && !window.confirm("Discard unsaved changes and sign out?")) return;
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", {});
      setSession(undefined);
      setStatus(401);
    } catch {
      setSessionError("Sign out could not be completed. Try again.");
    } finally {
      setLoggingOut(false);
    }
  }
  if (loading || !session)
    return (
      <main className="admin-app admin-gate">
        <a href="/" className="admin-brand">
          Naga City Chapter<span>Chapter administration</span>
        </a>
        <div className="admin-gate-content">
          <h1>
            {loading
              ? "Checking your session…"
              : status === 401
                ? "Sign in to administration"
                : "Administration unavailable"}
          </h1>
          {loading ? (
            <p role="status">Connecting securely to the chapter service.</p>
          ) : (
            <>
              <p>
                {sessionError ||
                  (status === 401
                    ? "Invited chapter staff can continue using their Google account. An authenticator is required after sign in."
                    : apiMessage(status || 503))}
              </p>
              {status === 401 ? (
                <Button asChild>
                  <a href="/api/auth/google">Continue with Google</a>
                </Button>
              ) : (
                <Button onClick={loadSession}>Try again</Button>
              )}
              <a className="admin-return" href="/">
                Return to the public website
              </a>
            </>
          )}
        </div>
      </main>
    );
  const owner = session.role === "owner";
  if (session.aal !== "aal2")
    return (
      <main className="admin-app admin-gate">
        <a href="/" className="admin-brand">
          Naga City Chapter<span>Chapter administration</span>
        </a>
        <div className="admin-gate-content">
          <p className="admin-account">Signed in as {session.email}</p>
          <MfaPanel
            api={api}
            verified={() => {
              void loadSession();
            }}
          />
          <Button variant="outline" onClick={logout} disabled={loggingOut}>
            Sign out
          </Button>
        </div>
      </main>
    );
  return (
    <UnsavedContext.Provider value={setDirty}>
      <div className="admin-app admin-layout">
        <a className="admin-skip" href="#admin-main">
          Skip to content
        </a>
        <header className="admin-mobile-header">
          <span>Chapter administration</span>
          <Button
            variant="outline"
            size="icon"
            aria-label={menu ? "Close navigation" : "Open navigation"}
            aria-expanded={menu}
            aria-controls="admin-sidebar"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </Button>
        </header>
        <aside id="admin-sidebar" className={`admin-sidebar ${menu ? "is-open" : ""}`}>
          <a href="/" className="admin-brand">
            Naga City Chapter<span>No. 120 · Administration</span>
          </a>
          <nav aria-label="Administration">
            {navigation
              .filter((item) => !item.owner || owner)
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={section === item.id ? "is-active" : ""}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={18} aria-hidden="true" />
                  {item.label}
                </button>
              ))}
          </nav>
          <div className="admin-sidebar-account">
            <p>
              {session.email}
              <small>{owner ? "Owner" : "Editor"}</small>
            </p>
            <Button variant="outline" onClick={logout} disabled={loggingOut}>
              <LogOut aria-hidden="true" />
              {loggingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </aside>
        <main id="admin-main" className="admin-main">
          <div className="admin-topbar">
            <p>Chapter workspace</p>
            <Button variant="outline" onClick={() => setMfaOpen(true)}>
              <ShieldCheck aria-hidden="true" />
              Verify authenticator
            </Button>
          </div>
          {sessionError && <Notice error>{sessionError}</Notice>}
          {expired && (
            <Notice error>
              Your session expired. Copy any unsaved text before{" "}
              <a href="/api/auth/google">signing in again with Google</a>.
            </Notice>
          )}
          <div className="admin-page-body" key={section}>
            {section !== "overview" && (
              <h1 className="sr-only">{navigation.find((item) => item.id === section)?.label}</h1>
            )}
            {section === "overview" && (
              <section>
                <div className="admin-section-heading">
                  <div>
                    <h1>Chapter administration</h1>
                    <p>Manage the records shared with your chapter and community.</p>
                  </div>
                </div>
                <div className="admin-overview">
                  <h2>From draft to public page</h2>
                  <ol>
                    <li>
                      <strong>Prepare the draft.</strong> Add verified details and images the
                      chapter has permission to publish.
                    </li>
                    <li>
                      <strong>Preview and submit.</strong> Review the saved content before sending
                      it for owner approval.
                    </li>
                    <li>
                      <strong>Owner approval.</strong> Publication requires an owner and recent
                      authenticator verification.
                    </li>
                    <li>
                      <strong>Website rebuild.</strong> Approved changes become public after a
                      successful rebuild.
                    </li>
                  </ol>
                  <div className="admin-actions">
                    <Button onClick={() => navigate("events")}>Manage events</Button>
                    <Button variant="outline" onClick={() => navigate("finance")}>
                      Manage finances
                    </Button>
                  </div>
                </div>
                <Notice>
                  You are signed in as {session.email} with {session.role} access. Drafts and
                  pending media are private. Public updates keep the previous approved version until
                  a rebuild succeeds.
                </Notice>
              </section>
            )}
            {section === "events" && <ContentManager api={api} kind="event" owner={owner} />}
            {section === "articles" && <ContentManager api={api} kind="article" owner={owner} />}
            {section === "history" && (
              <>
                <div className="admin-tabs" role="group" aria-label="History and officer records">
                  {(["history", "officer"] as const).map((kind) => (
                    <Button
                      key={kind}
                      variant={historyKind === kind ? "default" : "outline"}
                      aria-pressed={historyKind === kind}
                      onClick={() => {
                        if (!dirty || window.confirm("Discard unsaved changes and switch records?"))
                          setHistoryKind(kind);
                      }}
                    >
                      {kind === "history" ? "History" : "Officers"}
                    </Button>
                  ))}
                </div>
                <ContentManager key={historyKind} api={api} kind={historyKind} owner={owner} />
              </>
            )}
            {section === "finance" && <FinanceManager api={api} owner={owner} />}
            {section === "media" && <MediaManager api={api} />}
            {section === "settings" && <ContentManager api={api} kind="settings" owner={owner} />}
            {section === "staff" && owner && <StaffManager api={api} />}
            {section === "policies" && owner && (
              <ContentManager api={api} kind="policy" owner={owner} />
            )}
            {section === "backups" && owner && <BackupStatus api={api} />}
          </div>
        </main>
        <Dialog open={mfaOpen} onOpenChange={setMfaOpen}>
          <DialogContent className="admin-app admin-mfa-dialog">
            <DialogTitle>Confirm your chapter account</DialogTitle>
            <DialogDescription>
              After verification, return to your draft and retry the action.
            </DialogDescription>
            <MfaPanel
              api={api}
              verified={() => {
                setMfaOpen(false);
                void loadSession();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </UnsavedContext.Provider>
  );
}
