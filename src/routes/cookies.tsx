import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookies & Browser Storage · Naga City Chapter No. 120" },
      {
        name: "description",
        content: "The site's theme storage, external requests and browser controls.",
      },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <PolicyPage
      title="Cookies & Browser Storage"
      description="What this website saves in your browser and how you can control it."
    >
      <section aria-labelledby="storage-difference">
        <h2 id="storage-difference">Cookies and local storage</h2>
        <p>
          A cookie is a small value that a browser can send back to a website with later requests.
          Local storage is a separate browser feature: the website can read a saved value, but the
          browser does not automatically attach it to each network request. Both can remember
          choices on your device.
        </p>
        <p>
          The current public pages do not set application cookies or use advertising, analytics,
          cross-site tracking or login cookies. The only persistent browser value used by these
          pages is the appearance preference described below. If the chapter introduces additional
          storage, it will explain the purpose and duration here.
        </p>
      </section>
      <section aria-labelledby="staff-cookies">
        <h2 id="staff-cookies">Essential staff sign-in cookies</h2>
        <p>
          Invited staff use Google sign-in and an authenticator. Administration stores secure,
          HttpOnly, same-site cookies for the session, sign-in verification and form protection.
          Staff sessions expire after eight hours or thirty minutes without activity. These cookies
          are required to administer the site; public reading needs no sign-in.
        </p>
      </section>
      <section aria-labelledby="theme-storage">
        <h2 id="theme-storage">The appearance preference</h2>
        <dl className="policy-storage">
          <dt>Name</dt>
          <dd>
            <code>chapter-theme</code>
          </dd>
          <dt>Type</dt>
          <dd>First-party local storage on this website’s origin.</dd>
          <dt>Value</dt>
          <dd>
            <code>light</code> or <code>dark</code>, saved when you use the theme toggle.
          </dd>
          <dt>Purpose</dt>
          <dd>Remember your chosen appearance across visits.</dd>
          <dt>Duration</dt>
          <dd>No automatic expiry. It remains until changed or cleared by you or your browser.</dd>
          <dt>Recipients</dt>
          <dd>
            The theme code reads it locally; it is not sent to a chapter database or analytics
            service.
          </dd>
        </dl>
        <p>
          Before you choose, the site follows your device’s light or dark preference. If storage is
          blocked, the toggle still works for the current visit without saving the choice.
        </p>
      </section>
      <section aria-labelledby="storage-controls">
        <h2 id="storage-controls">Your controls</h2>
        <p>
          Use the header’s appearance toggle to change the saved choice. To remove it, open your
          browser’s site settings and clear this website’s site data or local storage, then reload
          the page. Clearing cookies alone may not clear local storage. After clearing, the site
          follows your device preference until you choose again.
        </p>
        <p>
          You can block site storage in your browser. Reading pages and opening contact links do not
          require a saved theme choice. This site has no optional tracking categories to accept or
          reject, so it does not display an “Accept all” consent banner. Reading a notice or
          continuing to browse is not treated as consent to unrelated processing.
        </p>
      </section>
      <section aria-labelledby="external-requests">
        <h2 id="external-requests">External requests still matter</h2>
        <p>
          The chapter website serves its fonts directly. Your browser contacts Supabase when it
          loads a chapter event photograph stored there. These requests include network information
          such as your IP address and browser headers. Clearing local storage does not prevent these
          requests. Facebook links and email links open separate services when you choose them. See
          the <Link to="/privacy">Privacy Notice</Link> for information about providers, logs and
          contact messages.
        </p>
      </section>
      <section aria-labelledby="storage-changes">
        <h2 id="storage-changes">Before adding other storage or tracking</h2>
        <p>
          Any future analytics, advertising, embedded social content or additional storage must be
          assessed before activation. The chapter must update this inventory with names, purposes,
          providers and durations, and provide any legally required consent and withdrawal controls.
          This notice does not authorize future tracking.
        </p>
      </section>
    </PolicyPage>
  );
}
