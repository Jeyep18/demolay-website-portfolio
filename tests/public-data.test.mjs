import { publishedPeriod } from "../src/lib/report-period.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  events,
  articles,
  leaders,
  terms,
  income,
  projects,
  expenses,
  reportAsOf,
} from "../src/data/public-content.ts";
import {
  budgetVariance,
  eventStatus,
  formatDate,
  formatMoney,
  projectSummary as computeProject,
  termSummary as computeTerm,
  eventFinanceSummary as computeEvent,
} from "../src/lib/finance.ts";
const projectSummary = (project, entries = expenses) => computeProject(project, entries);
const termSummary = (term, receipts = income, allocations = projects, entries = expenses) => computeTerm(term, receipts, allocations, entries);
const eventFinanceSummary = (slug, allocations = projects, entries = expenses) => computeEvent(slug, allocations, entries);

test("activity summaries include fundraising once and preserve unknown and zero budgets", () => {
  for (const term of terms) {
    const reports = events
      .filter((event) => event.termId === term.id)
      .map((event) => eventFinanceSummary(event.slug))
      .filter(Boolean);
    assert.equal(
      reports.reduce((sum, report) => sum + report.spent, 0),
      termSummary(term).spent,
    );
    assert.equal(
      reports.reduce((sum, report) => sum + report.proposed, 0),
      termSummary(term).knownBudget,
    );
    for (const report of reports)
      assert.equal(
        report.categories.reduce((sum, [, amount]) => sum + amount, 0),
        report.spent,
      );
  }
  assert.equal(eventFinanceSummary("community-reading-day"), null);
  assert.equal(eventFinanceSummary("unknown"), null);
  assert.equal(termSummary(terms[0], [], [], []).budgetComplete, false);
  const project = { ...projects[0], proposed: null };
  assert.equal(eventFinanceSummary(project.eventSlug, [project]).proposed, null);
  assert.equal(eventFinanceSummary(project.eventSlug, [project]).over, null);
  const zero = eventFinanceSummary(project.eventSlug, [{ ...project, proposed: 0 }]);
  assert.equal(zero.percent, null);
  assert.equal(zero.label, "Over budget");
});

test("fixture references, dates and money stay coherent", () => {
  assert.equal(events.length, 4);
  assert.equal(events.filter((event) => event.state === "completed").length, 2);
  assert.equal(new Set(events.map((event) => event.slug)).size, 4);
  for (const collection of [terms, income, projects, expenses])
    assert.equal(new Set(collection.map((row) => row.id)).size, collection.length);
  for (const event of events) {
    assert.ok(terms.some((term) => term.id === event.termId));
    assert.equal(
      event.termId,
      `${event.iso.slice(0, 4)}-${Number(event.iso.slice(5, 7)) <= 6 ? "A" : "B"}`,
    );
  }
  for (const project of projects)
    assert.ok(
      events.some((event) => event.slug === project.eventSlug && event.termId === project.termId),
    );
  for (const entry of expenses) {
    assert.ok(projects.some((project) => project.id === entry.projectId));
    assert.ok(Number.isSafeInteger(entry.amount) && entry.amount >= 0);
    assert.ok(entry.date <= reportAsOf);
  }
  for (const entry of income) {
    assert.ok(terms.some((term) => term.id === entry.termId));
    assert.ok(Number.isSafeInteger(entry.amount) && entry.amount >= 0);
    assert.ok(entry.date <= reportAsOf);
  }
  for (const leader of leaders)
    assert.ok(
      events.some(
        (event) =>
          event.slug === leader.eventSlug &&
          event.termId === leader.termId &&
          event.state === "completed",
      ),
    );
  assert.deepEqual(
    articles.map((article) => article.slug),
    ["constitution-day", "seven-cardinal-virtues", "inside-the-lodge-room", "on-service"],
  );
});
test("cash reconciles and carryovers are not counted as income", () => {
  assert.deepEqual(
    terms.map((term) => termSummary(term).balance),
    [1850000, 2570000, 3360000],
  );
  terms.forEach((term, index) => {
    const summary = termSummary(term);
    assert.equal(
      summary.balance,
      term.opening + summary.sponsors + summary.fundraising - summary.spent,
    );
    if (index > 0) assert.equal(term.opening, termSummary(terms[index - 1]).balance);
  });
  assert.equal(termSummary(terms[2]).received, 1100000);
  assert.equal(termSummary(terms[2]).spent, 310000);
});
test("overspending, zero allocations and absent budgets remain distinct", () => {
  assert.equal(
    projectSummary(projects.find((project) => project.id === "leadership-workshop")).over,
    200000,
  );
  assert.equal(
    projectSummary(projects.find((project) => project.id === "leadership-workshop")).percent,
    20,
  );
  assert.equal(budgetVariance(100, 100).label, "On budget");
  assert.equal(budgetVariance(0, 0).label, "On budget");
  assert.deepEqual(budgetVariance(null, 500), {
    label: "Budget not provided",
    over: null,
    percent: null,
  });
  assert.equal(budgetVariance(0, 500).label, "Over budget");
  assert.equal(budgetVariance(0, 500).percent, null);
  assert.equal(
    projects.filter((project) => project.eventSlug === "community-reading-day").length,
    0,
  );
  assert.equal(
    terms.find((term) => term.id === "2025-A"),
    undefined,
  );
});
test("date passing does not manufacture completion and PHP uses centavos", () => {
  const planned = events.find((event) => event.slug === "brotherhood-benefit-night");
  assert.equal(eventStatus(planned, "2026-10-15"), "Upcoming");
  assert.equal(eventStatus(planned, "2026-11-16"), "Date passed · report pending");
  assert.equal(eventStatus(events[0], "2026-10-15"), "Completed");
  assert.equal(formatDate("2026-11-15"), "November 15, 2026");
  assert.equal(formatMoney(12345), "₱123.45");
});

test("report links resolve only published periods, including partial links and an empty archive", () => {
  const periods = ["2025-A", "2026-B", "2028-A"];
  assert.equal(publishedPeriod([]), undefined);
  assert.equal(publishedPeriod(periods), "2028-A");
  assert.equal(publishedPeriod(periods, 2025), "2025-A");
  assert.equal(publishedPeriod(periods, undefined, "B"), "2026-B");
  assert.equal(publishedPeriod(periods, 2028, "B"), undefined);
  assert.equal(publishedPeriod(periods, NaN, "A"), undefined);
});
