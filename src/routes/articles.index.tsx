import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { articles } from "@/data/content";
import { formatDate } from "@/lib/finance";
import { publicPageHead } from "@/lib/visitor-site";
export const Route = createFileRoute("/articles/")({
  head: () =>
    articles.length > 0
      ? publicPageHead({
          path: "/articles",
          title: "Journal · Naga City Chapter No. 120",
          description: "Chapter reflections on belonging, responsibility and service.",
        })
      : {
          meta: [
            { title: "Journal · Naga City Chapter No. 120" },
            { name: "robots", content: "noindex, follow" },
          ],
        },
  component: ArticlesIndex,
});
function ArticlesIndex() {
  return (
    <PublicPage>
      <PageIntro eyebrow="The chapter journal" title="Ideas to carry with us.">
        Reflections on belonging, responsibility and service, and the everyday choices that shape
        us.
      </PageIntro>
      <section className="public-section article-grid">
        {!articles.length && (
          <p>
            No journal stories have been published yet.{" "}
            <Link to="/events" className="chapter-text-link">
              Read the chapter’s event recaps →
            </Link>
          </p>
        )}
        {articles.map((article) => (
          <Link
            to="/articles/$slug"
            params={{ slug: article.slug }}
            key={article.slug}
            className="journal-card"
            data-reveal=""
          >
            <img src={article.image} alt="" width="1600" height="1066" loading="lazy" />
            <p className="chapter-eyebrow">
              {article.kicker} · {formatDate(article.date)}
            </p>
            <h2>{article.title}</h2>
            <p>{article.excerpt}</p>
            <span className="chapter-text-link">Read the story ↗</span>
          </Link>
        ))}
      </section>
    </PublicPage>
  );
}
