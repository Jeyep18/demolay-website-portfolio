import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { z } from "zod";
import { publishedPeriod } from "@/lib/report-period";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { terms, events, photos, reportAsOf } from "@/data/content";
import {
  formatMoney,
  formatDate,
  termSummary,
  termLabel,
  eventFinanceSummary,
  eventStatus,
} from "@/lib/finance";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const periods = terms.map((item) => item.id);
const searchSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  term: z.enum(["A", "B"]).optional(),
});
export const Route = createFileRoute("/transparency/")({
  validateSearch: (search) => {
    const result = searchSchema.safeParse(search);
    return result.success ? result.data : { year: 0, term: "B" as const };
  },
  head: () => ({
    meta: [
      { title: "Financial Transparency · Naga City Chapter No. 120" },
      ...(terms.length === 0 ? [{ name: "robots", content: "noindex, follow" }] : []),
      {
        name: "description",
        content: "Term budgets, funds received and activity expense reports.",
      },
    ],
  }),
  component: TransparencyPage,
});
function TransparencyPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (terms.length === 0) {
    return (
      <PublicPage>
        <PageIntro eyebrow="Naga City Chapter No. 120" title="Financial transparency">
          Financial reports will be published here after chapter review.
        </PageIntro>
        <div className="public-section back-links">
          <Link to="/">Return to the chapter homepage</Link>
        </div>
      </PublicPage>
    );
  }
  const period = publishedPeriod(periods, search.year, search.term);
  const term = terms.find((item) => item.id === period);
  const summary = term ? termSummary(term) : null;
  const percent =
    summary && summary.budgetComplete && summary.knownBudget > 0
      ? (summary.spent / summary.knownBudget) * 100
      : null;
  return (
    <PublicPage>
      <div className="finance-page-heading">
        <PageIntro eyebrow="Financial transparency" title="Purpose, accounted for.">
          A clear view of our resources, from the term’s plan to every project expense.
        </PageIntro>
        {terms.length > 0 && (
          <div className="term-selector finance-filter">
            <div>
              <label id="period-label">Reporting period</label>
              <Select
                value={term?.id ?? ""}
                onValueChange={(value) => {
                  const selected = terms.find((item) => item.id === value);
                  if (selected)
                    void navigate({
                      search: { year: selected.year, term: selected.half },
                      hash: "",
                    });
                }}
              >
                <SelectTrigger aria-labelledby="period-label">
                  <SelectValue placeholder="Choose a reporting period">
                    {term ? termLabel(term) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="term-options">
                  {terms.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {termLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reportAsOf && <p>Updated {formatDate(reportAsOf)} · Philippine time</p>}
          </div>
        )}
      </div>
      <section className="public-section finance-workspace">
        {terms.length > 0 && (
          <noscript>
            <nav className="back-links" aria-label="Available terms">
              {terms.map((item) => (
                <Link
                  key={item.id}
                  to="/transparency"
                  search={{ year: item.year, term: item.half }}
                >
                  {termLabel(item)}
                </Link>
              ))}
            </nav>
          </noscript>
        )}
        {!term || !summary ? (
          <div className="missing-report">
            <h2>Report unavailable.</h2>
            <p>There are no records for this term. Choose another reporting period.</p>
          </div>
        ) : (
          <>
            <div className="finance-period">
              <div>
                <p className="chapter-eyebrow">
                  {term.half === "A" ? "January–June" : "July–December"}
                </p>
                <h2>{termLabel(term)}</h2>
              </div>
              <span className="status-chip">{summary.termProjects.length} project allocations</span>
            </div>
            <div className="finance-dashboard-card">
              <dl className="finance-metrics">
                <div>
                  <dt>Total project budget</dt>
                  <dd>
                    {summary.budgetComplete ? formatMoney(summary.knownBudget) : "Incomplete"}
                  </dd>
                  <small>Proposed allocations</small>
                </div>
                <div>
                  <dt>Total spent</dt>
                  <dd>{formatMoney(summary.spent)}</dd>
                  <small>Recorded expenses to date</small>
                </div>
                <div>
                  <dt>
                    {summary.spent > summary.knownBudget ? "Over allocation" : "Unspent allocation"}
                  </dt>
                  <dd className={summary.spent > summary.knownBudget ? "over-budget" : ""}>
                    {summary.budgetComplete
                      ? formatMoney(Math.abs(summary.knownBudget - summary.spent))
                      : "Unavailable"}
                  </dd>
                  <small>Budget less actual spending</small>
                </div>
              </dl>
              <div className="budget-utilization">
                <div>
                  <span>Budget used</span>
                  <strong>
                    {percent === null ? "Percentage unavailable" : `${percent.toFixed(1)}%`}
                  </strong>
                </div>
                <div
                  className="budget-track"
                  role="img"
                  aria-label={
                    percent === null
                      ? "Budget utilization unavailable"
                      : `${percent.toFixed(1)} percent of proposed budget spent`
                  }
                >
                  <span
                    className={percent !== null && percent > 100 ? "over" : ""}
                    style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
                  />
                </div>
              </div>
              <div className="cash-strip">
                <span>
                  Cash available <strong>{formatMoney(summary.balance)}</strong>
                </span>
                <p>
                  Opening {formatMoney(term.opening)} + sponsors {formatMoney(summary.sponsors)} +
                  fundraising {formatMoney(summary.fundraising)} − spending{" "}
                  {formatMoney(summary.spent)}
                </p>
              </div>
            </div>
            <section className="finance-activities" aria-labelledby="activities-heading">
              <div className="finance-list-heading">
                <div>
                  <p className="chapter-eyebrow">Follow the spending</p>
                  <h2 id="activities-heading">Activities & projects</h2>
                </div>
                <p>Choose an activity for its expense breakdown.</p>
              </div>
              <div className="activity-column-labels" aria-hidden="true">
                <span>Activity</span>
                <span>Budget</span>
                <span>Spent</span>
                <span />
              </div>
              {events
                .filter((event) => event.termId === term.id)
                .map((event) => {
                  const report = eventFinanceSummary(event.slug);
                  const photo = photos[event.photoIndices[0]!];
                  const contents = (
                    <>
                      <div className="activity-identity">
                        {photo && (
                          <img src={photo.src} width="80" height="80" alt="" loading="lazy" />
                        )}
                        <div>
                          <span className="chapter-eyebrow">
                            {eventStatus(event)} · {formatDate(event.iso)}
                          </span>
                          <h3>{event.title}</h3>
                          <span
                            className={
                              report?.over !== null && report && report.over > 0
                                ? "over-budget"
                                : "muted"
                            }
                          >
                            {report
                              ? report.label
                              : "Financial report not provided · View activity"}
                          </span>
                        </div>
                      </div>
                      <div className="activity-number">
                        <small>Budget</small>
                        <strong>
                          {report?.proposed == null ? "Not reported" : formatMoney(report.proposed)}
                        </strong>
                      </div>
                      <div className="activity-number">
                        <small>Spent</small>
                        <strong>{report ? formatMoney(report.spent) : "Not reported"}</strong>
                      </div>
                      <ArrowUpRight aria-hidden="true" />
                    </>
                  );
                  return report ? (
                    <Link
                      className="activity-row"
                      key={event.slug}
                      to="/transparency/$slug"
                      params={{ slug: event.slug }}
                    >
                      {contents}
                    </Link>
                  ) : (
                    <Link
                      className="activity-row"
                      key={event.slug}
                      to="/events/$slug"
                      params={{ slug: event.slug }}
                    >
                      {contents}
                    </Link>
                  );
                })}
            </section>
            <details className="funding-details">
              <summary>
                Funding & proposed resources <span>View the supporting ledger</span>
              </summary>
              <div className="funding-grid">
                <div>
                  <h3>Proposed funding</h3>
                  <dl className="ledger-list">
                    {[
                      ["Opening cash", term.opening],
                      ["Sponsor target", term.proposedSponsors],
                      ["Fundraising target (gross)", term.proposedFundraising],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{formatMoney(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="muted">
                    Targets are separate from received funds. Opening cash is the previous term’s
                    remaining balance, not new income.
                  </p>
                </div>
                <div>
                  <h3>Received income</h3>
                  {summary.termIncome.map((item) => (
                    <div className="income-entry" key={item.id}>
                      <div>
                        <strong>{item.description}</strong>
                        <p>
                          {formatDate(item.date)} · {item.kind}
                        </p>
                      </div>
                      <span>{formatMoney(item.amount)}</span>
                    </div>
                  ))}
                  <p className="muted">
                    Fundraising receipts are gross. Fundraising costs are recorded in the activity
                    expense reports.
                  </p>
                </div>
              </div>
            </details>
          </>
        )}
      </section>
    </PublicPage>
  );
}
