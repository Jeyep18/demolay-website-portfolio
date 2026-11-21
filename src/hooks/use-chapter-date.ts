import { useEffect, useState } from "react";
import { manilaDate, timeUntilManilaMidnight } from "@/lib/chapter-events";

export function useChapterDate(initialDate: string) {
  const [today, setToday] = useState(initialDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = Date.now();
      setToday(manilaDate(new Date(now)));
      timer = setTimeout(update, timeUntilManilaMidnight(now));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
