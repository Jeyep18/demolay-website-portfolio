import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";
import { chapterContact } from "@/data/content";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use · Naga City Chapter No. 120" },
      {
        name: "description",
        content: "Website use, chapter information, content rights and corrections.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Use"
      description="Guidance for using the chapter website and understanding its information."
    >
      <section aria-labelledby="terms-purpose">
        <h2 id="terms-purpose">About the chapter website</h2>
        <p>
          This website presents Naga City Chapter No. 120, Order of DeMolay, sponsored by Naga City
          Masonic Lodge No. 257, F&amp;AM. It provides information about chapter life, history,
          activities and finances. The chapter is responsible for the website. Its authorized
          representatives have approved these terms.
        </p>
        <p>
          Event accounts, leadership records, articles and financial reports are published only
          after chapter approval. Empty collections mean no approved records are available. Supplied
          chapter media does not authenticate surrounding accounts. The owner confirms completed
          publication records for the current material and chapter approval of these notices.
        </p>
      </section>
      <section aria-labelledby="membership-terms">
        <h2 id="membership-terms">Membership, activities and money</h2>
        <p>
          Reading the site or sending an inquiry does not create membership, reserve attendance or
          approve an application. Confirm eligibility, requirements, arrangements, costs and
          permission to attend with an authorized advisor. Young visitors should involve a parent or
          guardian. A public activity listing does not grant access to private meetings.
        </p>
        <p>
          The site has no checkout, donation collection, online membership application or payment
          processing. Do not send money or payment credentials based solely on a page here.
          Financial pages are informational summaries, not invoices, payment instructions, audited
          statements or promises about future expenditure. Private financial evidence and personal
          identifiers are not intended for public publication.
        </p>
      </section>
      <section aria-labelledby="acceptable-use">
        <h2 id="acceptable-use">Respectful and lawful use</h2>
        <p>
          Use the site lawfully and respect the privacy and safety of people pictured or named. Do
          not attempt unauthorized access, interfere with availability, distribute malicious
          material, impersonate chapter representatives or use published information to harass,
          identify private routines or mislead others. Publication of someone’s image does not
          authorize unrelated reuse of their personal information.
        </p>
      </section>
      <section aria-labelledby="content-rights">
        <h2 id="content-rights">Content, photographs and trademarks</h2>
        <p>
          Rights in text, photographs, video, music, logos and other material remain with their
          respective rights holders. Credit and license links accompany the historical images where
          available. Public-domain and openly licensed works remain subject to their own status or
          license; these terms do not remove those permissions or lawful exceptions.
        </p>
        <p>
          For other material, obtain permission from the appropriate rights holder before reuse
          unless the law permits it. Merely naming or crediting an author is not a substitute for
          permission. The owner has confirmed authority and publication permissions for supplied
          chapter material and completed individual publication records for the current material.
          Future material must satisfy applicable individual or guardian conditions before
          publication. The site does not grant permission to represent DeMolay or its sponsoring
          lodge.
        </p>
      </section>
      <section aria-labelledby="terms-links">
        <h2 id="terms-links">External services and availability</h2>
        <p>
          Facebook, email providers and other linked websites operate under their own terms and
          privacy practices. A link does not guarantee their content or imply endorsement of every
          statement there. Website information may be corrected or become unavailable; confirm
          time-sensitive details directly with the chapter before acting on them.
        </p>
        <p>
          These terms do not exclude responsibilities or rights that cannot lawfully be excluded.
          They do not require you to waive privacy rights, agree to unrelated processing or accept
          compulsory marketing. These terms do not impose arbitration or an exclusive court venue.
        </p>
      </section>
      <section aria-labelledby="terms-requests">
        <h2 id="terms-requests">Questions, corrections and removal requests</h2>
        <p>
          Email <a href={`mailto:${chapterContact.email}`}>{chapterContact.email}</a> with the
          affected page URL and a brief explanation of a factual, copyright, privacy or safety
          concern. Avoid including unnecessary sensitive information. The{" "}
          <Link to="/privacy" hash="privacy-rights">
            Privacy Notice
          </Link>{" "}
          explains personal information requests and identifies the assigned privacy officer,
          including for requests concerning minors. The owner and authorized managers review
          requests and reply through the contact you provide.
        </p>
        <p>
          This site is intended for a Philippine chapter. Applicable Philippine law, including
          privacy and intellectual property law, governs relevant activities without removing rights
          that other applicable laws may provide. Material changes to the site’s services require a
          review of these terms and related notices before those services are offered.
        </p>
      </section>
    </PolicyPage>
  );
}
