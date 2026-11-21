import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage, StoryHero } from "@/components/PublicPage";
import { PhotoGallery } from "@/components/PhotoGallery";
import { VirtueWheel } from "@/components/VirtueWheel";
import { images, historyIntro, photos, settings } from "@/data/content";
import { publicPageHead } from "@/lib/visitor-site";
export const Route = createFileRoute("/chapter")({
  head: () =>
    publicPageHead({
      path: "/chapter",
      title: "About the Chapter · Naga City Chapter No. 120",
      description:
        "Get to know Naga City’s DeMolay chapter, its seven virtues, its adult advisors and its sponsoring Masonic lodge.",
      image: images.officers,
    }),
  component: ChapterPage,
});
function ChapterPage() {
  return (
    <PublicPage>
      <StoryHero
        image={images.officers}
        imageAlt="Chapter members gathered in ceremonial regalia inside the lodge"
        eyebrow="Order of DeMolay"
        title="About Naga City Chapter No. 120"
        summary="A youth leadership chapter guided by adult advisors and supported by Naga City Masonic Lodge No. 257, F&AM."
      />
      <section className="public-section split-section" data-reveal="">
        <div>
          <h2>What it means to be a member</h2>
        </div>
        <div className="prose">
          {settings["chapter"] ? (
            settings["chapter"].body.map((paragraph, index) => <p key={index}>{paragraph}</p>)
          ) : (
            <>
              <p>
                Naga City Chapter No. 120 is part of the International Order of DeMolay, a youth
                organization where young men learn responsibility, build friendships and serve their
                communities.
              </p>
              <p>
                Our sponsoring lodge is Naga City Masonic Lodge No. 257, F&amp;AM. Adult guidance
                and practical teamwork help members grow through shared experience.
              </p>
            </>
          )}
          <Link to="/contact" className="chapter-text-link">
            Explore membership →
          </Link>
        </div>
      </section>
      <section className="public-section virtues-section compact-virtues">
        <div className="section-heading">
          <h2>The seven virtues of DeMolay</h2>
          <p>Select a virtue to explore a plain-language summary.</p>
        </div>
        <VirtueWheel tone="dark" />
      </section>
      <section className="public-section split-section" data-reveal="">
        <div>
          <h2>Where DeMolay began</h2>
        </div>
        <div className="prose">
          {historyIntro.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <Link to="/history" className="chapter-text-link">
            Read the history →
          </Link>
        </div>
      </section>
      <PhotoGallery id="chapter-gallery" photos={photos} />
    </PublicPage>
  );
}
