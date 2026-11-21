import { expenses, income, projects } from "../data/content.ts";
import type { Expense, Income, Project, Term } from "../data/public-content.ts";
import { manilaDate } from "./chapter-events.ts";

export const formatMoney = (centavos: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: centavos % 100 === 0 ? 0 : 2,
  }).format(centavos / 100);
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(`${iso}T00:00:00+08:00`));
export const termLabel = (term: Term) => `${term.year} Term ${term.half}`;
export function budgetVariance(proposed: number | null, spent: number) {
  if (proposed === null) return { label: "Budget not provided", over: null, percent: null };
  const over = spent - proposed;
  return {
    label: over > 0 ? "Over budget" : over === 0 ? "On budget" : "Within budget",
    over,
    percent: proposed === 0 ? null : (over / proposed) * 100,
  };
}
export function projectSummary(project: Project, entries: Expense[] = expenses) {
  const items = entries.filter((item) => item.projectId === project.id);
  const spent = items.reduce((sum, item) => sum + item.amount, 0);
  return { items, spent, ...budgetVariance(project.proposed, spent) };
}
export function eventFinanceSummary(
  slug: string,
  allocations: Project[] = projects,
  entries: Expense[] = expenses,
) {
  const matching = allocations.filter((project) => project.eventSlug === slug);
  if (!matching.length) return null;
  const records = matching.map((project) => ({ project, ...projectSummary(project, entries) }));
  const spent = records.reduce((sum, record) => sum + record.spent, 0);
  const proposed = matching.every((project) => project.proposed !== null)
    ? matching.reduce((sum, project) => sum + project.proposed!, 0)
    : null;
  const categories = new Map<string, number>();
  for (const record of records)
    for (const item of record.items)
      categories.set(item.category, (categories.get(item.category) ?? 0) + item.amount);
  return {
    records,
    spent,
    proposed,
    categories: [...categories],
    ...budgetVariance(proposed, spent),
  };
}
export function termSummary(
  term: Term,
  receipts: Income[] = income,
  allocations: Project[] = projects,
  entries: Expense[] = expenses,
) {
  const termProjects = allocations.filter((project) => project.termId === term.id);
  const termIncome = receipts.filter((item) => item.termId === term.id);
  const sponsors = termIncome
    .filter((item) => item.kind === "sponsor")
    .reduce((sum, item) => sum + item.amount, 0);
  const fundraising = termIncome
    .filter((item) => item.kind === "fundraising")
    .reduce((sum, item) => sum + item.amount, 0);
  const spent = termProjects.reduce(
    (sum, project) => sum + projectSummary(project, entries).spent,
    0,
  );
  const knownBudget = termProjects.reduce((sum, project) => sum + (project.proposed ?? 0), 0);
  return {
    termProjects,
    termIncome,
    sponsors,
    fundraising,
    spent,
    knownBudget,
    budgetComplete:
      termProjects.length > 0 && termProjects.every((project) => project.proposed !== null),
    received: sponsors + fundraising,
    balance: term.opening + sponsors + fundraising - spent,
  };
}
export function eventStatus(
  event: { state: "planned" | "completed"; iso: string },
  today = manilaDate(),
) {
  if (event.state === "completed") return "Completed";
  return event.iso >= today ? "Upcoming" : "Date passed · report pending";
}
