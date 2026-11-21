import { z } from "zod";

const text = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      // eslint-disable-next-line no-control-regex -- Reject controls at the input boundary, allowing newlines and tabs.
      (s) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s),
      "Use plain text without HTML or control characters.",
    );
const required = (max = 200) => text(max).refine(Boolean, "This field is required.");
const paragraphs = z.array(required(5000)).min(1).max(80);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  }, "Choose a valid date.");
const money = z.number().int().min(0).max(9_000_000_000_000);
const termId = z.string().regex(/^\d{4}-[AB]$/);
export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const contentKindSchema = z.enum([
  "event",
  "article",
  "history",
  "officer",
  "settings",
  "policy",
]);
export type ContentKind = z.infer<typeof contentKindSchema>;
export const payloadSchemas = {
  event: z
    .object({
      iso: day,
      time: required(80),
      place: required(300),
      state: z.enum(["planned", "completed"]),
      termId,
      host: required(),
      lead: required(),
      summary: required(1500),
      sections: z
        .array(z.object({ id: slugSchema, title: required(), paragraphs }).strict())
        .max(20),
    })
    .strict(),
  article: z
    .object({ date: day, kicker: required(), excerpt: required(1500), body: paragraphs })
    .strict(),
  history: z
    .object({
      year: required(20),
      label: required(),
      snippet: required(1500),
      body: z.array(required(5000)).max(80),
    })
    .strict(),
  officer: z
    .object({
      name: required(),
      termId,
      eventSlug: slugSchema,
      summary: required(5000),
      lesson: required(5000),
    })
    .strict(),
  settings: z.object({ body: paragraphs }).strict(),
  policy: z.object({ body: paragraphs }).strict(),
};
export const saveContentSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: contentKindSchema,
    slug: slugSchema,
    title: required(),
    payload: z.unknown(),
    mediaIds: z.array(z.string().uuid()).max(20).default([]),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const parsed = payloadSchemas[record.kind].safeParse(record.payload);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
    if (record.id && !record.expectedVersion)
      ctx.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "Reload this draft before saving.",
      });
    if (new Set(record.mediaIds).size !== record.mediaIds.length)
      ctx.addIssue({ code: "custom", path: ["mediaIds"], message: "Choose each photo once." });
  });
export const actionSchema = z
  .object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    action: z.enum(["submit", "publish", "archive"]),
    reason: text(1000).default(""),
  })
  .strict()
  .refine(
    (a) => a.action === "submit" || a.reason.length >= 5,
    "Explain this publication or archive action in at least five characters.",
  );
const term = z
  .object({
    id: termId,
    year: z.number().int().min(1900).max(2200),
    half: z.enum(["A", "B"]),
    opening: money,
    proposedSponsors: money,
    proposedFundraising: money,
  })
  .strict()
  .refine((t) => t.id === `${t.year}-${t.half}`, "Term ID must match its year and half.");
const id = required(100);
export const financePayloadSchema = z
  .object({
    term,
    projects: z
      .array(
        z
          .object({
            id,
            title: required(),
            eventSlug: slugSchema,
            termId,
            proposed: money.nullable(),
            notes: text(),
            responsible: required(),
          })
          .strict(),
      )
      .max(100),
    income: z
      .array(
        z
          .object({
            id,
            termId,
            date: day,
            kind: z.enum(["sponsor", "fundraising"]),
            description: required(),
            amount: money,
          })
          .strict(),
      )
      .max(1000),
    expenses: z
      .array(
        z
          .object({
            id,
            projectId: id,
            date: day,
            category: required(),
            description: required(),
            amount: money,
            responsible: required(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const key of ["projects", "income", "expenses"] as const)
      if (new Set(p[key].map((r) => r.id)).size !== p[key].length)
        ctx.addIssue({ code: "custom", path: [key], message: "Every row needs a unique ID." });
    const projects = new Set(p.projects.map((r) => r.id));
    if (
      p.projects.some((r) => r.termId !== p.term.id) ||
      p.income.some((r) => r.termId !== p.term.id) ||
      p.expenses.some((r) => !projects.has(r.projectId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Financial rows must belong to this term and its projects.",
      });
  });
export const saveFinanceSchema = z
  .object({
    payload: financePayloadSchema,
    expectedVersion: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const publishFinanceSchema = z
  .object({ termId, expectedVersion: z.number().int().positive(), reason: required(1000) })
  .strict();
export const staffSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    role: z.enum(["owner", "editor"]),
    active: z.boolean(),
  })
  .strict();

export function pesosToCentavos(input: string): number {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input))
    throw new Error("Enter pesos with up to two decimal places.");
  const [whole, fraction = ""] = input.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return money.parse(amount);
}
