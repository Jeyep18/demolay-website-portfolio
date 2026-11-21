import { z } from "zod";
import {
  contentKindSchema,
  payloadSchemas,
  financePayloadSchema,
  slugSchema,
} from "./cms-schema.ts";
import type {
  Article,
  EventItem,
  Photo,
  TimelineEntry,
  Term,
  Project,
  Income,
  Expense,
} from "../data/public-content";

const recordSchema = z
  .object({
    id: z.string().uuid(),
    kind: contentKindSchema,
    slug: slugSchema,
    title: z.string().max(200),
    payload: z.unknown(),
    media_ids: z.array(z.string().uuid()).max(20),
  })
  .strict();
const mediaSchema = z
  .object({
    id: z.string().uuid(),
    alt: z.string().min(1).max(500),
    caption: z.string().max(1000),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
    public_path: z.string().regex(/^[0-9a-f-]{36}\.webp$/i),
  })
  .strict();
export const snapshotSchema = z
  .object({
    revision: z.union([z.string(), z.number()]).nullable(),
    content: z.array(recordSchema),
    media: z.array(mediaSchema),
    finance: z.array(financePayloadSchema),
  })
  .strict();
export type PublicSnapshot = z.infer<typeof snapshotSchema>;

export function readPublicSnapshot(input: unknown, storageOrigin: string) {
  const data = snapshotSchema.parse(input);
  const origin = storageOrigin ? new URL(storageOrigin).origin : "";
  if (data.media.length && (!origin.startsWith("https://") || !origin.endsWith(".supabase.co")))
    throw new Error("Approved media requires a Supabase HTTPS origin.");
  const photos: Photo[] = data.media.map((m) => ({
    src: `${origin}/storage/v1/object/public/cms-public/${m.public_path}`,
    alt: m.alt,
    caption: m.caption,
    width: m.width,
    height: m.height,
  }));
  const indices = new Map(data.media.map((m, i) => [m.id, i]));
  const events: EventItem[] = [];
  const articles: Article[] = [];
  const history: TimelineEntry[] = [];
  const leaders: {
    name: string;
    termId: string;
    eventSlug: string;
    summary: string;
    lesson: string;
    photoIndices: number[];
  }[] = [];
  const settings: Record<string, { title: string; body: string[] }> = {};
  const policies: Record<string, { title: string; body: string[] }> = {};
  for (const record of data.content) {
    const photoIndices = record.media_ids.map((id) => {
      const index = indices.get(id);
      if (index === undefined) throw new Error("A published photo is missing from the snapshot.");
      return index;
    });
    if (record.kind === "event")
      events.push({
        ...payloadSchemas.event.parse(record.payload),
        slug: record.slug,
        title: record.title,
        photoIndices,
      });
    if (record.kind === "article")
      articles.push({
        ...payloadSchemas.article.parse(record.payload),
        slug: record.slug,
        title: record.title,
        image: photoIndices.length ? photos[photoIndices[0]!]!.src : "/images/chapter-seal.webp",
      });
    if (record.kind === "history")
      history.push({ ...payloadSchemas.history.parse(record.payload), title: record.title });
    if (record.kind === "officer")
      leaders.push({ ...payloadSchemas.officer.parse(record.payload), photoIndices });
    if (record.kind === "settings")
      settings[record.slug] = {
        title: record.title,
        ...payloadSchemas.settings.parse(record.payload),
      };
    if (record.kind === "policy")
      policies[record.slug] = {
        title: record.title,
        ...payloadSchemas.policy.parse(record.payload),
      };
  }
  const terms: Term[] = [];
  const projects: Project[] = [];
  const income: Income[] = [];
  const expenses: Expense[] = [];
  for (const report of data.finance) {
    const scoped = (id: string) => `${report.term.id}--${id}`;
    terms.push(report.term);
    projects.push(...report.projects.map((project) => ({ ...project, id: scoped(project.id) })));
    income.push(...report.income.map((entry) => ({ ...entry, id: scoped(entry.id) })));
    expenses.push(
      ...report.expenses.map((entry) => ({
        ...entry,
        id: scoped(entry.id),
        projectId: scoped(entry.projectId),
      })),
    );
  }
  terms.sort((a, b) => a.id.localeCompare(b.id));
  return {
    events,
    articles,
    photos,
    history,
    leaders,
    settings,
    policies,
    terms,
    projects,
    income,
    expenses,
    revision: data.revision,
  };
}
