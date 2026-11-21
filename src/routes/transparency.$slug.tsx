import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { PublicPage, PageIntro } from "@/components/PublicPage";
import { BudgetStatus } from "@/components/ContentCards";
import { events, terms } from "@/data/content";
import {
  eventFinanceSummary,
  formatMoney,
  formatDate,
  termLabel,
  eventStatus,
} from "@/lib/finance";

export const Route = createFileRoute("/transparency/$slug")({
  loader: ({ params }) => {
    const event = events.find((item) => item.slug === params.slug);
    const report = eventFinanceSummary(params.slug);
    if (!event || !report) throw notFound();
    return { event };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.event.title ?? "Report unavailable"} · Expense report` }],
  }),
  notFoundComponent: () => (
    <PublicPage>
      <PageIntro eyebrow="Transparency" title="Report unavailable.">
        No financial records are available for this activity.{" "}
        <Link to="/transparency">
          Back to transparency
        </Link>
      </PageIntro>
    </PublicPage>
  ),
  component: ExpenseReport,
});
function ExpenseReport() {
  const { event } = Route.useLoaderData();
  const report = eventFinanceSummary(event.slug)!;
  const term = terms.find((item) => item.id === event.termId)!;
  return (
    <PublicPage>
      <PageIntro eyebrow={`${termLabel(term)} · Expense report`} title={event.title}>
        {eventStatus(event)} · {formatDate(event.iso)}. Project and supporting fundraising expenses,
        recorded together.
      </PageIntro>
      <div className="public-section expense-workspace">
        <Link
          className="finance-back"
          to="/transparency"
          search={{ year: term.year, term: term.half }}
        >
          <ArrowLeft aria-hidden="true" /> {termLabel(term)} dashboard
        </Link>
        <div className="finance-dashboard-card">
          <dl className="finance-metrics">
            <div>
              <dt>Proposed budget</dt>
              <dd>{report.proposed === null ? "Not provided" : formatMoney(report.proposed)}</dd>
            </div>
            <div>
              <dt>Total spent</dt>
              <dd>{formatMoney(report.spent)}</dd>
            </div>
            <div>
              <dt>
                {report.over !== null && report.over > 0 ? "Over allocation" : "Unspent allocation"}
              </dt>
              <dd className={report.over !== null && report.over > 0 ? "over-budget" : ""}>
                {report.over === null ? "Unavailable" : formatMoney(Math.abs(report.over))}
              </dd>
            </div>
          </dl>
          <div className="expense-categories">
            <h2>Spending by category</h2>
            {report.categories.map(([category, amount]) => (
              <div className="category-row" key={category}>
                <div>
                  <span>{category}</span>
                  <strong>{formatMoney(amount)}</strong>
                </div>
                <div className="budget-track">
                  <span
                    style={{ width: `${report.spent > 0 ? (amount / report.spent) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="finance-list-heading">
          <div>
            <p className="chapter-eyebrow">The detailed record</p>
            <h2>Every expense, explained.</h2>
          </div>
          <p>Amounts in Philippine pesos.</p>
        </div>
        {report.records.map(({ project, items, spent }) => (
          <section className="expense-project" id={project.id} key={project.id}>
            <div className="expense-project-heading">
              <div>
                <h3>{project.title}</h3>
                <p>{project.responsible}</p>
              </div>
              <BudgetStatus project={project} />
            </div>
            <p className="muted">{project.notes}</p>
            <p className="project-allocation">
              Proposed allocation:{" "}
              <strong>
                {project.proposed === null ? "Not provided" : formatMoney(project.proposed)}
              </strong>
            </p>
            <div className="expense-ledger" role="table" aria-label={`${project.title} expenses`}>
              <div className="expense-ledger-head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Item & category</span>
                <span role="columnheader">Responsible officer</span>
                <span role="columnheader">Amount</span>
              </div>
              {items.map((item) => (
                <div className="expense-line" role="row" key={item.id}>
                  <span role="cell" className="expense-date">
                    {formatDate(item.date)}
                  </span>
                  <div role="cell" className="expense-item">
                    <strong>{item.description}</strong>
                    <span>{item.category}</span>
                  </div>
                  <span role="cell" className="expense-owner">
                    {item.responsible}
                  </span>
                  <strong role="cell" className="expense-amount">
                    {formatMoney(item.amount)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="expense-subtotal">
              <span>Project subtotal</span>
              <strong>{formatMoney(spent)}</strong>
            </div>
          </section>
        ))}
        <div className="expense-story-link">
          <div>
            <h2>The story behind the numbers.</h2>
            <p className="muted">Explore the activity, its purpose and the people involved.</p>
          </div>
          <Link className="finance-primary" to="/events/$slug" params={{ slug: event.slug }}>
            Read event report <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </PublicPage>
  );
}
