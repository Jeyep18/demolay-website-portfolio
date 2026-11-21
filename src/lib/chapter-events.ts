import type { EventItem } from "../data/public-content.ts";

export const installationEventSlug = "3rd-public-installation";

export function eventHeaderSummary(event: Pick<EventItem, "slug" | "summary">) {
  if (event.slug === installationEventSlug) {
    return "Naga City Chapter No. 120 welcomed its new officers for the 2026-B term at its third public installation.";
  }
  const summary = event.summary.replace(/\s+/g, " ").trim();
  if (summary.length <= 165) return summary;
  const end = summary.lastIndexOf(" ", 165);
  return summary.slice(0, end >= 100 ? end : 165) + "…";
}

// The Philippines is UTC+08:00 year-round.
const manilaOffset = 8 * 60 * 60 * 1000;
const dayLength = 24 * 60 * 60 * 1000;

export function manilaDate(now = new Date()) {
  return new Date(now.getTime() + manilaOffset).toISOString().slice(0, 10);
}

export function timeUntilManilaMidnight(now: number) {
  return dayLength - ((now + manilaOffset) % dayLength);
}

export function calendarNeedsRefresh(upcomingDate: string | undefined, now = new Date()) {
  return (
    !!upcomingDate && /^\d{4}-\d{2}-\d{2}$/.test(upcomingDate) && upcomingDate < manilaDate(now)
  );
}

export function sortChapterEvents(events: EventItem[], today: string) {
  const latestFirst = [...events].sort((a, b) => b.iso.localeCompare(a.iso));
  const scheduled = latestFirst.filter((event) => event.state === "planned");
  return {
    upcoming: scheduled.filter((event) => event.iso >= today).reverse(),
    pending: scheduled.filter((event) => event.iso < today),
    completed: latestFirst.filter((event) => event.state === "completed"),
  };
}
