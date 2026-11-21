import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArticleBody, EventMetadata, StoryHero, StorySections } from "@/components/ContentStory";
import { eventStatus, formatDate } from "@/lib/finance";
import { payloadSchemas } from "@/lib/cms-schema";
import {
  type Api,
  type Content,
  type Kind,
  type Media,
  itemsOf,
  Field,
  MediaChooser,
  Notice,
  ParagraphField,
  RemoteState,
  TextField,
  errorMessage,
  paragraphText,
  paragraphs,
  textValue,
  useRemote,
  useUnsaved,
} from "./shared";

const identitySchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a URL slug.")
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens."),
});
type Identity = z.infer<typeof identitySchema>;
type Section = { id: string; title: string; paragraphs: string[] };
const labels: Record<Kind, string> = {
  event: "Events",
  article: "Articles",
  history: "History",
  officer: "Officers",
  settings: "Chapter settings",
  policy: "Policies",
};
const fields: Record<
  Kind,
  {
    key: string;
    label: string;
    type?: string;
    hint?: string;
    multiline?: boolean;
    required?: boolean;
  }[]
> = {
  event: [
    { key: "iso", label: "Event date", type: "date", required: true },
    {
      key: "time",
      label: "Start time (Philippine time)",
      type: "time",
      required: true,
      hint: "Choose the event start time. Existing descriptions with a time range can be kept as text.",
    },
    { key: "place", label: "Venue", required: true },
    {
      key: "termId",
      label: "Reporting term",
      required: true,
      hint: "Enter the year and term letter, for example 2026-A or 2026-B. Use the matching term in Finances.",
    },
    { key: "host", label: "Host", required: true },
    { key: "lead", label: "Project lead", required: true },
    { key: "summary", label: "Summary", multiline: true, required: true },
  ],
  article: [
    { key: "date", label: "Publication date", type: "date", required: true },
    { key: "kicker", label: "Article category", required: true },
    { key: "excerpt", label: "Excerpt", multiline: true, required: true },
  ],
  history: [
    { key: "year", label: "Year / period", required: true },
    { key: "label", label: "Timeline label", required: true },
    { key: "snippet", label: "Short introduction", multiline: true, required: true },
  ],
  officer: [
    { key: "name", label: "Officer name", required: true },
    {
      key: "termId",
      label: "Officer term",
      required: true,
      hint: "Enter the year and term letter, for example 2026-A or 2026-B.",
    },
    {
      key: "eventSlug",
      label: "Related event address",
      required: true,
      hint: "Copy the final part of the event address after /events/, for example officer-installation.",
    },
    { key: "summary", label: "Summary", multiline: true, required: true },
    { key: "lesson", label: "Lesson / reflection", multiline: true, required: true },
  ],
  settings: [],
  policy: [],
};

export function ContentManager({ api, kind, owner }: { api: Api; kind: Kind; owner: boolean }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [record, setRecord] = useState<Content | null | undefined>();
  const list = useRemote<{ items: Content[]; total: number }>(
    api,
    `/api/admin/content?kind=${kind}&q=${encodeURIComponent(search)}&page=${page}`,
  );
  if (record !== undefined)
    return (
      <ContentEditor
        key={record?.id || "new"}
        api={api}
        kind={kind}
        initial={record}
        owner={owner}
        close={() => {
          setRecord(undefined);
          list.reload();
        }}
      />
    );
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>{labels[kind]}</h2>
          <p>Save a draft, preview it, then submit it for owner approval.</p>
        </div>
        <Button onClick={() => setRecord(null)}>
          Create{" "}
          {kind === "officer" ? "officer profile" : kind === "settings" ? "settings page" : kind}
        </Button>
      </div>
      <form
        className="admin-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          setPage(1);
        }}
      >
        <Field label={`Search ${labels[kind].toLowerCase()}`}>
          {(id) => (
            <Input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
        </Field>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <RemoteState {...list} retry={list.reload} />
      {list.data && (
        <>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.title}
                      <small>/{item.slug}</small>
                    </th>
                    <td>
                      <span className="admin-status">{item.status}</span>
                    </td>
                    <td>{new Date(item.updated_at).toLocaleDateString()}</td>
                    <td>
                      <Button variant="outline" onClick={() => setRecord(item)}>
                        Open<span className="sr-only"> {item.title}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data.items.length === 0 && (
            <p className="admin-empty">
              No records found. Create the first draft or change your search.
            </p>
          )}
          <div className="admin-pagination">
            <p>
              {list.data.total} records · Page {page}
            </p>
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page * 20 >= list.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function ContentEditor({
  api,
  kind,
  initial,
  owner,
  close,
}: {
  api: Api;
  kind: Kind;
  initial: Content | null;
  owner: boolean;
  close: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [payload, setPayload] = useState<Record<string, unknown>>(
    initial?.payload ||
      (kind === "event"
        ? { state: "planned", sections: [] }
        : kind === "officer"
          ? {}
          : { body: [] }),
  );
  const [bodyText, setBodyText] = useState(paragraphText(initial?.payload["body"]));
  const [sectionTexts, setSectionTexts] = useState<string[]>(
    Array.isArray(initial?.payload["sections"])
      ? (initial.payload["sections"] as Section[]).map((section) =>
          paragraphText(section.paragraphs),
        )
      : [],
  );
  const [mediaIds, setMediaIds] = useState(initial?.media_ids || []);
  const [changed, setChanged] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [warning, setWarning] = useState("");
  const [reason, setReason] = useState("");
  const form = useForm<Identity>({
    resolver: zodResolver(identitySchema),
    defaultValues: { title: initial?.title || "", slug: initial?.slug || "" },
  });
  const dirty = changed || form.formState.isDirty;
  useUnsaved(dirty);
  function update(key: string, value: unknown) {
    setPayload((previous) => ({ ...previous, [key]: value }));
    setChanged(true);
    setPreviewed(false);
    setSuccess("");
  }
  const sections = (Array.isArray(payload["sections"]) ? payload["sections"] : []) as Section[];
  async function save(identity: Identity) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const validation = payloadSchemas[kind].safeParse(payload);
      if (!validation.success) {
        setError(
          validation.error.issues
            .map((issue) => `${issue.path.join(" › ")}: ${issue.message}`)
            .join(" "),
        );
        return;
      }
      if (new Set(sections.map((section) => section.id)).size !== sections.length) {
        setError("Each event section needs a unique anchor.");
        return;
      }
      const result = await api<Content>("/api/admin/content", {
        ...(saved ? { id: saved.id, expectedVersion: saved.version } : {}),
        kind,
        ...identity,
        payload: validation.data,
        mediaIds,
      });
      setSaved(result);
      setPayload(result.payload);
      setBodyText(paragraphText(result.payload["body"]));
      setSectionTexts(
        Array.isArray(result.payload["sections"])
          ? (result.payload["sections"] as Section[]).map((section) =>
              paragraphText(section.paragraphs),
            )
          : [],
      );
      setMediaIds(result.media_ids);
      form.reset({ title: result.title, slug: result.slug });
      setChanged(false);
      setPreview(false);
      setPreviewed(false);
      setSuccess("Draft saved. Preview it before submitting for approval.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function transition(action: string) {
    if (!saved || dirty || (action === "submit" && !previewed)) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<Content & { warning?: string }>("/api/admin/content/action", {
        id: saved.id,
        expectedVersion: saved.version,
        action,
        reason,
      });
      setSaved(result);
      setWarning(result.warning || "");
      setReason("");
      setSuccess(
        action === "publish"
          ? "Approved for publication. Public pages update after a successful rebuild."
          : action === "archive"
            ? "Archived. Public pages update after a successful rebuild."
            : "Submitted for owner approval.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const cancel = () => {
    if (!dirty || window.confirm("Discard your unsaved changes?")) close();
  };
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>
            {saved
              ? `Edit ${kind === "officer" ? "officer profile" : kind}`
              : `New ${kind === "officer" ? "officer profile" : kind}`}
          </h2>
          <p>
            {saved ? `Status: ${saved.status} · Revision ${saved.version}` : "New draft"}
            {dirty ? " · Unsaved changes" : ""}
          </p>
        </div>
        <Button variant="outline" onClick={cancel}>
          Back to {labels[kind].toLowerCase()}
        </Button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice>{success}</Notice>}
      {warning && <Notice error>{warning}</Notice>}
      <form className="admin-editor" onSubmit={form.handleSubmit(save)}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Content details</legend>
          <div className="admin-form-grid">
            <Field label="Title" required>
              {(id) => (
                <>
                  <Input
                    id={id}
                    required
                    maxLength={200}
                    aria-invalid={!!form.formState.errors.title}
                    {...form.register("title", { onChange: () => setPreviewed(false) })}
                  />
                  {form.formState.errors.title && (
                    <p role="alert" className="admin-field-error">
                      {form.formState.errors.title.message}
                    </p>
                  )}
                </>
              )}
            </Field>
            <Field
              label="URL slug"
              required
              hint={
                kind === "settings" || kind === "policy"
                  ? "Choose the page this content belongs to."
                  : "Lowercase words separated by hyphens, for example chapter-service-day."
              }
            >
              {(id) => (
                <>
                  {kind === "settings" || kind === "policy" ? (
                    <select id={id} required {...form.register("slug")}>
                      <option value="">Select page</option>
                      {(kind === "settings"
                        ? ["chapter", "contact", "home", "history-intro"]
                        : ["privacy", "cookies", "terms"]
                      ).map((slug) => (
                        <option key={slug} value={slug}>
                          {slug}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={id}
                      required
                      maxLength={100}
                      {...form.register("slug", { onChange: () => setPreviewed(false) })}
                    />
                  )}
                  {form.formState.errors.slug && (
                    <p role="alert" className="admin-field-error">
                      {form.formState.errors.slug.message}
                    </p>
                  )}
                </>
              )}
            </Field>
            {fields[kind].map((field) =>
              field.multiline ? (
                <ParagraphField
                  key={field.key}
                  label={field.label}
                  value={textValue(payload[field.key])}
                  required={!!field.required}
                  onChange={(value) => update(field.key, value)}
                />
              ) : (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={textValue(payload[field.key])}
                  required={!!field.required}
                  type={
                    field.type === "time" &&
                    textValue(payload[field.key]) &&
                    !/^\d{2}:\d{2}$/.test(textValue(payload[field.key]))
                      ? "text"
                      : field.type || "text"
                  }
                  {...(field.hint ? { hint: field.hint } : {})}
                  onChange={(value) => update(field.key, value)}
                />
              ),
            )}
            {kind === "event" && (
              <Field label="Event state" required>
                {(id) => (
                  <select
                    id={id}
                    value={textValue(payload["state"]) || "planned"}
                    onChange={(e) => update("state", e.target.value)}
                  >
                    <option value="planned">Planned</option>
                    <option value="completed">Completed</option>
                  </select>
                )}
              </Field>
            )}
          </div>
          {["article", "history", "settings", "policy"].includes(kind) && (
            <ParagraphField
              label="Body paragraphs"
              required
              value={bodyText}
              onChange={(value) => {
                setBodyText(value);
                update("body", paragraphs(value));
              }}
            />
          )}
          {kind === "event" && (
            <fieldset className="admin-subsection">
              <legend>Event story sections</legend>
              {sections.map((section, index) => (
                <div className="admin-repeatable" key={index}>
                  <TextField
                    label={`Section ${index + 1} heading`}
                    required
                    value={section.title}
                    onChange={(value) =>
                      update(
                        "sections",
                        sections.map((item, i) => (i === index ? { ...item, title: value } : item)),
                      )
                    }
                  />
                  <TextField
                    label={`Section ${index + 1} anchor`}
                    required
                    value={section.id}
                    hint="Lowercase words separated by hyphens. Must be unique within this event."
                    onChange={(value) =>
                      update(
                        "sections",
                        sections.map((item, i) => (i === index ? { ...item, id: value } : item)),
                      )
                    }
                  />
                  <ParagraphField
                    label={`Section ${index + 1} paragraphs`}
                    required
                    value={sectionTexts[index] || ""}
                    onChange={(value) => {
                      setSectionTexts((old) => old.map((text, i) => (i === index ? value : text)));
                      update(
                        "sections",
                        sections.map((item, i) =>
                          i === index ? { ...item, paragraphs: paragraphs(value) } : item,
                        ),
                      );
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSectionTexts((old) => old.filter((_, i) => i !== index));
                      update(
                        "sections",
                        sections.filter((_, i) => i !== index),
                      );
                    }}
                  >
                    Remove section {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSectionTexts((old) => [...old, ""]);
                  update("sections", [
                    ...sections,
                    { id: `section-${sections.length + 1}`, title: "", paragraphs: [] },
                  ]);
                }}
              >
                Add story section
              </Button>
            </fieldset>
          )}
          <MediaChooser
            api={api}
            selected={mediaIds}
            onChange={(ids) => {
              setMediaIds(ids);
              setChanged(true);
              setPreviewed(false);
            }}
          />
          <div className="admin-actions">
            <Button type="submit" disabled={busy || (!dirty && !!saved)}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </form>
      {saved && (
        <div className="admin-publication">
          <h3>Review and publication</h3>
          <p>
            Save changes before previewing. Submission sends the saved draft for approval. Only an
            owner can publish or archive it.
          </p>
          <div className="admin-actions">
            <Button
              type="button"
              variant="outline"
              disabled={dirty || busy}
              onClick={() => {
                setPreview(!preview);
                setPreviewed(true);
              }}
            >
              {preview ? "Close preview" : "Preview saved draft"}
            </Button>
            <Button
              disabled={
                dirty ||
                busy ||
                !previewed ||
                saved.status === "submitted" ||
                saved.status === "published" ||
                saved.status === "archived"
              }
              onClick={() => transition("submit")}
            >
              Submit for approval
            </Button>
          </div>
          {preview && <ContentPreview api={api} record={saved} />}
          {owner && (
            <>
              <TextField
                label="Publication / archive reason"
                value={reason}
                required
                onChange={setReason}
                hint="Required for the audit record. Verify your authenticator again if requested."
              />
              <div className="admin-actions">
                <Button
                  disabled={dirty || busy || !reason.trim() || saved.status !== "submitted"}
                  onClick={() => transition("publish")}
                >
                  Approve and publish
                </Button>
                <Button
                  variant="destructive"
                  disabled={dirty || busy || !reason.trim() || saved.status === "archived"}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Archive this record? A published page changes after the next successful rebuild.",
                      )
                    )
                      void transition("archive");
                  }}
                >
                  Archive
                </Button>
                {saved.status === "archived" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      setSuccess("");
                      try {
                        const result = await api<{ warning?: string }>("/api/admin/media/retire", {
                          contentId: saved.id,
                        });
                        setWarning(result.warning || "");
                        if (!result.warning)
                          setSuccess(
                            "Public image cleanup completed. Images used by other published records remain available.",
                          );
                      } catch (cause) {
                        setError(errorMessage(cause));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Retry public image cleanup
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ContentPreview({ api, record }: { api: Api; record: Content }) {
  const media = useRemote<Media[] | { items: Media[] }>(api, "/api/admin/media");
  const images = media.data
    ? record.media_ids.map((id) => itemsOf(media.data!).find((image) => image.id === id))
    : [];
  const first = images[0];
  const image = first ? `/api/admin/media/preview?id=${encodeURIComponent(first.id)}` : undefined;
  const article =
    record.kind === "article" ? payloadSchemas.article.safeParse(record.payload) : null;
  const event = record.kind === "event" ? payloadSchemas.event.safeParse(record.payload) : null;
  return (
    <div className="admin-preview">
      <p className="admin-help">
        Saved revision {record.version}. This uses the public story renderer; navigation and linked
        financial reports appear on the public page after publication.
      </p>
      <RemoteState {...media} retry={media.reload} />
      {media.data && images.some((item) => !item) && (
        <Notice error>
          Some selected images could not be loaded. Check the media library before publication.
        </Notice>
      )}
      <div className="chapter-home public-page admin-story-preview">
        {article?.success ? (
          <>
            <StoryHero
              image={image || "/images/chapter-seal.webp"}
              imageAlt={first?.alt || "Chapter seal"}
              eyebrow={`${article.data.kicker} · ${formatDate(article.data.date)}`}
              title={record.title}
              summary={article.data.excerpt}
            />
            <ArticleBody paragraphs={article.data.body} />
          </>
        ) : event?.success ? (
          <>
            <StoryHero
              image={image}
              imageAlt={first?.alt || ""}
              eyebrow={eventStatus(event.data)}
              title={record.title}
              summary={event.data.summary}
            />
            <EventMetadata
              when={`${formatDate(event.data.iso)} · ${event.data.time} PHT`}
              place={event.data.place}
              host={event.data.host}
              lead={event.data.lead}
            />
            <article className="standalone-story story-body">
              <StorySections sections={event.data.sections} />
            </article>
          </>
        ) : (
          <article className="standalone-story story-body">
            <h1>{record.title}</h1>
            {fields[record.kind].map((field) => (
              <section key={field.key}>
                <h2>{field.label}</h2>
                <p>{textValue(record.payload[field.key])}</p>
              </section>
            ))}
            {Array.isArray(record.payload["body"]) &&
              record.payload["body"]
                .filter((value): value is string => typeof value === "string")
                .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </article>
        )}
        {record.kind !== "article" && images.filter((item): item is Media => !!item).length > 0 && (
          <section className="public-section">
            <h2>Photo collection</h2>
            {images.map(
              (item) =>
                item && (
                  <figure key={item.id}>
                    <img
                      src={`/api/admin/media/preview?id=${encodeURIComponent(item.id)}`}
                      alt={item.alt}
                      width={item.width}
                      height={item.height}
                    />
                    <figcaption>{item.caption}</figcaption>
                  </figure>
                ),
            )}
          </section>
        )}
      </div>
    </div>
  );
}
