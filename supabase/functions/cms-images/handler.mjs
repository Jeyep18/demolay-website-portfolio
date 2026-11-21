import {
  boundedBody,
  ImageRequestError,
  MAX_FILE_BYTES,
  uploadFields,
  UUID,
} from "./validation.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (error.code === "PT409" || error.code === "40001")
      throw new ImageRequestError("Content changed. Reload before approving.", 409);
    if (error.code === "P0001" || error.code === "PT429")
      throw new ImageRequestError("Request limit reached. Try again shortly.", 429);
    throw new ImageRequestError("This operation is not permitted or could not be completed.", 403);
  }
  return data;
}

async function bytes(blob) {
  if (!blob || !blob.size || blob.size > MAX_FILE_BYTES)
    throw new ImageRequestError("Stored image is unavailable.", 502);
  return new Uint8Array(await blob.arrayBuffer());
}

async function digest(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function verifyStored(bucket, path, data) {
  const existing = await bucket.download(path);
  if (existing.error) throw new ImageRequestError("Image storage is temporarily unavailable.", 502);
  const current = await bytes(existing.data);
  const [left, right] = await Promise.all([digest(current), digest(data)]);
  if (current.length !== data.length || !left.every((byte, i) => byte === right[i]))
    throw new ImageRequestError("Stored image does not match the approved image.", 409);
}

// An immutable key can already exist after a lost response; accept it only when the bytes match.
export async function putImmutable(bucket, path, data, contentType) {
  const { error } = await bucket.upload(path, data, {
    contentType,
    upsert: false,
    cacheControl: "60",
  });
  if (!error) return;
  await verifyStored(bucket, path, data);
}

export function createImageHandler({ clients, transform }) {
  return async function handle(request) {
    try {
      if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
      // Browser requests use the same-origin Worker, which owns CSRF and session expiry checks.
      if (request.headers.has("origin"))
        throw new ImageRequestError("Use the website upload endpoint.", 403);
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Bearer [^\s]+$/.test(authorization))
        throw new ImageRequestError("Sign in to continue.", 401);
      const { user, service } = clients(authorization);
      const identity = await user.auth.getUser(authorization.slice(7));
      const userId = identity.data?.user?.id;
      if (identity.error || !userId || !UUID.test(userId))
        throw new ImageRequestError("Sign in to continue.", 401);
      const session = await rpc(user, "cms_session");
      if (
        session?.id !== userId ||
        session.active !== true ||
        session.aal !== "aal2" ||
        !["editor", "owner"].includes(session.role)
      )
        throw new ImageRequestError(
          "Active staff access and two-factor authentication are required.",
          403,
        );
      const type = request.headers.get("content-type") || "";
      if (type.startsWith("multipart/form-data;")) {
        await rpc(user, "cms_rate_limit", { p_action: "upload" });
        const body = await boundedBody(request);
        let form;
        try {
          form = await new Request(request.url, {
            method: "POST",
            headers: { "content-type": type },
            body,
          }).formData();
        } catch {
          throw new ImageRequestError("Invalid upload form.");
        }
        const { file, alt, caption } = uploadFields(form);
        const original = new Uint8Array(await file.arrayBuffer());
        const result = await transform(original);
        const id = crypto.randomUUID(),
          originalPath = `${userId}/${id}.original`,
          derivativePath = `${id}.webp`;
        const originals = service.storage.from("cms-originals"),
          derivatives = service.storage.from("cms-derivatives");
        let originalSaved = false,
          derivativeSaved = false;
        try {
          await putImmutable(originals, originalPath, original, result.mime);
          originalSaved = true;
          await putImmutable(derivatives, derivativePath, result.data, "image/webp");
          derivativeSaved = true;
          await rpc(service, "cms_media_upload_ready", {
            p_id: id,
            p_user_id: userId,
            p_original_path: originalPath,
            p_derivative_path: derivativePath,
            p_width: result.width,
            p_height: result.height,
          });
          const media = await rpc(user, "cms_media_register", {
            p_id: id,
            p_original_path: originalPath,
            p_derivative_path: derivativePath,
            p_width: result.width,
            p_height: result.height,
            p_alt: alt,
            p_caption: caption,
            p_rights_confirmed: true,
          });
          return response(media, 201);
        } catch (error) {
          // Registration can commit despite a lost HTTP response. Retain immutable private objects for recovery.
          if (!originalSaved || !derivativeSaved) {
            if (originalSaved) await originals.remove([originalPath]);
            if (derivativeSaved) await derivatives.remove([derivativePath]);
          }
          throw error;
        }
      }
      if (type.split(";")[0] === "application/json") {
        let body;
        try {
          body = JSON.parse(new TextDecoder().decode(await boundedBody(request, 2048)));
        } catch (error) {
          if (error instanceof ImageRequestError) throw error;
          throw new ImageRequestError("Invalid media request.");
        }
        if (
          !body ||
          Array.isArray(body) ||
          !["promote", "retire"].includes(body.action) ||
          typeof body.contentId !== "string" ||
          !UUID.test(body.contentId)
        )
          throw new ImageRequestError("Invalid media request.");
        if (body.action === "retire") {
          if (Object.keys(body).sort().join(",") !== "action,contentId")
            throw new ImageRequestError("Invalid media request.");
          if (session.role !== "owner")
            throw new ImageRequestError("Owner access is required.", 403);
          const retiring = await rpc(user, "cms_media_retire", { p_content_id: body.contentId });
          if (!Array.isArray(retiring?.items))
            throw new ImageRequestError("Media removal could not be completed.", 502);
          for (const media of retiring.items) {
            if (
              typeof media.id !== "string" ||
              !UUID.test(media.id) ||
              media.public_path !== `${media.id}.webp`
            )
              throw new ImageRequestError("Media removal could not be completed.", 502);
            const lease = await rpc(service, "cms_media_begin_retire", { p_id: media.id });
            if (
              lease?.id !== media.id ||
              lease.status !== "revoking" ||
              lease.public_path !== media.public_path ||
              typeof lease.operation_id !== "string" ||
              !UUID.test(lease.operation_id)
            )
              throw new ImageRequestError("Media removal could not be completed.", 502);
            const removed = await service.storage.from("cms-public").remove([media.public_path]);
            if (removed.error)
              throw new ImageRequestError(
                "Media removal could not be confirmed. Ask the owner to review storage recovery.",
                502,
              );
            // Uncertain deletion/finalization keeps the lease; a later request must never repeat this delete.
            await rpc(service, "cms_media_retired", {
              p_id: media.id,
              p_operation_id: lease.operation_id,
            });
          }
          return response({ success: true });
        }
        if (
          Object.keys(body).sort().join(",") !== "action,contentId,expectedVersion" ||
          !Number.isSafeInteger(body.expectedVersion) ||
          body.expectedVersion < 1
        )
          throw new ImageRequestError("Invalid approval request.");
        const content = await rpc(user, "cms_content_get", { p_id: body.contentId });
        const approved = await rpc(user, "cms_media_approve", {
          p_ids: content.media_ids,
          p_content_id: body.contentId,
          p_expected_version: body.expectedVersion,
        });
        if (!Array.isArray(approved?.items))
          throw new ImageRequestError("Approval could not be completed.", 502);
        for (const media of approved.items) {
          if (
            !UUID.test(media.id) ||
            media.derivative_path !== `${media.id}.webp` ||
            !["approved", "ready"].includes(media.status)
          )
            throw new ImageRequestError("Approved image is unavailable.", 502);
          const lease = await rpc(service, "cms_media_begin_promote", { p_id: media.id });
          if (
            lease?.id !== media.id ||
            lease.derivative_path !== media.derivative_path ||
            !(
              (lease.status === "promoting" &&
                typeof lease.operation_id === "string" &&
                UUID.test(lease.operation_id)) ||
              (lease.status === "ready" &&
                lease.operation_id === null &&
                lease.public_path === `${media.id}.webp`)
            )
          )
            throw new ImageRequestError("Approved image is unavailable.", 502);
          const bucket = service.storage.from("cms-public"),
            path = `${media.id}.webp`;
          let writeStarted = false;
          try {
            const downloaded = await service.storage
              .from("cms-derivatives")
              .download(media.derivative_path);
            if (downloaded.error)
              throw new ImageRequestError("Approved image is unavailable.", 502);
            const data = await bytes(downloaded.data);
            if (lease.status === "ready") {
              // A concurrent retirement may already have removed this object. Never recreate it.
              await verifyStored(bucket, path, data);
              continue;
            }
            writeStarted = true;
            await putImmutable(bucket, path, data, "image/webp");
            await rpc(service, "cms_media_promote", {
              p_id: media.id,
              p_public_path: path,
              p_operation_id: lease.operation_id,
            });
          } catch (error) {
            // A lost copy/finalization response may still commit; only a pre-write failure is safe to cancel.
            if (lease.status === "promoting" && !writeStarted) {
              try {
                const removed = await bucket.remove([path]);
                if (!removed.error)
                  await rpc(service, "cms_media_cancel_promote", {
                    p_id: media.id,
                    p_operation_id: lease.operation_id,
                  });
              } catch {
                /* Preserve the lease when cleanup cannot be confirmed. */
              }
            }
            throw error;
          }
        }
        return response({ success: true });
      }
      throw new ImageRequestError("Unsupported request type.", 415);
    } catch (error) {
      if (error instanceof ImageRequestError)
        return response({ error: error.message }, error.status);
      return response({ error: "Image processing is temporarily unavailable." }, 503);
    }
  };
}
