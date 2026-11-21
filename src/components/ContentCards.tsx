import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { photos, type EventItem, terms } from "@/data/content";
import {
  eventStatus,
  formatDate,
  formatMoney,
  termLabel,
  termSummary,
  projectSummary,
  eventFinanceSummary,
} from "@/lib/finance";
import type { Term, Project } from "@/data/content";
export function EventCard({ event, today }: { event: EventItem; today?: string | undefined }) {
  const photo = photos[event.photoIndices[0]!];
  return (
    <Link to="/events/$slug" params={{ slug: event.slug }} className="event-card">
      {photo && (
        <div className={`event-card-image${photo.width < photo.height ? " is-portrait" : ""}`}>
          <img src={photo.src} alt="" width={photo.width} height={photo.height} loading="lazy" />
        </div>
      )}
      <div className="event-card-copy">
        <p className="chapter-eyebrow">
          {eventStatus(event, today)} · <time dateTime={event.iso}>{formatDate(event.iso)}</time>
        </p>
        <h3>{event.title}</h3>
        <p>{event.summary}</p>
        <span className="card-read">
          {event.state === "completed" ? "Read the recap" : "View event details"}{" "}
          <ArrowUpRight aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
export function FinanceOverview({ term }: { term: Term | undefined }) {
  if (!term)
    return (
      <div className="chapter-finance-report">
        <h3>Reports will appear here.</h3>
        <p>The chapter has not published a financial report yet.</p>
      </div>
    );
  const summary = termSummary(term);
  return (
    <div className="chapter-finance-report">
      <div className="chapter-report-top">
        <p>{termLabel(term)} · Funds at a glance</p>
      </div>
      <dl className="finance-stats">
        {[
          ["Opening cash", term.opening],
          ["Sponsor receipts", summary.sponsors],
          ["Fundraising receipts", summary.fundraising],
          ["Spent to date", summary.spent],
          ["Remaining cash", summary.balance],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney(Number(value))}</dd>
          </div>
        ))}
      </dl>
      <p className="chapter-finance-footnote">
        Opening cash + received income − expenses = remaining cash.
      </p>
      <Link
        className="report-link"
        to="/transparency"
        search={{ year: term.year, term: term.half }}
      >
        View the term report <ArrowUpRight aria-hidden="true" />
      </Link>
    </div>
  );
}
export function BudgetStatus({ project }: { project: Project }) {
  const summary = projectSummary(project);
  return (
    <span
      className={`budget-status ${summary.over !== null && summary.over > 0 ? "over-budget" : ""}`}
    >
      {summary.label}
      {summary.over !== null
        ? ` · ${formatMoney(Math.abs(summary.over))}${summary.percent === null ? " (percentage unavailable for zero budget)" : ` (${Math.abs(summary.percent).toFixed(1)}%${summary.over < 0 ? " unspent" : ""})`}`
        : ""}
    </span>
  );
}
export function EventFinance({ slug }: { slug: string }) {
  const summary = eventFinanceSummary(slug);
  if (!summary) return null;
  const term = terms.find((item) => item.id === summary.records[0]!.project.termId)!;
  return (
    <section className="event-finance finance-compact" id="event-finance">
      <div>
        <p className="chapter-eyebrow">Financial overview · {termLabel(term)}</p>
        <h2>Resources behind the purpose.</h2>
        <p className={summary.over !== null && summary.over > 0 ? "over-budget" : "muted"}>
          {summary.label} · Includes supporting fundraising costs.
        </p>
      </div>
      <dl className="finance-metrics">
        <div>
          <dt>Proposed budget</dt>
          <dd>{summary.proposed === null ? "Not provided" : formatMoney(summary.proposed)}</dd>
        </div>
        <div>
          <dt>Spent to date</dt>
          <dd>{formatMoney(summary.spent)}</dd>
        </div>
        <div>
          <dt>
            {summary.over !== null && summary.over > 0 ? "Over allocation" : "Unspent allocation"}
          </dt>
          <dd>{summary.over === null ? "Unavailable" : formatMoney(Math.abs(summary.over))}</dd>
        </div>
      </dl>
      <Link className="finance-primary" to="/transparency/$slug" params={{ slug }}>
        View expense breakdown <ArrowUpRight aria-hidden="true" />
      </Link>
    </section>
  );
}
