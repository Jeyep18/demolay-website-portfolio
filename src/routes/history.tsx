import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { PhotoGallery } from "@/components/PhotoGallery";
import {
  events,
  historicalPhotos,
  historyIntro,
  historySources,
  historyTimeline,
  leaders,
  photos,
  terms,
} from "@/data/content";
import { formatDate, termLabel } from "@/lib/finance";
import { publicPageHead } from "@/lib/visitor-site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
export const Route = createFileRoute("/history")({
  head: () =>
    publicPageHead({
      path: "/history",
      title: "Chapter History · Naga City Chapter No. 120",
      description:
        "Explore a milestone in Naga City Chapter No. 120 and the origins of the Order of DeMolay.",
    }),
  component: HistoryPage,
});
function HistoryPage() {
  const installation = events.find(
    (event) => event.slug === "3rd-public-installation" && event.state === "completed",
  );
  return (
    <PublicPage>
      <PageIntro eyebrow="Naga City Chapter No. 120" title="Our chapter’s history">
        Explore a milestone from the chapter in Naga and learn how the Order of DeMolay began.
      </PageIntro>
      {installation && (
        <section className="public-section split-section chapter-milestone">
          <h2>Leadership in Naga</h2>
          <div className="prose">
            <p className="chapter-eyebrow">
              <time dateTime={installation.iso}>{formatDate(installation.iso)}</time>
            </p>
            <h3>3rd Public Installation of Officers</h3>
            <p>
              The chapter installed its 2026-B officers at Naga City Masonic Lodge No. 257 in
              Marupit, Camaligan.
            </p>
            <Link
              to="/events/$slug"
              params={{ slug: installation.slug }}
              className="chapter-text-link"
            >
              Read the installation recap →
            </Link>
          </div>
        </section>
      )}
      {historicalPhotos.map((photo, index) => (
        <section
          className={`public-section history-profile ${index === 1 ? "reverse-profile" : ""}`}
          key={photo.src}
          data-reveal=""
        >
          <figure>
            <img
              src={photo.src}
              width={photo.width}
              height={photo.height}
              alt={photo.alt}
              loading="lazy"
            />
            <figcaption>
              {photo.caption}. <a href={photo.source}>Image source</a> ·{" "}
              <a href={photo.license}>License</a>
            </figcaption>
          </figure>
          <div className="prose">
            <p className="chapter-eyebrow">{index === 0 ? "The namesake" : "The founder"}</p>
            <h2>{index === 0 ? "Jacques de Molay" : "Frank S. Land"}</h2>
            {index === 0 ? (
              <>
                <p>
                  Jacques de Molay was the last Grand Master of the Knights Templar, a medieval
                  religious and military order. He lived during a period of conflict and political
                  pressure that ended with the suppression of the Templars. He died in Paris in
                  1314.
                </p>
                <p>
                  Centuries later, the story told about him inspired a group of young men in Kansas
                  City. In DeMolay’s tradition, he represents courage, loyalty and fidelity:
                  qualities the young men wanted their own organization to encourage.
                </p>
                <p>
                  The youth organization takes its name from him; it is distinct from the medieval
                  order. This short account leaves out later legends and disputed details rather
                  than presenting them as settled history.
                </p>
              </>
            ) : (
              <>
                <p>{historyIntro[0]}</p>
                <p>
                  Known affectionately as “Dad” Land, he offered the group a place to meet and
                  encouraged them to take responsibility for their own organization. Louis Lower and
                  eight friends formed its original core, and the group chose a name inspired by
                  Jacques de Molay.
                </p>
                <p>
                  The lecture describes an organized meeting on March 24, 1919, while distinguishing
                  it from the later March 18 observance associated with the namesake. Land continued
                  to guide DeMolay as it grew. He died on November 8, 1959, leaving a legacy of
                  mentorship and service.
                </p>
              </>
            )}
          </div>
        </section>
      ))}
      <section className="public-section panel-section">
        <div className="section-heading">
          <p className="chapter-eyebrow">A short timeline</p>
          <h2>Moments that shaped the story.</h2>
        </div>
        <ol className="history-timeline">
          {historyTimeline.map((entry, index) => (
            <li id={`t-${index}`} key={`${entry.year}-${entry.label}`} data-reveal="">
              <span>{entry.year}</span>
              <div>
                <p className="chapter-eyebrow">{entry.label}</p>
                <h3>{entry.title}</h3>
                <p>{entry.snippet}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="source-note">
          <h3>Historical sources</h3>
          <ul>
            {historySources.map((source) => (
              <li key={source.title}>
                {source.url ? <a href={source.url}>{source.title}</a> : source.title}
              </li>
            ))}
          </ul>
          <p>
            Summarized from the supplied lecture and institutional histories. The full petitioner
            lecture and internal procedures are not published here.
          </p>
        </div>
      </section>
      {leaders.length > 0 && (
        <section className="public-section" id="leadership">
          <div className="section-heading">
            <p className="chapter-eyebrow">Past Master Councilors</p>
            <h2>Every term leaves a story.</h2>
            <p>Explore the people, projects and lessons that shaped each term.</p>
          </div>
          <Accordion type="multiple" className="leadership-archive">
            {leaders.map((leader) => {
              const term = terms.find((item) => item.id === leader.termId)!;
              return (
                <AccordionItem value={leader.termId} key={leader.termId}>
                  <AccordionTrigger>
                    <span>
                      <span className="chapter-eyebrow">{termLabel(term)}</span>
                      <strong>{leader.name}</strong>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="leader-report">
                      <div className="prose">
                        <h3>Term report</h3>
                        <p>{leader.summary}</p>
                        <h3>A lesson to carry forward</h3>
                        <p>{leader.lesson}</p>
                        <Link
                          to="/events/$slug"
                          params={{ slug: leader.eventSlug }}
                          className="chapter-text-link"
                        >
                          Explore the term’s event →
                        </Link>
                      </div>
                    </div>
                    <PhotoGallery
                      id={`gallery-${leader.termId}`}
                      photos={leader.photoIndices.map((index) => photos[index]!)}
                    />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          <noscript>
            <div className="archive-nojs">
              <p>Term summaries</p>
              {leaders.map((leader) => (
                <article key={leader.termId} className="prose">
                  <h3>
                    {leader.name} · {leader.termId}
                  </h3>
                  <p>{leader.summary}</p>
                  <p>{leader.lesson}</p>
                  {leader.photoIndices.map((index) => (
                    <figure key={index}>
                      <a href={photos[index]!.src}>
                        <img
                          src={photos[index]!.src}
                          width={photos[index]!.width}
                          height={photos[index]!.height}
                          alt={photos[index]!.alt}
                          loading="lazy"
                        />
                      </a>
                      <figcaption>{photos[index]!.caption}</figcaption>
                    </figure>
                  ))}
                  <a href={`/events/${leader.eventSlug}`}>Read the event report</a>
                </article>
              ))}
            </div>
          </noscript>
        </section>
      )}
    </PublicPage>
  );
}
