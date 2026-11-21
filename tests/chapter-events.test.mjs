import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarNeedsRefresh,
  eventHeaderSummary,
  manilaDate,
  sortChapterEvents,
  timeUntilManilaMidnight,
} from "../src/lib/chapter-events.ts";

test("event headers keep short summaries and shorten long ones at a word boundary", () => {
  assert.equal(
    eventHeaderSummary({ slug: "test", summary: "  Event\n details  " }),
    "Event details",
  );
  const long = "A chapter activity for members and families ".repeat(8);
  const excerpt = eventHeaderSummary({ slug: "test", summary: long });
  assert.ok(excerpt.length <= 166);
  assert.equal(excerpt.at(-1), "…");
  assert.ok(long.startsWith(excerpt.slice(0, -1) + " "));
});

test("chapter events roll over at midnight in Manila without implying a recap exists", () => {
  const scheduled = { iso: "2026-12-18", state: "planned", slug: "screening" };
  const later = { iso: "2026-12-24", state: "planned", slug: "later" };
  const recap = { iso: "2026-08-23", state: "completed", slug: "installation" };
  const sameDay = manilaDate(new Date("2026-12-18T15:59:59Z"));
  const nextDay = manilaDate(new Date("2026-12-18T16:00:00Z"));
  assert.equal(sameDay, "2026-12-18");
  assert.equal(nextDay, "2026-12-19");
  assert.equal(timeUntilManilaMidnight(Date.parse("2026-12-18T15:59:59Z")), 1000);
  assert.equal(timeUntilManilaMidnight(Date.parse("2026-12-18T16:00:00Z")), 86_400_000);
  assert.equal(calendarNeedsRefresh(scheduled.iso, new Date("2026-12-18T15:59:59Z")), false);
  assert.equal(calendarNeedsRefresh(scheduled.iso, new Date("2026-12-18T16:00:00Z")), true);
  assert.equal(calendarNeedsRefresh(undefined), false);
  assert.deepEqual(sortChapterEvents([later, recap, scheduled], sameDay), {
    upcoming: [scheduled, later],
    pending: [],
    completed: [recap],
  });
  assert.deepEqual(sortChapterEvents([later, recap, scheduled], nextDay), {
    upcoming: [later],
    pending: [scheduled],
    completed: [recap],
  });
});
