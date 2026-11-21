import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail, Phone } from "lucide-react";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { chapterContact, settings } from "@/data/content";
import { publicPageHead } from "@/lib/visitor-site";

const membershipContacts: { name: string; phone: string; network: string; email: string }[] = [];

export const Route = createFileRoute("/contact")({
  head: () =>
    publicPageHead({
      path: "/contact",
      title: "Membership & Contact · Naga City Chapter No. 120",
      description:
        "Find out what Naga City DeMolay members do and how to contact a chapter advisor about joining.",
    }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <PublicPage>
      <PageIntro eyebrow="Naga City Chapter No. 120" title="Membership & contact">
        Learn what DeMolay members do and how to get involved. Parents and guardians are welcome to
        reach out, too.
      </PageIntro>

      <section className="public-section contact-layout membership-guide">
        <aside className="contact-main membership-contact" aria-labelledby="advisor-title">
          <h2 id="advisor-title">Ask about membership</h2>
          <a
            className="chapter-button membership-facebook"
            href={chapterContact.facebook}
            target="_blank"
            rel="noopener noreferrer"
          >
            Message the chapter on Facebook
            <ArrowUpRight aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {membershipContacts.length > 0 && (
            <>
              <h3>Or contact a chapter representative</h3>
              <ul className="membership-contacts">
                {membershipContacts.map(({ name, email, phone, network }) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <div className="membership-contact-actions">
                      <a href={`tel:+63${phone.replace(/\D/g, "").slice(1)}`}>
                        <Phone aria-hidden="true" />
                        <span>
                          <b>Call</b>
                          <span>
                            {phone} · {network}
                          </span>
                        </span>
                      </a>
                      <a href={`mailto:${email}`}>
                        <Mail aria-hidden="true" />
                        <span>
                          <b>Email</b>
                          <span>{email}</span>
                        </span>
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            For a first inquiry, share a brief question and leave out IDs, addresses, health details
            and payment information. Read our <Link to="/privacy">Privacy Notice</Link> or learn how
            to{" "}
            <Link to="/privacy" hash="photos">
              request a photo removal or correction
            </Link>
            .
          </p>
        </aside>

        <div className="prose membership-details">
          <h2>What members do</h2>
          <p>
            Young men in the chapter learn to plan activities, take responsibility for a role and
            work with other members. Adult advisors guide the chapter, and Naga City Masonic Lodge
            No. 257, F&amp;AM is its sponsor.
          </p>
          <Link to="/events" className="chapter-text-link">
            See chapter activities <ArrowUpRight aria-hidden="true" />
          </Link>

          <h2>Who can join?</h2>
          <p>
            A chapter advisor can confirm the current age and eligibility requirements, meeting
            arrangements and what membership involves. You can ask about time commitments and
            whether there is an activity you and your family can attend.
          </p>

          <h2>What happens when I reach out?</h2>
          <p>
            Message the chapter on Facebook. An advisor can explain the next steps and the petition
            process if you decide to apply. If you’re under 18, ask a parent or guardian to get in
            touch with you.
          </p>

          {settings["contact"] && (
            <>
              <h2>{settings["contact"].title}</h2>
              {settings["contact"].body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </>
          )}
        </div>
      </section>
    </PublicPage>
  );
}
