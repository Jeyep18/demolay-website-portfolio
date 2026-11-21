export const visitorOrigin = "https://nccdemolay.naga-demolay-120-b0d24c.workers.dev";

export const chapterPortrait = "/images/placeholders/chapter-gathering-wide.webp";

export function publicPageHead({
  path,
  title,
  description,
  image = chapterPortrait,
  type = "website",
}: {
  path: string;
  title: string;
  description: string;
  image?: string | undefined;
  type?: "website" | "article";
}) {
  const url = visitorOrigin + path;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: type },
      { property: "og:url", content: url },
      { property: "og:image", content: new URL(image, visitorOrigin).href },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
