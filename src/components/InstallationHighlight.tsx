import { Link } from "@tanstack/react-router";
import { events } from "@/data/content";
import { installationEventSlug } from "@/lib/chapter-events";

export function InstallationHighlight({ featured = false }: { featured?: boolean }) {
  const recap = events.find(
    (event) => event.slug === installationEventSlug && event.state === "completed",
  );
  if (!recap) return null;
  return (
    <section
      id="installation-film"
      className="installation-highlight"
      aria-labelledby="installation-title"
      data-reveal=""
    >
      <div>
        {featured && <p className="chapter-eyebrow">Featured event film</p>}
        <h2 id="installation-title">
          {featured ? "3rd Public Installation of Officers" : "Watch the installation of officers"}
        </h2>
        <p id="installation-description" className="muted">
          The public installation marks the passing of leadership from one term to the next. As the
          new officers accept their duties, the ceremony calls on them to serve their fellow members
          and put the Seven Cardinal Virtues into practice.
        </p>
        {featured && (
          <Link to="/events/$slug" params={{ slug: recap.slug }} className="chapter-text-link">
            Read the ceremony recap →
          </Link>
        )}
      </div>
      <figure>
        <video
          controls
          playsInline
          preload="none"
          aria-describedby="installation-description"
          poster="/media/installation-highlight-poster.webp"
          width="1280"
          height="720"
        >
          <source src="/media/installation-highlight.mp4" type="video/mp4" />
          Your browser does not support this video.{" "}
          <a href="/media/installation-highlight.mp4">Open the installation film</a>.
        </video>
        <figcaption>
          3rd Public Installation ·{" "}
          <a href="/media/installation-highlight.mp4">Open the video directly</a>
        </figcaption>
      </figure>
    </section>
  );
}
