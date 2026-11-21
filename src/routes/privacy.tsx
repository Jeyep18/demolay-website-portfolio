import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";
import { privacyContact } from "@/data/privacy-contact";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Notice · Naga City Chapter No. 120" },
      {
        name: "description",
        content: "How this website handles information and privacy requests.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Notice"
      description="What information is involved when you visit, contact the chapter or appear in chapter media."
    >
      <section aria-labelledby="privacy-contact">
        <h2 id="privacy-contact">Who to contact</h2>
        <p>
          Naga City Chapter No. 120, Order of DeMolay, in Naga City, Philippines, is responsible for
          this website and its handling of personal information. The chapter is sponsored by Naga
          City Masonic Lodge No. 257, F&amp;AM. Its assigned privacy officer is{" "}
          {privacyContact.name}. For privacy questions, corrections or removal requests, email{" "}
          <a href={`mailto:${privacyContact.email}`}>{privacyContact.email}</a> with the subject
          “Website privacy request”.
        </p>
        <p>
          The owner and authorized managers handle contact messages, privacy requests, incident
          handling and retention reviews. The owner controls and monitors the chapter mailbox. The
          Master Councilor reviews chapter material before public upload.
        </p>
      </section>
      <section aria-labelledby="young-visitors">
        <h2 id="young-visitors">For young visitors and parents</h2>
        <p>
          You can read the website without creating an account or giving your name. If you want to
          ask about membership, involve a parent or guardian and send only a short question. Please
          do not send identification documents, your home address, school schedule, health details
          or payment information in a first message. The website has no application or document
          upload form.
        </p>
        <p>
          If a photo, video or name on the site concerns you, you or your parent or guardian can
          email the privacy officer with the page address and a description. You can ask for
          correction, removal or an explanation of why it is there. Reading this notice does not
          give consent to publish your image or to process information for unrelated purposes.
        </p>
      </section>
      <section aria-labelledby="information">
        <h2 id="information">Information involved and why</h2>
        <ul>
          <li>
            <strong>Website requests:</strong> the server and its hosting network receive technical
            information needed to deliver pages and media. Depending on provider settings, logs may
            contain an IP address, requested URL, time, browser information and response status.
            These support delivery, security and troubleshooting. Providers control which fields
            their own logs retain. Their retention periods can differ.
          </li>
          <li>
            <strong>Your display preference:</strong> the browser stores a light or dark choice as{" "}
            <code>chapter-theme</code>. It is used for appearance, not an account or advertising
            profile. See the <Link to="/cookies">Cookies &amp; Browser Storage notice</Link>.
          </li>
          <li>
            <strong>Membership contact links:</strong> the contact page links to the chapter’s
            Facebook page and to the phone numbers and email addresses of listed representatives. A
            message or call goes through the service you choose and to the account or person you
            contact. The website itself does not send or store it.
          </li>
          <li>
            <strong>Email inquiries:</strong> the email link opens your own email application. If
            you write to the chapter mailbox, it receives your email address, message, any name or
            attachments you include, and email metadata. The website itself does not submit or store
            that message. Privacy requests sent to the officer are received in the officer’s listed
            Gmail mailbox instead. The chapter uses these details to answer your question or handle
            your request. Chapter policy limits mailbox access to the owner and authorized managers;
            the retention policy below is carried out manually.
          </li>
          <li>
            <strong>Published records and media:</strong> pages may show names, roles, term dates,
            activity accounts, financial summaries, photographs, voices and video. These are
            intended to explain chapter activities and history. Publication makes them available to
            other visitors and potentially to search engines and people making copies.
          </li>
          <li>
            <strong>Errors:</strong> server errors can be logged with messages and stack traces.
            Lovable reporting hooks are disabled in production. A development or preview environment
            can supply separate reporting hooks; this does not establish visitor reporting on the
            public website.
          </li>
        </ul>
        <p>
          The current site has no visitor accounts, membership application collection, attendance
          registration, online payments, newsletter signup, advertising analytics or automated
          decisions about membership. It does not request device location, camera or microphone
          access. Future collection requires an updated notice before it begins.
        </p>
      </section>
      <section aria-labelledby="providers">
        <h2 id="providers">Services, recipients and overseas processing</h2>
        <p>
          The chapter website serves its fonts directly. Your browser requests published event
          photographs from Supabase storage. Supabase receives the network information needed to
          deliver each image. The chapter website serves the installation video directly.
        </p>
        <p>
          Clicking Facebook opens a separate service governed by{" "}
          <a href="https://www.facebook.com/privacy/policy/">Meta’s Privacy Policy</a>. The site
          does not embed a Facebook feed or tracking pixel. Sending email involves your email
          provider and the chapter’s Gmail service. Hosting and email providers may process
          information outside the Philippines. Cloudflare hosts the website; Supabase stores chapter
          content and staff access records in its Tokyo region. Google provides staff sign-in, Gmail
          and the private encrypted-backup location. GitHub Actions runs backup and publishing jobs,
          and Healthchecks.io receives backup-status pings without backup payloads. These services
          can process information in other locations; no Philippines-only storage promise is made
          here. Remaining contractual and provider-specific retention details are under review.
        </p>
      </section>
      <section aria-labelledby="lawful-use">
        <h2 id="lawful-use">Lawful use and publication</h2>
        <p>
          Philippine privacy rules require a lawful basis for each use of personal information.
          Consent, legitimate interests or another applicable basis must be assessed for the
          particular activity; sensitive personal information has additional conditions. A visit, an
          email inquiry or acceptance of website terms is not blanket consent to publish a person’s
          name, photograph or membership details.
        </p>
        <p>
          We use the contact details you choose to send to reply to your inquiry. We rely on the
          chapter’s legitimate interest in answering the person who contacted us. We also rely on
          our legitimate interest in delivering pages and images securely and investigating service
          problems. We use the minimum information needed to handle a privacy-rights request to meet
          our duties under Philippine privacy law. You can object to processing based on legitimate
          interests by contacting the privacy officer.
        </p>
        <p>
          The owner confirms authority and publication permissions for the site's photographs,
          identifiable people, installation film and soundtrack, with chapter material reviewed by
          the Master Councilor. Internal chapter approval does not replace any additional permission
          or legal condition required for a particular person or use. Guardian authorization will be
          obtained where required before the affected material is published. The owner confirms that
          individual publication records for the current material are complete and held privately.
          This notice does not independently certify those records.
        </p>
      </section>
      <section aria-labelledby="retention">
        <h2 id="retention">Storage, retention and security</h2>
        <p>
          Approved chapter content is managed in Supabase and exported into public website files.
          Public visitors do not submit records to the chapter database. Theme storage remains in
          your browser until changed or cleared; it has no automatic expiry. The site does not
          automatically delete mailbox messages or provider logs.
        </p>
        <ul>
          <li>
            Routine inquiries are deleted 90 days after closure unless an ongoing matter requires
            them.
          </li>
          <li>
            Minimal privacy-request decision and action records are kept for one year after closure;
            unnecessary identity evidence is removed sooner.
          </li>
          <li>
            Published media and source copies are reviewed annually and when permission, accuracy or
            purpose changes.
          </li>
          <li>
            Staff access is reviewed on departure and revoked promptly. Minimal audit history is
            reviewed after one year, with any continued retention justified by accountability or an
            ongoing matter.
          </li>
        </ul>
        <p>
          The owner and authorized managers carry out these reviews and mailbox deletions manually.
          No automatic staff or audit-record purge is implemented. Legal holds or unresolved matters
          can require longer retention. GitHub job logs and artifacts are configured for 90 days.
          Supabase's standard Free plan provides up to one day of API and database log access; this
          is not a promise that every provider copy is erased after one day. Other provider records
          follow their applicable terms and settings, which remain under review.
        </p>
        <p>
          Public pages are accessible to anyone with the address. Removing an item from the site
          cannot guarantee deletion of copies held by other people or search engines. Access
          controls for hosting and email, secure delivery, deletion and incident procedures also
          require operational verification. No website or email service can guarantee absolute
          security; do not send passwords, payment credentials or unnecessary sensitive documents.
        </p>
      </section>
      <section aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">Your rights and requests</h2>
        <p>
          Subject to Philippine law and applicable limitations, you may ask to be informed, access
          your personal information, correct inaccuracies, object to processing, withdraw consent
          where it is the basis, or request erasure or blocking. Data portability and compensation
          may also apply in the circumstances provided by law. You may complain to the{" "}
          <a href="https://privacy.gov.ph/data-subject-rights/">National Privacy Commission</a>.
        </p>
        <p>
          Email the privacy officer above, identify the affected page or information and explain
          what you are requesting. For a child, a parent or legal guardian may act on their behalf.
          Appropriate identity or authority checks may be needed; do not include a government ID in
          the first email. The owner and authorized managers review the request, record the minimum
          information needed, assess the requested action and respond through the listed contact. No
          automatic deletion or guaranteed response time is represented by this notice.
        </p>
      </section>
      <section aria-labelledby="photos">
        <h2 id="photos">Photos, video and corrections</h2>
        <p>
          To raise a privacy or copyright concern, email the privacy officer with the page URL,
          enough detail to locate the image or passage, your connection to it and the action you
          request. Do not send another person’s private records to prove a concern. Publication
          permissions are checked before publication and reviewed when a concern is raised. The
          owner confirms that the current publication records include identifiable adults, alongside
          chapter and photographer rights. Financial reports must use approved public summaries with
          private identifiers and supporting documents excluded or redacted.
        </p>
      </section>
      <section aria-labelledby="media-review">
        <h2 id="media-review">Review before publishing media</h2>
        <p>
          The chapter owner reports that current public assets do not show identifiable minors.
          Before future publication, the owner and authorized managers review faces, names, voices
          and surrounding details. Blurring a face is not enough if other details still identify a
          child. Where permission is required, the chapter must record the applicable permission and
          parent or guardian authority before publication. Incomplete permission records do not
          clear an item for publication.
        </p>
      </section>
      <section aria-labelledby="privacy-sources">
        <h2 id="privacy-sources">Legal references</h2>
        <p>
          This notice is informed by the{" "}
          <a href="https://privacy.gov.ph/data-privacy-act-/">Data Privacy Act of 2012</a>, the{" "}
          <a href="https://privacy.gov.ph/the-right-to-be-informed/">NPC transparency guidance</a>{" "}
          and its{" "}
          <a href="https://privacy.gov.ph/wp-content/uploads/2024/12/Advisory-2024.12.17-Guidelines-on-Child-Oriented-Transparency-w-SGD.pdf">
            Guidelines on Child-Oriented Transparency
          </a>
          . These links open the official sources; they do not imply NPC approval of this site.
        </p>
      </section>
    </PolicyPage>
  );
}
