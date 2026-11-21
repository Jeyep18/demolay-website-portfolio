export type ChapterTheme = "light" | "dark";
const storageKey = "chapter-theme";

// Apply the saved palette before the first paint; the controller handles later changes.
export const chapterThemeInitialization = `(()=>{let theme;try{theme=localStorage.getItem("chapter-theme")}catch{}document.documentElement.dataset.chapterTheme=theme==="light"||theme==="dark"?theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})();`;

export function mountChapterTheme(onChange: (theme: ChapterTheme) => void) {
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(storageKey);
  } catch {
    // Storage can be blocked; the toggle still works for this visit.
  }
  let explicit = saved === "light" || saved === "dark";
  let theme: ChapterTheme = explicit
    ? (saved as ChapterTheme)
    : preference.matches
      ? "dark"
      : "light";
  const apply = () => {
    document.documentElement.dataset["chapterTheme"] = theme;
    onChange(theme);
  };
  const followSystem = () => {
    if (explicit) return;
    theme = preference.matches ? "dark" : "light";
    apply();
  };
  apply();
  preference.addEventListener("change", followSystem);
  return {
    toggle() {
      explicit = true;
      theme = theme === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch {
        // Keep the in-memory selection when persistence is unavailable.
      }
      apply();
    },
    dispose() {
      preference.removeEventListener("change", followSystem);
      delete document.documentElement.dataset["chapterTheme"];
    },
  };
}
