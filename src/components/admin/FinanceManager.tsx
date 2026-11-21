import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type Api,
  Field,
  Notice,
  RemoteState,
  TextField,
  errorMessage,
  textValue,
  useRemote,
  useUnsaved,
} from "./shared";
import { centavosToPesos } from "./money";
import { financePayloadSchema, pesosToCentavos } from "@/lib/cms-schema";

type FinancialRow = Record<string, string>;
type FinancePayload = {
  term: Record<string, string | number>;
  projects: Record<string, string | number | null>[];
  income: Record<string, string | number>[];
  expenses: Record<string, string | number>[];
};
type FinanceRecord = {
  payload: FinancePayload;
  version: number;
  status: string;
  term?: FinancePayload["term"];
  projects?: FinancePayload["projects"];
  income?: FinancePayload["income"];
  expenses?: FinancePayload["expenses"];
};
type Group = "projects" | "income" | "expenses";
const columns: Record<Group, { key: string; label: string; type?: string; optional?: boolean }[]> =
  {
    projects: [
      { key: "id", label: "Project ID" },
      { key: "title", label: "Title" },
      { key: "eventSlug", label: "Related event slug" },
      { key: "termId", label: "Term ID" },
      { key: "proposed", label: "Proposed budget (₱)", optional: true },
      { key: "responsible", label: "Responsible person" },
      { key: "notes", label: "Notes", optional: true },
    ],
    income: [
      { key: "id", label: "Income ID" },
      { key: "termId", label: "Term ID" },
      { key: "date", label: "Date", type: "date" },
      { key: "kind", label: "Source" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount (₱)" },
    ],
    expenses: [
      { key: "id", label: "Expense ID" },
      { key: "projectId", label: "Project ID" },
      { key: "date", label: "Date", type: "date" },
      { key: "category", label: "Category" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount (₱)" },
      { key: "responsible", label: "Responsible person" },
    ],
  };
function editableRows(rows: Record<string, string | number | null>[]): FinancialRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        (key === "amount" || key === "proposed") && typeof value === "number"
          ? centavosToPesos(value)
          : textValue(value),
      ]),
    ),
  );
}
function reportPayload(record: FinanceRecord): FinancePayload {
  return (
    record.payload || {
      term: record.term!,
      projects: record.projects || [],
      income: record.income || [],
      expenses: record.expenses || [],
    }
  );
}

export function FinanceManager({ api, owner }: { api: Api; owner: boolean }) {
  const list = useRemote<{ items: FinanceRecord[] }>(api, "/api/admin/finance");
  const [editing, setEditing] = useState<FinanceRecord | null | undefined>();
  if (editing !== undefined)
    return (
      <FinanceEditor
        api={api}
        owner={owner}
        initial={editing}
        close={() => {
          setEditing(undefined);
          list.reload();
        }}
      />
    );
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>Finances</h2>
          <p>
            Maintain complete term reports. Publication checks opening balances and publishes the
            whole report together.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>Create term report</Button>
      </div>
      <RemoteState {...list} retry={list.reload} />
      {list.data && (
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col">Status</th>
                <th scope="col">Revision</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item, index) => (
                <tr key={index}>
                  <th scope="row">{textValue(reportPayload(item).term["id"])}</th>
                  <td>{item.status}</td>
                  <td>{item.version}</td>
                  <td>
                    <Button variant="outline" onClick={() => setEditing(item)}>
                      Open report
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.items.length === 0 && (
            <p className="admin-empty">
              No term reports yet. Create a report using verified chapter records.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function FinanceEditor({
  api,
  owner,
  initial,
  close,
}: {
  api: Api;
  owner: boolean;
  initial: FinanceRecord | null;
  close: () => void;
}) {
  const starting = initial ? reportPayload(initial) : null;
  const [saved, setSaved] = useState(initial);
  const [term, setTerm] = useState<FinancialRow>(
    starting
      ? Object.fromEntries(
          Object.entries(starting.term).map(([key, value]) => [
            key,
            ["opening", "proposedSponsors", "proposedFundraising"].includes(key) &&
            typeof value === "number"
              ? centavosToPesos(value)
              : textValue(value),
          ]),
        )
      : { id: "", year: "", half: "A", opening: "", proposedSponsors: "", proposedFundraising: "" },
  );
  const [rows, setRows] = useState<Record<Group, FinancialRow[]>>({
    projects: editableRows(starting?.projects || []),
    income: editableRows(starting?.income || []),
    expenses: editableRows(starting?.expenses || []),
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(false);
  useUnsaved(dirty);
  const updateTerm = (key: string, value: string) => {
    setTerm((old) => ({ ...old, [key]: value }));
    setDirty(true);
    setPreview(false);
  };
  const updateRows = (group: Group, next: FinancialRow[]) => {
    setRows((old) => ({ ...old, [group]: next }));
    setDirty(true);
    setPreview(false);
  };
  const cancel = () => {
    if (!dirty || window.confirm("Discard unsaved report changes?")) close();
  };
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const year = Number(term["year"]);
      if (
        !Number.isInteger(year) ||
        year < 1900 ||
        year > 2200 ||
        term["id"] !== `${year}-${term["half"]}`
      )
        throw new Error("Term ID must match its year and half, for example 2026-A.");
      for (const group of ["projects", "income", "expenses"] as const) {
        const ids = rows[group].map((row) => row["id"]);
        if (new Set(ids).size !== ids.length) throw new Error(`${group}: IDs must be unique.`);
      }
      for (const row of [...rows.projects, ...rows.income])
        if (row["termId"] !== term["id"])
          throw new Error("Every project and income row must use this term ID.");
      for (const expense of rows.expenses)
        if (!rows.projects.some((project) => project["id"] === expense["projectId"]))
          throw new Error("Every expense must refer to a project in this report.");
      const payload = {
        term: {
          ...term,
          year,
          opening: pesosToCentavos(term["opening"] || ""),
          proposedSponsors: pesosToCentavos(term["proposedSponsors"] || ""),
          proposedFundraising: pesosToCentavos(term["proposedFundraising"] || ""),
        },
        projects: rows.projects.map((row) => ({
          ...row,
          proposed: row["proposed"] ? pesosToCentavos(row["proposed"]) : null,
        })),
        income: rows.income.map((row) => ({
          ...row,
          amount: pesosToCentavos(row["amount"] || ""),
        })),
        expenses: rows.expenses.map((row) => ({
          ...row,
          amount: pesosToCentavos(row["amount"] || ""),
        })),
      };
      const result = await api<FinanceRecord>("/api/admin/finance", {
        payload: financePayloadSchema.parse(payload),
        expectedVersion: saved?.version ?? null,
      });
      setSaved({ ...result, payload: result.payload || payload });
      setDirty(false);
      setPreview(false);
      setNotice("Report draft saved. Review the complete report before publication.");
    } catch (cause) {
      setError(
        cause instanceof Error && "issues" in cause
          ? "Some report fields are invalid. Check all required text, dates, IDs and peso amounts."
          : cause instanceof Error && !("status" in cause) && !(cause instanceof TypeError)
            ? cause.message
            : errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!saved || dirty || !preview || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/finance/publish", {
        termId: term["id"],
        expectedVersion: saved.version,
        reason,
      });
      setSaved({ ...saved, status: "published" });
      setNotice("Report approved. Public pages update after a successful rebuild.");
      setReason("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>{saved ? "Edit term report" : "New term report"}</h2>
          <p>
            Enter pesos with up to two decimal places, without commas. Amounts are stored exactly as
            centavos.{dirty && " Unsaved changes."}
          </p>
        </div>
        <Button variant="outline" onClick={cancel}>
          Back to finances
        </Button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>Term</legend>
          <div className="admin-form-grid">
            {[
              { key: "id", label: "Term ID" },
              { key: "year", label: "Year", type: "number" },
              { key: "opening", label: "Opening balance (₱)" },
              { key: "proposedSponsors", label: "Proposed sponsorship (₱)" },
              { key: "proposedFundraising", label: "Proposed fundraising (₱)" },
            ].map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                required
                type={field.type || "text"}
                value={term[field.key] || ""}
                onChange={(value) => updateTerm(field.key, value)}
              />
            ))}
            <Field label="Term half" required>
              {(id) => (
                <select
                  id={id}
                  value={term["half"]}
                  onChange={(e) => updateTerm("half", e.target.value)}
                >
                  <option value="A">A · First half</option>
                  <option value="B">B · Second half</option>
                </select>
              )}
            </Field>
          </div>
          {(["projects", "income", "expenses"] as Group[]).map((group) => (
            <fieldset className="admin-subsection" key={group}>
              <legend>{group[0]!.toUpperCase() + group.slice(1)}</legend>
              {rows[group].length === 0 && <p>No {group} entered.</p>}
              {rows[group].map((row, index) => (
                <div className="admin-repeatable" key={index}>
                  <h4>
                    {group === "projects" ? "Project" : group === "income" ? "Income" : "Expense"}{" "}
                    {index + 1}
                  </h4>
                  <div className="admin-form-grid">
                    {columns[group].map((column) =>
                      column.key === "kind" ? (
                        <Field key={column.key} label="Income source" required>
                          {(id) => (
                            <select
                              id={id}
                              value={row["kind"]}
                              onChange={(e) =>
                                updateRows(
                                  group,
                                  rows[group].map((item, i) =>
                                    i === index ? { ...item, kind: e.target.value } : item,
                                  ),
                                )
                              }
                            >
                              <option value="sponsor">Sponsor</option>
                              <option value="fundraising">Fundraising</option>
                            </select>
                          )}
                        </Field>
                      ) : (
                        <TextField
                          key={column.key}
                          label={column.label}
                          required={!column.optional}
                          type={column.type || "text"}
                          value={row[column.key] || ""}
                          onChange={(value) =>
                            updateRows(
                              group,
                              rows[group].map((item, i) =>
                                i === index ? { ...item, [column.key]: value } : item,
                              ),
                            )
                          }
                        />
                      ),
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this draft row? Save the report to keep the removal.",
                        )
                      )
                        updateRows(
                          group,
                          rows[group].filter((_, i) => i !== index),
                        );
                    }}
                  >
                    Remove{" "}
                    {group === "projects" ? "project" : group === "income" ? "income" : "expense"}{" "}
                    {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  updateRows(group, [
                    ...rows[group],
                    Object.fromEntries(
                      columns[group].map((column) => [
                        column.key,
                        column.key === "id"
                          ? crypto.randomUUID()
                          : column.key === "termId"
                            ? term["id"] || ""
                            : column.key === "kind"
                              ? "sponsor"
                              : "",
                      ]),
                    ),
                  ])
                }
              >
                Add {group === "projects" ? "project" : group === "income" ? "income" : "expense"}
              </Button>
            </fieldset>
          ))}
          <div className="admin-actions">
            <Button type="submit" disabled={busy || (!dirty && !!saved)}>
              {busy ? "Saving…" : "Save report draft"}
            </Button>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </form>
      {saved && (
        <div className="admin-publication">
          <h3>Review report</h3>
          <Button variant="outline" disabled={dirty || busy} onClick={() => setPreview(!preview)}>
            {preview ? "Close report preview" : "Preview saved report"}
          </Button>
          {preview && <FinancePreview payload={reportPayload(saved)} />}
          {owner && (
            <>
              <TextField label="Publication reason" required value={reason} onChange={setReason} />
              <Button
                disabled={
                  dirty || busy || !preview || !reason.trim() || saved.status === "published"
                }
                onClick={publish}
              >
                Approve and publish report
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FinancePreview({ payload }: { payload: FinancePayload }) {
  return (
    <div className="admin-preview">
      <h3>Term {textValue(payload.term["id"])}</h3>
      <dl>
        {Object.entries(payload.term).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {["opening", "proposedSponsors", "proposedFundraising"].includes(key) &&
              typeof value === "number"
                ? `₱${centavosToPesos(value)}`
                : textValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      {(["projects", "income", "expenses"] as Group[]).map((group) => (
        <section key={group}>
          <h4>{group[0]!.toUpperCase() + group.slice(1)}</h4>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  {columns[group].map((column) => (
                    <th scope="col" key={column.key}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payload[group].map((row, index) => (
                  <tr key={index}>
                    {columns[group].map((column) => (
                      <td key={column.key}>
                        {(column.key === "amount" || column.key === "proposed") &&
                        typeof row[column.key] === "number"
                          ? centavosToPesos(row[column.key] as number)
                          : textValue(row[column.key]) || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
