export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function observeChapterReveals(page: HTMLElement, individualContent = false) {
  if (!window.IntersectionObserver) return () => {};
  const animations = new Set<Animation>();
  const seen = new WeakSet<HTMLElement>();
  const pending = new Set<HTMLElement>();
  const observer = new window.IntersectionObserver(
    (entries) => {
      let stagger = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        pending.delete(entry.target as HTMLElement);
        entry.target.removeAttribute("data-reveal-pending");
        if (typeof entry.target.animate !== "function") continue;
        const animation = entry.target.animate(
          [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 620,
            delay: Math.min(stagger++ * 70, 210),
            fill: "backwards",
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        );
        animations.add(animation);
        void animation.finished.then(
          () => animations.delete(animation),
          () => animations.delete(animation),
        );
      }
    },
    { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
  );

  const observeContent = () => {
    if (individualContent) {
      for (const section of page.querySelectorAll(
        "main section[data-reveal], .contact-main[data-reveal]",
      )) {
        section.removeAttribute("data-reveal");
      }
      for (const element of page.querySelectorAll(
        "main h1, main h2, main h3, main p, main figure",
      )) {
        element.setAttribute("data-reveal", "");
      }
    }
    // Cards reveal as one unit; avoid moving their text twice.
    for (const element of page.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (seen.has(element) || element.parentElement?.closest("[data-reveal]")) continue;
      seen.add(element);
      pending.add(element);
      if (element.getBoundingClientRect().top >= window.innerHeight) {
        element.setAttribute("data-reveal-pending", "");
      }
      observer.observe(element);
    }
  };
  observeContent();
  // Expanded leadership reports mount after the page's first render.
  const mutations =
    individualContent && window.MutationObserver
      ? new window.MutationObserver(observeContent)
      : null;
  mutations?.observe(page, { childList: true, subtree: true });

  const stop = () => {
    observer.disconnect();
    mutations?.disconnect();
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const element of pending) element.removeAttribute("data-reveal-pending");
    pending.clear();
  };
  // Keyboard navigation must never land on content waiting for a reveal.
  const onFocus = (event: FocusEvent) => {
    for (const element of pending) {
      if (!element.contains(event.target as Node)) continue;
      observer.unobserve(element);
      element.removeAttribute("data-reveal-pending");
      pending.delete(element);
    }
    for (const animation of animations) animation.cancel();
    animations.clear();
  };
  page.addEventListener("focusin", onFocus);
  return () => {
    stop();
    page.removeEventListener("focusin", onFocus);
  };
}

let cancelActiveScroll: (() => void) | null = null;

export function cancelChapterScroll() {
  cancelActiveScroll?.();
}

export function animateChapterScroll(section: HTMLElement) {
  cancelChapterScroll();
  const start = window.scrollY;
  const margin = Number.parseFloat(window.getComputedStyle(section).scrollMarginTop) || 0;
  const destination = Math.max(
    0,
    Math.min(
      start + section.getBoundingClientRect().top - margin,
      document.documentElement.scrollHeight - window.innerHeight,
    ),
  );
  const distance = destination - start;
  if (Math.abs(distance) < 1) return;
  const duration = Math.min(1100, Math.max(650, Math.abs(distance) * 0.3));
  let started: number | undefined;
  let frame = 0;
  const keys = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
    "Escape",
  ]);
  const cancel = () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("pointerdown", cancel);
    window.removeEventListener("keydown", onKey);
    if (cancelActiveScroll === cancel) cancelActiveScroll = null;
  };
  const onKey = (event: KeyboardEvent) => {
    if (keys.has(event.key)) cancel();
  };
  const tick = (time: number) => {
    started ??= time;
    const progress = Math.min((time - started) / duration, 1);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    window.scrollTo({ top: start + distance * eased, behavior: "instant" });
    if (progress < 1) frame = window.requestAnimationFrame(tick);
    else cancel();
  };
  cancelActiveScroll = cancel;
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  window.addEventListener("pointerdown", cancel, { passive: true });
  window.addEventListener("keydown", onKey);
  frame = window.requestAnimationFrame(tick);
}

let navigationVersion = 0;

export async function navigateChapterSection(
  id: string,
  navigate: (options: {
    hash: string;
    hashScrollIntoView: false;
    resetScroll: false;
  }) => Promise<void>,
) {
  const section = document.getElementById(id);
  if (!section) return;
  const version = ++navigationVersion;
  cancelChapterScroll();
  // Keep hash history in the router and animate after scroll restoration.
  await navigate({
    hash: id,
    hashScrollIntoView: false,
    resetScroll: false,
  });
  // Run after the router's layout/restoration work, including same-hash links.
  window.requestAnimationFrame(() => {
    if (version !== navigationVersion || !section.isConnected) return;
    section.tabIndex = -1;
    section.focus({ preventScroll: true });
    animateChapterScroll(section);
  });
}
