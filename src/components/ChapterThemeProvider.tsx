import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { mountChapterTheme, type ChapterTheme } from "@/lib/chapter-theme";

const ThemeContext = createContext<{ theme: ChapterTheme | null; toggle: () => void }>({
  theme: null,
  toggle: () => {},
});
export function ChapterThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ChapterTheme | null>(null);
  const controller = useRef<ReturnType<typeof mountChapterTheme> | null>(null);
  useEffect(() => {
    controller.current = mountChapterTheme(setTheme);
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return (
    <ThemeContext.Provider value={{ theme, toggle: () => controller.current?.toggle() }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useChapterTheme = () => useContext(ThemeContext);
