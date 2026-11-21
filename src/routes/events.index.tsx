import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { EventCard } from "@/components/ContentCards";
import { events, photos } from "@/data/content";
import { useChapterDate } from "@/hooks/use-chapter-date";
import { manilaDate, sortChapterEvents } from "@/lib/chapter-events";
import { formatDate } from "@/lib/finance";
import { publicPageHead } from "@/lib/visitor-site";

export const Route = createFileRoute("/events/")({
  loader: () => manilaDate(),
  head: ({ loaderData }) => {
    const head = publicPageHead({
      path: "/events",
      title: "Chapter Events · Naga City Chapter No. 120",
      description:
        "Find upcoming Naga City DeMolay activities and read recaps of past chapter events.",
    });
    const next = loaderData && sortChapterEvents(events, loaderData).upcoming[0];
    if (next) head.meta.push({ name: "chapter-calendar-upcoming-through", content: next.iso });
    return head;
  },
  component: EventsIndex,
});

function EventsIndex() {
  const today = useChapterDate(Route.useLoaderData());
  const { upcoming, pending, completed } = sortChapterEvents(events, today);
  return (
    <PublicPage>
      <PageIntro eyebrow="Naga City Chapter No. 120" title="Chapter events">
        Find out what’s coming up and read about activities the chapter has already held.
      </PageIntro>
      <section className="public-section events-upcoming" aria-labelledby="upcoming-title">
        <div className="section-heading">
          <h2 id="upcoming-title">Upcoming activities</h2>
          {!upcoming.length && <p>No upcoming activities have been announced.</p>}
        </div>
        {upcoming.length > 0 && (
          <div className="event-grid">
            {upcoming.map((event) => (
              <EventCard key={event.slug} event={event} today={today} />
            ))}
          </div>
        )}
      </section>
      {pending.length > 0 && (
        <section className="public-section" aria-labelledby="pending-title">
          <div className="section-heading">
            <h2 id="pending-title">Past dates awaiting a recap</h2>
          </div>
          <ul className="events-pending">
            {pending.map((event) => (
              <li key={event.slug}>
                <Link to="/events/$slug" params={{ slug: event.slug }}>
                  {event.title} <ArrowUpRight aria-hidden="true" />
                </Link>
                <time dateTime={event.iso}>{formatDate(event.iso)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      {completed.length > 0 && (
        <section className="public-section completed-events" aria-labelledby="archive-title">
          <div className="section-heading">
            <h2 id="archive-title">Event recaps</h2>
          </div>
          <div className="completed-event-list">
            {completed.map((event) => {
              const photo = photos[event.photoIndices[0]!];
              return (
                <Link
                  to="/events/$slug"
                  params={{ slug: event.slug }}
                  key={event.slug}
                  className="completed-event-row"
                >
                  {photo && <img src={photo.src} alt="" width="112" height="84" loading="lazy" />}
                  <div>
                    <p className="chapter-eyebrow">
                      <time dateTime={event.iso}>{formatDate(event.iso)}</time>
                    </p>
                    <h3>{event.title}</h3>
                    <p>{event.summary}</p>
                  </div>
                  <span className="archive-read">
                    Read the recap <ArrowUpRight aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </PublicPage>
  );
}
