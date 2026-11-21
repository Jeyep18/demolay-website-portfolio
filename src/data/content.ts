import snapshot from "./published-content.json" with { type: "json" };
import { readPublicSnapshot } from "../lib/public-snapshot.ts";
export {
  chapterContact,
  images,
  virtues,
  historicalPhotos,
  historySources,
} from "./public-content.ts";
import {
  historyTimeline as verifiedHistory,
  historyIntro as verifiedIntro,
} from "./public-content.ts";
export type {
  Article,
  EventItem,
  Photo,
  StorySection,
  TimelineEntry,
  Term,
  Income,
  Expense,
  Project,
} from "./public-content";

const storageOrigin =
  import.meta.env?.["VITE_SUPABASE_URL"] ??
  (typeof process !== "undefined" ? process.env["VITE_SUPABASE_URL"] : "") ??
  "";
const published = readPublicSnapshot(snapshot, storageOrigin);
export const {
  events,
  articles,
  photos,
  leaders,
  terms,
  projects,
  income,
  expenses,
  settings,
  policies,
} = published;
export const historyTimeline = published.history.length ? published.history : verifiedHistory;
export const historyIntro = settings["history-intro"]?.body ?? verifiedIntro;
export const reportAsOf =
  typeof published.revision === "string" ? published.revision.slice(0, 10) : "";
