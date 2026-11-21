import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moveSelectedImage } from "./media-order";

export type Session = {
  configured: boolean;
  id: string;
  email: string;
  role: "owner" | "editor";
  active: boolean;
  aal: string;
  csrfToken: string;
};
export type Api = <T>(path: string, body?: unknown) => Promise<T>;
export type Kind = "event" | "article" | "history" | "officer" | "settings" | "policy";
export type Content = {
  id: string;
  kind: Kind;
  slug: string;
  title: string;
  payload: Record<string, unknown>;
  media_ids: string[];
  version: number;
  status: "draft" | "submitted" | "published" | "archived";
  updated_at: string;
};
export type Media = {
  id: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  status: string;
};
export const UnsavedContext = createContext<(dirty: boolean) => void>(() => undefined);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "The request could not be completed. Check your connection and try again.";
}

export function apiMessage(status: number) {
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403)
    return "This action needs the appropriate role and a recent authenticator verification. Use Verify authenticator, then try again.";
  if (status === 409)
    return "This record changed or conflicts with another record. Reload it before saving; keep a copy of your unsaved text.";
  if (status === 413)
    return "This image is too large. Choose an image under 5 MiB and 20 megapixels.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status === 503)
    return "Administration is not configured or is temporarily unavailable. Contact the chapter owner and try again later.";
  if (status === 400 || status === 422)
    return "Some fields could not be accepted. Check required fields, dates, amounts and references, then try again.";
  return "The server could not complete this request. Try again later.";
}

export function itemsOf<T>(data: T[] | { items: T[] }): T[] {
  return Array.isArray(data) ? data : data.items;
}
export function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
export function paragraphs(value: string) {
  return value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
export function paragraphText(value: unknown) {
  return Array.isArray(value) ? value.filter((p) => typeof p === "string").join("\n\n") : "";
}

export function useRemote<T>(api: Api, path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setData(undefined);
    api<T>(path)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, path, revision]);
  return { data, error, loading, reload: () => setRevision((value) => value + 1) };
}

export function useUnsaved(dirty: boolean) {
  const setDirty = useContext(UnsavedContext);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div
      className={error ? "admin-notice admin-notice-error" : "admin-notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function RemoteState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return loading ? (
    <p role="status">Loading chapter records…</p>
  ) : error ? (
    <Notice error>
      {error}{" "}
      <Button type="button" variant="outline" onClick={retry}>
        Try again
      </Button>
    </Notice>
  ) : null;
}
export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children(id)}
      {hint && <p className="admin-help">{hint}</p>}
    </div>
  );
}
export function TextField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  hint,
  maxLength = 500,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <Field label={label} required={required} {...(hint ? { hint } : {})}>
      {(id) => (
        <Input
          id={id}
          type={type}
          value={value}
          required={required}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
export function ParagraphField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field
      label={label}
      required={required}
      hint="Separate paragraphs with a blank line. Plain text only."
    >
      {(id) => (
        <Textarea
          id={id}
          rows={6}
          value={value}
          required={required}
          maxLength={40000}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function MediaChooser({
  api,
  selected,
  onChange,
}: {
  api: Api;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const media = useRemote<Media[] | { items: Media[] }>(api, "/api/admin/media");
  return (
    <fieldset className="admin-media-picker">
      <legend>Associated images</legend>
      <p className="admin-help">
        Upload images in Media first. Choose images below, then arrange their display order. The
        first image is the cover photograph. Images remain private until approved for publication.
      </p>
      <RemoteState {...media} retry={media.reload} />
      {media.data && itemsOf(media.data).length === 0 && <p>No images uploaded yet.</p>}
      {selected.length > 0 && (
        <div>
          <h4>Selected image order</h4>
          <ol aria-label="Selected image order">
            {selected.map((id, index) => {
              const image = media.data && itemsOf(media.data).find((item) => item.id === id);
              const name = image ? image.caption || image.alt : "Image details unavailable";
              return (
                <li key={id}>
                  <p>
                    {index + 1}. {name}
                    {index === 0 ? " · Cover photograph" : ""}
                  </p>
                  <div className="admin-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={index === 0}
                      aria-label={`Move image ${index + 1} earlier: ${name}`}
                      onClick={() => onChange(moveSelectedImage(selected, index, -1))}
                    >
                      Move earlier
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={index === selected.length - 1}
                      aria-label={`Move image ${index + 1} later: ${name}`}
                      onClick={() => onChange(moveSelectedImage(selected, index, 1))}
                    >
                      Move later
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Remove image ${index + 1}: ${name}`}
                      onClick={() => onChange(selected.filter((item) => item !== id))}
                    >
                      Remove selection
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <div className="admin-image-grid">
        {media.data &&
          itemsOf(media.data).map((image) => (
            <label className="admin-image-option" key={image.id}>
              <input
                type="checkbox"
                checked={selected.includes(image.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, image.id]
                      : selected.filter((id) => id !== image.id),
                  )
                }
              />
              <img
                src={`/api/admin/media/preview?id=${encodeURIComponent(image.id)}`}
                alt={image.alt}
                loading="lazy"
              />
              <span>{image.caption || image.alt}</span>
              <small>{image.status}</small>
            </label>
          ))}
      </div>
    </fieldset>
  );
}
