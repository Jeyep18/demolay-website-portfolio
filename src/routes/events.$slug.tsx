import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Mail } from "lucide-react";
import { PublicPage, StoryHero, PageIntro } from "@/components/PublicPage";
import { EventMetadata, StorySections } from "@/components/ContentStory";
import { PhotoGallery } from "@/components/PhotoGallery";
import { InstallationHighlight } from "@/components/InstallationHighlight";
import { chapterContact, events, photos } from "@/data/content";
import { useChapterDate } from "@/hooks/use-chapter-date";
import { eventHeaderSummary, installationEventSlug, manilaDate } from "@/lib/chapter-events";
import { eventStatus, formatDate } from "@/lib/finance";
import { publicPageHead } from "@/lib/visitor-site";
export const Route = createFileRoute("/events/$slug")({
  loader: ({ params }) => {
    const event = events.find((item) => item.slug === params.slug);
    if (!event) throw notFound();
    return { event, initialDate: manilaDate() };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Event not found" }] };
    const { event } = loaderData;
    return publicPageHead({
      path: `/events/${event.slug}`,
      title: `${event.title} · Naga City Chapter No. 120`,
      description: event.summary.replace(/\s+/g, " "),
      image: photos[event.photoIndices[0]!]?.src,
      type: "article",
    });
  },
  notFoundComponent: () => (
    <PublicPage>
      <PageIntro eyebrow="Calendar" title="Event not found.">
        This event is unavailable. <Link to="/events">Back to events</Link>
      </PageIntro>
    </PublicPage>
  ),
  component: EventDetail,
});
function EventDetail() {
  const { event, initialDate } = Route.useLoaderData();
  const today = useChapterDate(initialDate);
  const status = eventStatus(event, today);
  const contentsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const update = () => {
      if (contentsRef.current) contentsRef.current.open = desktop.matches;
    };
    update();
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, [event.slug]);
  const eventPhotos = event.photoIndices.map((index) => photos[index]!);
  const heroPhoto = eventPhotos[0];
  const headerSummary = eventHeaderSummary(event);
  const showFullSummary = heroPhoto && headerSummary !== event.summary.replace(/\s+/g, " ").trim();
  return (
    <PublicPage>
      {heroPhoto ? (
        <StoryHero
          image={heroPhoto.src}
          layout="event"
          eyebrow={status}
          title={event.title}
          summary={headerSummary}
        />
      ) : (
        <PageIntro eyebrow={status} title={event.title}>
          {event.summary}
        </PageIntro>
      )}
      <EventMetadata
        when={`${formatDate(event.iso)} · ${event.time} PHT`}
        place={event.place}
        host={event.host}
        lead={event.lead}
      />
      {showFullSummary && (
        <section className="public-section event-summary prose" aria-labelledby="event-overview">
          <h2 id="event-overview">Event overview</h2>
          {event.summary.split(/\n\s*\n/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      )}
      {event.slug === installationEventSlug && <InstallationHighlight />}
      {status === "Upcoming" && (
        <section className="public-section event-attendance" aria-labelledby="attendance-title">
          <h2 id="attendance-title">Interested in attending?</h2>
          {event.slug === "doomsday-special-screening" && (
            <p>The chapter’s announcement invites friends, families and moviegoers.</p>
          )}
          <p>Email the chapter to confirm availability and arrangements.</p>
          <a
            className="chapter-text-link"
            href={`mailto:${chapterContact.email}?subject=${encodeURIComponent(event.title)}`}
          >
            Ask about this event <Mail aria-hidden="true" />
          </a>
        </section>
      )}
      <PhotoGallery key={event.slug} photos={eventPhotos}>
        {event.sections.length > 0
          ? (open) => (
              <div className="reading-layout">
                <aside className="story-toc">
                  <details ref={contentsRef}>
                    <summary>In this story</summary>
                    <nav aria-label="Article contents">
                      {event.sections.map((section) => (
                        <a key={section.id} href={`#${section.id}`}>
                          {section.title}
                        </a>
                      ))}
                      {eventPhotos.length > 0 && <a href="#gallery">Photo collection</a>}
                    </nav>
                  </details>
                </aside>
                <article className="story-body">
                  <StorySections
                    sections={event.sections}
                    photograph={(index) => {
                      const photo = eventPhotos[index];
                      return photo ? (
                        <figure>
                          <button
                            type="button"
                            className="inline-photo"
                            onClick={(click) => open(index, click.currentTarget)}
                            aria-label={`Inspect ${photo.alt}`}
                          >
                            <img
                              src={photo.src}
                              width={photo.width}
                              height={photo.height}
                              alt={photo.alt}
                              loading="lazy"
                            />
                            <span>Inspect photograph ↗</span>
                          </button>
                          <figcaption>{photo.caption}</figcaption>
                        </figure>
                      ) : null;
                    }}
                  />
                </article>
              </div>
            )
          : undefined}
      </PhotoGallery>
      <div className="public-section back-links">
        <Link to="/events">← All events</Link>
      </div>
    </PublicPage>
  );
}
