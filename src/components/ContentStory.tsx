import type { ReactNode } from "react";

export function StoryHero({
  image,
  imageAlt = "",
  eyebrow,
  title,
  summary,
  layout = "story",
}: {
  image?: string | undefined;
  imageAlt?: string;
  eyebrow: string;
  title: string;
  summary: string;
  layout?: "story" | "event";
}) {
  return (
    <section className={layout === "event" ? "story-hero event-hero" : "story-hero"}>
      {image && <img src={image} width="1600" height="1066" alt={imageAlt} fetchPriority="high" />}
      <div className="story-shade" />
      <div className="story-hero-copy">
        <p className="chapter-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{summary}</p>
      </div>
    </section>
  );
}

export function StorySections({
  sections,
  photograph,
}: {
  sections: { id: string; title: string; paragraphs: string[]; photoIndex?: number }[];
  photograph?: (index: number) => ReactNode;
}) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
          {section.photoIndex !== undefined && photograph?.(section.photoIndex)}
        </section>
      ))}
    </>
  );
}

export function ArticleBody({
  paragraphs,
  children,
}: {
  paragraphs: string[];
  children?: ReactNode;
}) {
  return (
    <article className="standalone-story story-body">
      <p className="chapter-eyebrow">From the chapter journal</p>
      {paragraphs.map((text, index) => (
        <p key={index}>{text}</p>
      ))}
      {children}
    </article>
  );
}

export function EventMetadata({
  when,
  place,
  host,
  lead,
}: {
  when: string;
  place: string;
  host: string;
  lead: string;
}) {
  return (
    <div className="public-section story-meta">
      <dl>
        {[
          ["When", when],
          ["Where", place],
          ["Organized by", host],
          ["Responsible lead", lead],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
