import { useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { events } from "@/data/content";
import { EventCard } from "./ContentCards";

const featuredEvents = [...events].reverse().slice(0, 5);

export function EventCarousel() {
  const [ref, api] = useEmblaCarousel({ loop: true, align: "start" });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!api) return;
    const select = () => setIndex(api.selectedScrollSnap());
    const stop = () => setPaused(true);
    api.on("select", select).on("pointerDown", stop);
    return () => {
      api.off("select", select).off("pointerDown", stop);
    };
  }, [api]);
  useEffect(() => {
    if (!api || paused || hovered) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !api.rootNode().parentElement?.contains(document.activeElement))
        api.scrollNext();
    }, 5500);
    return () => window.clearInterval(timer);
  }, [api, paused, hovered]);
  if (!featuredEvents.length) return <div className="event-carousel"><p>No events have been published yet. Please check back for chapter announcements.</p></div>;
  return (
    <div
      className="event-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Chapter calendar"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!(event.target as HTMLElement).closest("[data-autoplay]")) setPaused(true);
      }}
    >
      <noscript>
        <style>{`.event-carousel-viewport{overflow:auto}.event-carousel-track{display:grid;grid-template-columns:1fr;margin-left:0;gap:24px}.event-slide{padding-left:0}.carousel-toolbar{display:none}`}</style>
      </noscript>
      <div className="event-carousel-viewport" ref={ref}>
        <div className="event-carousel-track">
          {featuredEvents.map((event, i) => (
            <div
              className="event-slide"
              key={event.slug}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${featuredEvents.length}`}
            >
              <EventCard event={event} />
            </div>
          ))}
        </div>
      </div>
      <div className="carousel-toolbar">
        <span className="carousel-count" aria-live={paused ? "polite" : "off"}>
          {String(index + 1).padStart(2, "0")}{" "}
          <span>/ {String(featuredEvents.length).padStart(2, "0")}</span>
        </span>
        <div className="carousel-progress" aria-hidden="true">
          {featuredEvents.map((event, i) => (
            <span className={i === index ? "active" : ""} key={event.slug} />
          ))}
        </div>
        <div className="carousel-buttons">
          <button
            type="button"
            data-autoplay=""
            aria-pressed={!paused}
            aria-label={paused ? "Resume automatic slides" : "Pause automatic slides"}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <button
            type="button"
            aria-label="Previous event"
            onClick={() => {
              setPaused(true);
              api?.scrollPrev();
            }}
          >
            <ArrowLeft />
          </button>
          <button
            type="button"
            aria-label="Next event"
            onClick={() => {
              setPaused(true);
              api?.scrollNext();
            }}
          >
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}
