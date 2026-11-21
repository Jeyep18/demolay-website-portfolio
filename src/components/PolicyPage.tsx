import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { policies } from "@/data/content";
import { PublicPage, PageIntro } from "./PublicPage";

export function PolicyPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const path = useLocation({ select: (location) => location.pathname });
  const approved = policies[path.replace(/^\//, "")];
  return (
    <PublicPage>
      <PageIntro eyebrow="Website policies" title={approved?.title ?? title}>
        {description}
      </PageIntro>
      <article className="public-section policy-document">
        <aside className="policy-status" aria-label="Document status">
          <strong>About these policies</strong>
          <p>
            Updated <time dateTime="2026-11-21">21 November 2026</time>. The chapter approved its
            notices and operating procedures on 24 October 2026. Its privacy officer handles
            questions about how they apply to you.
          </p>
        </aside>
        <nav className="policy-links" aria-label="Related website policies">
          <Link to="/privacy">Privacy Notice</Link>
          <Link to="/cookies">Cookies &amp; Browser Storage</Link>
          <Link to="/terms">Terms of Use</Link>
        </nav>
        <section aria-labelledby="staff-data-notice">
          <h2 id="staff-data-notice">Staff administration and recovery</h2>
          <p>
            Invited chapter staff use Google sign-in and an authenticator to manage content.
            Supabase processes staff identities, access permissions, approved content and uploaded
            images. Administrative sessions use essential secure cookies; public visitors do not
            need accounts.
          </p>
          <p>
            GitHub Actions runs scheduled encrypted database and media backups to a private Google
            Drive location. Completed recovery points are retained for 30 days. Cleanup follows
            successful backup and monitoring checks, so failures can delay deletion; shared
            encrypted media remains while retained recovery points reference it. Hosted recovery has
            been tested in a separate protected project.
          </p>
        </section>
        {approved ? (
          <section>
            <h2>{approved.title}</h2>
            {approved.body.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        ) : (
          children
        )}
        <p className="muted">
          Changes to these documents will be recorded by updating the date above.
        </p>
      </article>
    </PublicPage>
  );
}
