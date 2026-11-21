export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 16 * 1024;
export const MAX_PIXELS = 20_000_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ImageRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const invalid = () => {
  throw new ImageRequestError("Upload a valid, still JPEG, PNG, or WebP image.");
};
const text = (data, start, length) => String.fromCharCode(...data.subarray(start, start + length));

export function dimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS ||
    width > 20_000 ||
    height > 20_000
  ) {
    throw new ImageRequestError(
      "Images must contain at most 20 million pixels and measure at most 20,000 pixels per side.",
    );
  }
  return { width, height };
}

// Check dimensions before the decoder can allocate its pixel cache; MIME and filenames are untrusted.
export function inspectImage(data) {
  if (!(data instanceof Uint8Array) || !data.length || data.length > MAX_FILE_BYTES)
    throw new ImageRequestError("Image files must be at most 5 MiB.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 33 && text(data, 0, 8) === "\x89PNG\r\n\x1a\n") {
    if (view.getUint32(8) !== 13 || text(data, 12, 4) !== "IHDR") invalid();
    const size = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8,
      imageData = false;
    while (offset + 12 <= data.length) {
      const length = view.getUint32(offset),
        kind = text(data, offset + 4, 4);
      if (
        length > data.length - offset - 12 ||
        kind === "acTL" ||
        (kind === "IHDR" && offset !== 8)
      )
        invalid();
      if (kind === "IDAT") imageData = true;
      offset += length + 12;
      if (kind === "IEND") {
        if (length || !imageData || offset !== data.length) invalid();
        return { format: "PNG", mime: "image/png", ...size };
      }
    }
    invalid();
  }
  if (data.length >= 20 && text(data, 0, 4) === "RIFF" && text(data, 8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== data.length) invalid();
    let offset = 12,
      canvas,
      size;
    while (offset + 8 <= data.length) {
      const kind = text(data, offset, 4),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (length > data.length - start || kind === "ANIM" || kind === "ANMF") invalid();
      if (kind === "VP8X") {
        if (canvas || offset !== 12 || length !== 10 || data[start] & 2) invalid();
        const uint24 = (at) => data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
        canvas = dimensions(1 + uint24(start + 4), 1 + uint24(start + 7));
      } else if (kind === "VP8 ") {
        if (size || length < 10 || data[start] & 1 || text(data, start + 3, 3) !== "\x9d\x01\x2a")
          invalid();
        size = dimensions(
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
        );
      } else if (kind === "VP8L") {
        if (size || length < 5 || data[start] !== 0x2f || data[start + 4] >> 5) invalid();
        const bits = view.getUint32(start + 1, true);
        size = dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
      }
      offset = start + length + (length % 2);
    }
    if (
      offset !== data.length ||
      !size ||
      (canvas && (canvas.width !== size.width || canvas.height !== size.height))
    )
      invalid();
    return { format: "WEBP", mime: "image/webp", ...size };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2,
      size;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) invalid();
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda) {
        if (!size) invalid();
        return { format: "JPEG", mime: "image/jpeg", ...size };
      }
      if (
        marker === 0 ||
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        offset + 2 > data.length
      )
        invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > data.length) invalid();
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (size || ![0xc0, 0xc2].includes(marker) || length < 8) invalid();
        size = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
  }
  invalid();
}

export function uploadFields(form) {
  const keys = [...form.keys()];
  if (
    keys.length !== 4 ||
    !["file", "alt", "caption", "rightsConfirmed"].every((key) => form.getAll(key).length === 1)
  )
    throw new ImageRequestError("Invalid upload fields.");
  const file = form.get("file"),
    alt = form.get("alt"),
    caption = form.get("caption");
  if (!(file instanceof File)) throw new ImageRequestError("Choose an image file.");
  if (
    typeof alt !== "string" ||
    !alt.trim() ||
    [...alt].length > 500 ||
    typeof caption !== "string" ||
    [...caption].length > 1000 ||
    /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(alt + caption)
  )
    throw new ImageRequestError(
      "Provide plain-text alt text (1–500 characters) and a caption of at most 1,000 characters.",
    );
  if (form.get("rightsConfirmed") !== "true")
    throw new ImageRequestError("Confirm that you have permission to use this image.");
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new ImageRequestError("Image files must be at most 5 MiB.");
  return { file, alt, caption };
}

export async function boundedBody(request, maximum = MAX_BODY_BYTES) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new ImageRequestError("Request is too large.", 413);
  if (!request.body) throw new ImageRequestError("Request body is required.");
  const reader = request.body.getReader(),
    chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new ImageRequestError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
