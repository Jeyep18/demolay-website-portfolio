import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { observeChapterReveals, cancelChapterScroll } from "@/lib/chapter-motion";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export function PublicPage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });
  const search = useLocation({ select: (location) => location.searchStr });
  useEffect(() => {
    const stop = ref.current ? observeChapterReveals(ref.current, true) : () => {};
    return () => {
      stop();
      cancelChapterScroll();
    };
  }, [pathname, search]);
  return (
    <div ref={ref} className="chapter-home public-page" id="top">
      <a href="#main-content" className="chapter-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="public-intro">
      <p className="chapter-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="intro-description">{children}</p>
    </section>
  );
}
export { StoryHero } from "./ContentStory";
