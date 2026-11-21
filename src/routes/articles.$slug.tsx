import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicPage, StoryHero, PageIntro } from "@/components/PublicPage";
import { ArticleBody } from "@/components/ContentStory";
import { articles } from "@/data/content";
import { formatDate } from "@/lib/finance";
import { publicPageHead } from "@/lib/visitor-site";
export const Route = createFileRoute("/articles/$slug")({
  loader: ({ params }) => {
    const article = articles.find((item) => item.slug === params.slug);
    if (!article) throw notFound();
    return { article };
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicPageHead({
          path: `/articles/${loaderData.article.slug}`,
          title: `${loaderData.article.title} · Naga City Chapter No. 120`,
          description: loaderData.article.excerpt,
          image: loaderData.article.image,
          type: "article",
        })
      : { meta: [{ title: "Article not found" }] },
  notFoundComponent: () => (
    <PublicPage>
      <PageIntro eyebrow="Journal" title="Article not found.">
        This story is unavailable. <Link to="/articles">Back to journal</Link>
      </PageIntro>
    </PublicPage>
  ),
  component: ArticleDetail,
});
function ArticleDetail() {
  const { article } = Route.useLoaderData();
  return (
    <PublicPage>
      <StoryHero
        image={article.image}
        eyebrow={`${article.kicker} · ${formatDate(article.date)}`}
        title={article.title}
        summary={article.excerpt}
      />
      <ArticleBody paragraphs={article.body}>
        <Link to="/articles" className="chapter-text-link">
          ← Back to journal
        </Link>
      </ArticleBody>
    </PublicPage>
  );
}
