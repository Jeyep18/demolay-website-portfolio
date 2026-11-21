type FixedLength = new (size: number) => ReadableWritablePair<Uint8Array, Uint8Array>;

export function installationVideoRange(
  request: Request,
  asset: Response,
  packagedSize = 0,
): Response {
  const size = Number(asset.headers.get("Content-Length") ?? packagedSize);
  if (
    asset.status !== 200 ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !/^video\/mp4\b/i.test(asset.headers.get("Content-Type") ?? "") ||
    !["identity", null].includes(asset.headers.get("Content-Encoding"))
  )
    return asset;

  const headers = new Headers(asset.headers);
  headers.set("Accept-Ranges", "bytes");
  const full = () => new Response(asset.body, { status: 200, headers });
  const range = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get("Range") ?? "");
  const ifRange = request.headers.get("If-Range");
  const etag = headers.get("ETag");
  if (
    request.method !== "GET" ||
    !asset.body ||
    !range ||
    (!range[1] && !range[2]) ||
    (ifRange && (ifRange !== etag || !etag.startsWith('"')))
  )
    return full();

  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start >= size || end < start) {
    void asset.body.cancel().catch(() => {});
    headers.set("Content-Range", "bytes */" + size);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }

  const length = end - start + 1;
  const reader = asset.body.getReader();
  let offset = 0;
  const slice = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.error(new Error("Installation video ended before the requested range."));
          return;
        }
        const at = offset;
        offset += value.byteLength;
        if (offset <= start) continue;
        controller.enqueue(value.subarray(Math.max(0, start - at), end + 1 - at));
        if (offset > end) {
          controller.close();
          void reader.cancel().catch(() => {});
        }
        return;
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const FixedLengthStream = (globalThis as typeof globalThis & { FixedLengthStream?: FixedLength })
    .FixedLengthStream;
  headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
  headers.set("Content-Length", String(length));
  return new Response(
    FixedLengthStream ? slice.pipeThrough(new FixedLengthStream(length)) : slice,
    {
      status: 206,
      headers,
    },
  );
}
