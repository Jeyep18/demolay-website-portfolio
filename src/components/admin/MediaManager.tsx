import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Api,
  type Media,
  ApiError,
  Field,
  Notice,
  RemoteState,
  TextField,
  errorMessage,
  useRemote,
  useUnsaved,
} from "./shared";

export function MediaManager({ api }: { api: Api }) {
  const list = useRemote<{ items: Media[] }>(api, "/api/admin/media");
  const [file, setFile] = useState<File>();
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [rights, setRights] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useUnsaved(!!file || !!alt || !!caption || rights);
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Choose a JPEG, PNG or WebP image no larger than 5 MiB.");
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 20_000_000) throw new Error("Choose an image no larger than 20 megapixels.");
      const body = new FormData();
      body.set("file", file);
      body.set("alt", alt.trim());
      body.set("caption", caption.trim());
      body.set("rightsConfirmed", String(rights));
      await api<Media>("/api/admin/media/upload", body);
      setFile(undefined);
      setAlt("");
      setCaption("");
      setRights(false);
      if (input.current) input.current.value = "";
      list.reload();
      setNotice("Image uploaded privately. Associate it with a draft for owner approval.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? errorMessage(cause)
          : cause instanceof Error && cause.message.startsWith("Choose")
            ? cause.message
            : "The image could not be uploaded. Check the file and your connection, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function clear() {
    if (
      (!file && !alt && !caption && !rights) ||
      window.confirm("Discard these image upload details?")
    ) {
      setFile(undefined);
      setAlt("");
      setCaption("");
      setRights(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <h2>Media</h2>
          <p>
            Upload images you have permission to publish. Originals and pending images remain
            private.
          </p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={upload} className="admin-upload">
        <fieldset disabled={busy}>
          <legend>Upload an image</legend>
          <Field
            label="Image file"
            required
            hint="JPEG, PNG or WebP · Up to 5 MiB and 20 megapixels."
          >
            {(id) => (
              <Input
                id={id}
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            )}
          </Field>
          <div className="admin-form-grid">
            <TextField
              label="Alternative text"
              value={alt}
              required
              maxLength={500}
              onChange={setAlt}
              hint="Describe the image for someone who cannot see it."
            />
            <TextField label="Caption" value={caption} maxLength={1000} onChange={setCaption} />
          </div>
          <label className="admin-check">
            <input
              type="checkbox"
              required
              checked={rights}
              onChange={(event) => setRights(event.target.checked)}
            />
            I confirm the chapter has permission to publish this image, including any required
            consent.
          </label>
          <div className="admin-actions">
            <Button disabled={busy || !file || !rights || !alt.trim()} type="submit">
              {busy ? "Uploading…" : "Upload privately"}
            </Button>
            <Button type="button" variant="outline" onClick={clear}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </form>
      <h3>Image library</h3>
      <RemoteState {...list} retry={list.reload} />
      {list.data && (
        <>
          <p>{list.data.items.length} images</p>
          <div className="admin-image-grid">
            {list.data.items.map((image) => (
              <figure key={image.id}>
                <img
                  src={`/api/admin/media/preview?id=${encodeURIComponent(image.id)}`}
                  alt={image.alt}
                  loading="lazy"
                />
                <figcaption>
                  {image.caption || image.alt}
                  <small>
                    {image.width} × {image.height} · {image.status}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
          {!list.data.items.length && <p className="admin-empty">No images uploaded yet.</p>}
        </>
      )}
    </section>
  );
}
