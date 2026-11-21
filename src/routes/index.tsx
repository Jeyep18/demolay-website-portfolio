import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChapterHomeHeader } from "@/components/ChapterHomeHeader";
import { EventCard } from "@/components/ContentCards";
import { InstallationHighlight } from "@/components/InstallationHighlight";
import { SiteFooter } from "@/components/SiteFooter";
import { events, settings } from "@/data/content";
import { useChapterDate } from "@/hooks/use-chapter-date";
import { manilaDate, sortChapterEvents } from "@/lib/chapter-events";
import {
  cancelChapterScroll,
  navigateChapterSection,
  observeChapterReveals,
} from "@/lib/chapter-motion";
import { publicPageHead } from "@/lib/visitor-site";

const fellowshipImage = "/images/placeholders/chapter-fellowship.webp";

export const Route = createFileRoute("/")({
  loader: () => manilaDate(),
  head: () =>
    publicPageHead({
      path: "/",
      title: "Naga City Chapter No. 120 | Order of DeMolay",
      description:
        "Meet Naga City’s DeMolay chapter. See what young members do, explore chapter activities, and learn how to ask about joining.",
      image: fellowshipImage,
    }),
  component: Home,
});

function Home() {
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const today = useChapterDate(Route.useLoaderData());
  const { upcoming, completed } = sortChapterEvents(events, today);
  const nextEvent = upcoming[0];
  const latestRecap = completed[0];

  useEffect(() => {
    const stopReveals = pageRef.current ? observeChapterReveals(pageRef.current) : undefined;
    return () => {
      stopReveals?.();
      cancelChapterScroll();
    };
  }, []);

  return (
    <div
      className="chapter-home"
      id="top"
      ref={pageRef}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !(event.target instanceof Element)
        )
          return;
        const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
        if (!link || link.classList.contains("chapter-skip")) return;
        const id = link.hash.slice(1);
        if (!document.getElementById(id)) return;
        event.preventDefault();
        void navigateChapterSection(id, router.navigate);
      }}
    >
      <a href="#main-content" className="chapter-skip">
        Skip to content
      </a>
      <ChapterHomeHeader />
      <main id="main-content" tabIndex={-1}>
        <section className="chapter-hero chapter-welcome" aria-labelledby="hero-title">
          <div className="chapter-hero-copy">
            <p className="chapter-eyebrow">Order of DeMolay · Naga City, Philippines</p>
            <h1 id="hero-title">{settings["home"]?.title ?? "Meet Naga\u00a0City DeMolay."}</h1>
            <p className="chapter-hero-intro">
              We’re a youth leadership chapter where young men build friendships, take
              responsibility and serve their community with guidance from adult advisors. Parents
              and guardians are welcome to learn with you.
            </p>
            {settings["home"]?.body.map((paragraph, index) => (
              <p className="chapter-hero-intro" key={index}>
                {paragraph}
              </p>
            ))}
            <div className="chapter-hero-actions">
              <Link to="/contact" className="chapter-button">
                Explore membership <ArrowRight aria-hidden="true" />
              </Link>
              <a href="#events" className="chapter-text-link">
                See chapter activities <ArrowDown aria-hidden="true" />
              </a>
            </div>
          </div>
          <figure className="chapter-hero-photo">
            <img
              src={fellowshipImage}
              alt="Chapter members crowd together for a group selfie inside the lodge"
              width={1600}
              height={1200}
              fetchPriority="high"
            />
            <figcaption>Members of Naga City Chapter No. 120</figcaption>
          </figure>
        </section>

        <section
          className="public-section home-activities"
          id="events"
          aria-labelledby="events-title"
        >
          <div className="home-activities-heading">
            <div>
              <h2 id="events-title" data-reveal="">
                Chapter activities
              </h2>
              <p data-reveal="">See what’s coming up and what members have done together.</p>
            </div>
            <Link to="/events" className="chapter-text-link">
              View all events <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <div className="event-grid">
            {nextEvent ? (
              <div data-reveal="">
                <EventCard event={nextEvent} today={today} />
              </div>
            ) : (
              <p className="home-activity-empty" data-reveal="">
                No upcoming activities have been announced.
              </p>
            )}
            {latestRecap && (
              <div data-reveal="">
                <EventCard event={latestRecap} today={today} />
              </div>
            )}
          </div>
        </section>
        <InstallationHighlight featured />

        <section className="public-section split-section home-chapter" id="our-chapter">
          <h2 data-reveal="">About the chapter</h2>
          <div className="prose">
            <p data-reveal="">
              Members take on leadership roles, plan activities together and practise the seven
              virtues of DeMolay. Naga City Masonic Lodge No. 257, F&amp;AM sponsors the chapter.
            </p>
            <Link to="/chapter" className="chapter-text-link">
              Learn about our chapter <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="chapter-join" id="join" aria-labelledby="join-title">
          <h2 id="join-title" data-reveal="">
            Curious about joining?
          </h2>
          <p data-reveal="">
            Explore membership with a parent or guardian and learn how to reach a chapter advisor.
          </p>
          <Link to="/contact" className="chapter-button">
            Explore membership <ArrowRight aria-hidden="true" />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
