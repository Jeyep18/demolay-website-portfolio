import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import {
  boundedBody,
  dimensions,
  inspectImage,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  uploadFields,
} from "../supabase/functions/cms-images/validation.mjs";
import { createImageHandler, putImmutable } from "../supabase/functions/cms-images/handler.mjs";
import { initializeImages, transformImage } from "../supabase/functions/cms-images/transform.mjs";

const userId = "11111111-1111-4111-8111-111111111111",
  mediaId = "22222222-2222-4222-8222-222222222222",
  contentId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const promoteRequest = () =>
  request(JSON.stringify({ action: "promote", contentId, expectedVersion: 3 }), {
    "content-type": "application/json",
  });
function chunk(kind, body) {
  const data = Buffer.concat([Buffer.from(kind), body]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    trailer = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, data, trailer]);
}
function png(width = 2, height = 1, extra = [], pixels = Buffer.alloc(7)) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", header),
    ...extra,
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function form(data = png()) {
  const f = new FormData();
  f.set("file", new File([data], "untrusted.svg", { type: "text/html" }));
  f.set("alt", "Chapter photograph");
  f.set("caption", "");
  f.set("rightsConfirmed", "true");
  return f;
}
function request(body = form(), extra = {}) {
  return new Request("https://fixture.invalid/functions/v1/cms-images", {
    method: "POST",
    headers: { authorization: "Bearer fixture-user-token", ...extra },
    body,
  });
}
function fixture(options = {}) {
  const calls = [],
    objects = new Map();
  let retiringClaimed = false;
  const storage = {
    from(bucket) {
      return {
        async upload(path, bytes, settings) {
          calls.push(["upload", bucket, path, settings]);
          if (bucket === "cms-public" && options.uploadError) {
            if (options.uploadCommitted) objects.set(`${bucket}/${path}`, new Uint8Array(bytes));
            return { error: {} };
          }
          objects.set(`${bucket}/${path}`, new Uint8Array(bytes));
          return { error: null };
        },
        async download(path) {
          calls.push(["download", bucket, path]);
          if (bucket === "cms-derivatives" && options.derivativeError)
            return { data: null, error: {} };
          if (bucket === "cms-public" && options.missingPublic && !objects.has(`${bucket}/${path}`))
            return { data: null, error: {} };
          return { data: new Blob([objects.get(`${bucket}/${path}`) || png()]), error: null };
        },
        async remove(paths) {
          calls.push(["remove", bucket, paths]);
          if (options.beforeRemove) await options.beforeRemove();
          if (options.removeError) return { error: { message: "raw provider secret" } };
          for (const path of paths) objects.delete(`${bucket}/${path}`);
          return { error: null };
        },
      };
    },
  };
  const user = {
    auth: {
      async getUser(token) {
        calls.push(["getUser", token]);
        return { data: { user: { id: userId } }, error: options.identityError };
      },
    },
    async rpc(name, args) {
      calls.push(["user", name, args]);
      if (options.deny === name)
        return { error: { code: options.code || "42501", message: "raw provider secret" } };
      if (name === "cms_session")
        return {
          data: { id: userId, active: true, role: "editor", aal: "aal2", ...options.session },
        };
      if (name === "cms_content_get")
        return { data: { id: contentId, media_ids: [mediaId], version: 3 } };
      if (name === "cms_media_approve")
        return {
          data: {
            items: [{ id: mediaId, derivative_path: `${mediaId}.webp`, status: "approved" }],
          },
        };
      if (name === "cms_media_register")
        return { data: { id: args.p_id, status: "pending", alt: args.p_alt } };
      if (name === "cms_media_retire")
        return {
          data: { items: options.retiring || [{ id: mediaId, public_path: `${mediaId}.webp` }] },
        };
      return { data: null };
    },
  };
  const service = {
    storage,
    async rpc(name, args) {
      calls.push(["service", name, args]);
      if (options.serviceDeny === name) return { error: { code: "PT409" } };
      if (name === "cms_media_begin_retire") {
        if (retiringClaimed) return { error: { code: "PT409" } };
        retiringClaimed = true;
        return {
          data: {
            id: mediaId,
            status: "revoking",
            operation_id: operationId,
            public_path: `${mediaId}.webp`,
            ...options.retireLease,
          },
        };
      }
      if (name === "cms_media_retired") retiringClaimed = false;
      if (name === "cms_media_begin_promote")
        return {
          data: {
            id: mediaId,
            status: options.ready ? "ready" : "promoting",
            operation_id: options.ready ? null : operationId,
            derivative_path: `${mediaId}.webp`,
            public_path: options.ready ? `${mediaId}.webp` : null,
          },
        };
      return { data: {} };
    },
  };
  const handle = createImageHandler({
    clients: () => ({ user, service }),
    transform: (data) => {
      calls.push(["transform"]);
      inspectImage(data);
      return { data: png(), mime: "image/png", width: 2, height: 1 };
    },
  });
  return { calls, objects, handle };
}

test("signature validation ignores forged MIME/extensions, rejects HTML, SVG, executable bytes and URL strings", () => {
  assert.equal(inspectImage(png()).format, "PNG");
  assert.equal(uploadFields(form()).alt, "Chapter photograph");
  for (const value of [
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    "<!doctype html>",
    "MZexecutable",
    "https://example.invalid/photo.jpg",
  ])
    assert.throws(() => inspectImage(Buffer.from(value)), /valid, still/);
  const url = form();
  url.set("file", "https://example.invalid/photo.jpg");
  assert.throws(() => uploadFields(url), /Choose an image/);
});
test("dimension bombs, animation, malformed chunks and oversize files are rejected before decode", () => {
  assert.deepEqual(dimensions(5000, 4000), { width: 5000, height: 4000 });
  for (const size of [
    [0, 1],
    [5001, 4000],
    [20001, 1],
  ])
    assert.throws(() => dimensions(...size));
  assert.throws(() => inspectImage(png(100000, 100000)), /20 million/);
  assert.throws(() => inspectImage(png(2, 1, [chunk("acTL", Buffer.alloc(8))])));
  assert.throws(() => inspectImage(Buffer.concat([png(), Buffer.from("trailing data")])));
  assert.throws(() => inspectImage(png().subarray(0, 40)));
  assert.throws(() => inspectImage(new Uint8Array(MAX_FILE_BYTES + 1)), /5 MiB/);
});
test("rights confirmation, alt/caption length, plain text, duplicate and unexpected fields fail closed", () => {
  for (const [key, value] of [
    ["rightsConfirmed", "false"],
    ["rightsConfirmed", "on"],
    ["alt", " "],
    ["alt", "a".repeat(501)],
    ["caption", "a".repeat(1001)],
    ["alt", "<script>"],
  ]) {
    const f = form();
    f.set(key, value);
    assert.throws(() => uploadFields(f));
  }
  const duplicate = form();
  duplicate.append("alt", "duplicate");
  assert.throws(() => uploadFields(duplicate));
  const id = form();
  id.set("userId", userId);
  assert.throws(() => uploadFields(id));
});
test("stream byte cap cannot be bypassed by missing or lying Content-Length", async () => {
  for (const length of [undefined, "1", String(MAX_BODY_BYTES + 1)]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = length ? { "content-length": length } : {};
    await assert.rejects(
      boundedBody(
        new Request("https://fixture.invalid", { method: "POST", headers, body, duplex: "half" }),
      ),
      /too large/,
    );
    if (!length || length === "1") assert.equal(cancelled, true);
  }
});
test("upload verifies user, live staff/MFA and quota before decoding, uses service only for immutable storage/receipt", async () => {
  const f = fixture();
  const res = await f.handle(request());
  assert.equal(res.status, 201);
  assert.deepEqual(
    f.calls.slice(0, 4).map((x) => x[1] || x[0]),
    ["fixture-user-token", "cms_session", "cms_rate_limit", "transform"],
  );
  const receipt = f.calls.find((x) => x[1] === "cms_media_upload_ready"),
    register = f.calls.find((x) => x[1] === "cms_media_register");
  assert.equal(receipt[0], "service");
  assert.equal(register[0], "user");
  assert.equal(receipt[2].p_user_id, userId);
  assert.equal(receipt[2].p_original_path, `${userId}/${receipt[2].p_id}.original`);
  assert.equal(receipt[2].p_derivative_path, `${receipt[2].p_id}.webp`);
  assert.equal(
    f.calls
      .filter((x) => x[0] === "upload")
      .every((x) => x[3].upsert === false && x[1] !== "cms-public"),
    true,
  );
});
test("suspended, AAL1, forged identity, browser Origin and service-role-like requests cannot upload", async () => {
  for (const options of [
    { session: { active: false } },
    { session: { aal: "aal1" } },
    { session: { role: "service_role" } },
    { session: { id: mediaId } },
    { identityError: {} },
    { deny: "cms_rate_limit", code: "P0001" },
  ]) {
    const f = fixture(options);
    const res = await f.handle(request());
    assert.ok(res.status >= 400);
    assert.equal(
      f.calls.some((x) => x[0] === "transform" || x[0] === "upload"),
      false,
    );
    assert.doesNotMatch(await res.text(), /raw provider/);
  }
  const f = fixture();
  assert.equal(
    (await f.handle(request(form(), { origin: "https://attacker.invalid" }))).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await f.handle(new Request("https://fixture.invalid", { method: "POST" }))).status,
    401,
  );
});
test("owner version-bound approval must succeed before any public object is read or created", async () => {
  const promote = () =>
    request(JSON.stringify({ action: "promote", contentId, expectedVersion: 3 }), {
      "content-type": "application/json",
    });
  const denied = fixture({ deny: "cms_media_approve" });
  assert.equal((await denied.handle(promote())).status, 403);
  assert.equal(
    denied.calls.some((x) => ["download", "upload", "service"].includes(x[0])),
    false,
  );
  for (const code of ["PT409", "40001"]) {
    const conflict = fixture({ deny: "cms_media_approve", code });
    assert.equal((await conflict.handle(promote())).status, 409);
    assert.equal(
      conflict.calls.some((x) => ["download", "upload", "service"].includes(x[0])),
      false,
    );
  }
  const accepted = fixture();
  assert.equal((await accepted.handle(promote())).status, 200);
  const names = accepted.calls.map((x) => x[1]);
  assert.ok(names.indexOf("cms_media_approve") < names.indexOf("cms-public"));
  assert.deepEqual(accepted.calls.find((x) => x[1] === "cms_media_approve")[2], {
    p_ids: [mediaId],
    p_content_id: contentId,
    p_expected_version: 3,
  });
  assert.equal(accepted.calls.find((x) => x[1] === "cms_media_promote")[0], "service");
});
test("immutable retries verify bytes and reject conflicting existing objects without upsert", async () => {
  const data = new Uint8Array([1, 2, 3]);
  let options;
  const bucket = {
    upload: async (_path, _data, opts) => {
      options = opts;
      return { error: {} };
    },
    download: async () => ({ data: new Blob([data]) }),
  };
  await putImmutable(bucket, "id.webp", data, "image/webp");
  assert.equal(options.upsert, false);
  await assert.rejects(
    putImmutable(bucket, "id.webp", new Uint8Array([9, 8, 7]), "image/webp"),
    /does not match/,
  );
});

test("promotion acquires an exclusive lease before writes and submits the matching operation", async () => {
  const f = fixture();
  assert.equal((await f.handle(promoteRequest())).status, 200);
  assert.ok(
    f.calls.findIndex((c) => c[1] === "cms_media_begin_promote") <
      f.calls.findIndex((c) => c[0] === "upload"),
  );
  assert.deepEqual(f.calls.find((c) => c[1] === "cms_media_promote")[2], {
    p_id: mediaId,
    p_public_path: `${mediaId}.webp`,
    p_operation_id: operationId,
  });
  assert.equal(f.calls.find((c) => c[0] === "upload")[3].cacheControl, "60");
  const blocked = fixture({ serviceDeny: "cms_media_begin_promote" });
  assert.equal((await blocked.handle(promoteRequest())).status, 409);
  assert.equal(
    blocked.calls.some((c) => c[0] === "upload"),
    false,
  );
  const retiring = fixture({ session: { role: "owner" }, deny: "cms_media_retire", code: "PT409" });
  assert.equal(
    (
      await retiring.handle(
        request(JSON.stringify({ action: "retire", contentId }), {
          "content-type": "application/json",
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    retiring.calls.some((c) => c[0] === "remove"),
    false,
  );
});

test("ready media is verified without writes, and missing ready media is never recreated", async () => {
  for (const missingPublic of [false, true]) {
    const f = fixture({ ready: true, missingPublic });
    assert.equal((await f.handle(promoteRequest())).status, missingPublic ? 502 : 200);
    assert.equal(
      f.calls.some((c) => c[0] === "upload" || c[0] === "remove" || c[1] === "cms_media_promote"),
      false,
    );
  }
});

test("pre-write failure cancels only after confirmed removal; uncertain copy, cleanup or finalization keeps the lease", async () => {
  const f = fixture({ derivativeError: true });
  assert.equal((await f.handle(promoteRequest())).status, 502);
  assert.ok(
    f.calls.findIndex((c) => c[0] === "remove") <
      f.calls.findIndex((c) => c[1] === "cms_media_cancel_promote"),
  );
  assert.deepEqual(f.calls.find((c) => c[1] === "cms_media_cancel_promote")[2], {
    p_id: mediaId,
    p_operation_id: operationId,
  });
  const uncertain = fixture({ derivativeError: true, removeError: true });
  assert.equal((await uncertain.handle(promoteRequest())).status, 502);
  assert.equal(
    uncertain.calls.some((c) => c[1] === "cms_media_cancel_promote"),
    false,
  );
  const lostCopy = fixture({ uploadError: true, missingPublic: true });
  assert.equal((await lostCopy.handle(promoteRequest())).status, 502);
  assert.equal(
    lostCopy.calls.some((c) => c[0] === "remove" || c[1] === "cms_media_cancel_promote"),
    false,
  );
  const lostFinalize = fixture({ serviceDeny: "cms_media_promote" });
  assert.equal((await lostFinalize.handle(promoteRequest())).status, 409);
  assert.equal(
    lostFinalize.calls.some((c) => c[0] === "remove" || c[1] === "cms_media_cancel_promote"),
    false,
  );
  const lostUpload = fixture({ uploadError: true, uploadCommitted: true, missingPublic: true });
  assert.equal((await lostUpload.handle(promoteRequest())).status, 200);
});

test("retirement requires owner and recent database authorization before deleting only exact public derivative paths", async () => {
  const retire = (extra = {}) =>
    request(JSON.stringify({ action: "retire", contentId, ...extra }), {
      "content-type": "application/json",
    });
  for (const options of [{}, { session: { role: "owner" }, deny: "cms_media_retire" }]) {
    const f = fixture(options);
    const res = await f.handle(retire());
    assert.equal(res.status, 403);
    assert.equal(
      f.calls.some((call) => call[0] === "remove" || call[0] === "service"),
      false,
    );
    assert.doesNotMatch(await res.text(), /raw provider secret/);
  }
  const accepted = fixture({ session: { role: "owner" } });
  accepted.objects.set(`cms-public/${mediaId}.webp`, new Uint8Array([1]));
  assert.equal((await accepted.handle(retire())).status, 200);
  assert.equal(accepted.objects.has(`cms-public/${mediaId}.webp`), false);
  assert.deepEqual(
    accepted.calls.filter((call) => call[0] === "remove"),
    [["remove", "cms-public", [`${mediaId}.webp`]]],
  );
  const authorizeIndex = accepted.calls.findIndex((call) => call[1] === "cms_media_retire");
  const removeIndex = accepted.calls.findIndex((call) => call[0] === "remove");
  const finalizeIndex = accepted.calls.findIndex((call) => call[1] === "cms_media_retired");
  assert.ok(authorizeIndex < removeIndex && removeIndex < finalizeIndex);
  assert.deepEqual(accepted.calls[authorizeIndex], [
    "user",
    "cms_media_retire",
    { p_content_id: contentId },
  ]);
  assert.deepEqual(accepted.calls[finalizeIndex], [
    "service",
    "cms_media_retired",
    { p_id: mediaId, p_operation_id: operationId },
  ]);
  assert.equal((await accepted.handle(retire())).status, 200);
  const injected = fixture({ session: { role: "owner" } });
  assert.equal((await injected.handle(retire({ public_path: "arbitrary.webp" }))).status, 400);
  assert.equal(
    injected.calls.some((call) => call[0] === "remove"),
    false,
  );
  for (const path of [
    "../secret",
    `${contentId}.webp`,
    `folder/${mediaId}.webp`,
    `https://example.invalid/${mediaId}.webp`,
  ]) {
    const f = fixture({
      session: { role: "owner" },
      retiring: [{ id: mediaId, public_path: path }],
    });
    assert.equal((await f.handle(retire())).status, 502);
    assert.equal(
      f.calls.some((call) => call[0] === "remove"),
      false,
    );
  }
  const failed = fixture({ session: { role: "owner" }, removeError: true });
  const result = await failed.handle(retire());
  assert.equal(result.status, 502);
  assert.doesNotMatch(await result.text(), /raw provider secret/);
  assert.equal(
    failed.calls.some((call) => call[1] === "cms_media_retired"),
    false,
  );
});

test("overlapping retirement cannot delete without its own exclusive lease", async () => {
  let release, started;
  const removing = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    session: { role: "owner" },
    beforeRemove: async () => {
      started();
      await gate;
    },
  });
  const retire = () =>
    request(JSON.stringify({ action: "retire", contentId }), {
      "content-type": "application/json",
    });
  const first = f.handle(retire());
  await removing;
  assert.equal((await f.handle(retire())).status, 409);
  assert.equal(f.calls.filter((c) => c[0] === "remove").length, 1);
  release();
  assert.equal((await first).status, 200);
  const failed = fixture({ session: { role: "owner" }, removeError: true });
  assert.equal((await failed.handle(retire())).status, 502);
  assert.equal((await failed.handle(retire())).status, 409);
  assert.equal(failed.calls.filter((c) => c[0] === "remove").length, 1);
  const lostFinalize = fixture({ session: { role: "owner" }, serviceDeny: "cms_media_retired" });
  assert.equal((await lostFinalize.handle(retire())).status, 409);
  assert.equal((await lostFinalize.handle(retire())).status, 409);
  assert.equal(lostFinalize.calls.filter((c) => c[0] === "remove").length, 1);
  for (const retireLease of [
    { operation_id: null },
    { status: "pending" },
    { public_path: "other.webp" },
    { id: contentId },
  ]) {
    const invalid = fixture({ session: { role: "owner" }, retireLease });
    assert.equal((await invalid.handle(retire())).status, 502);
    assert.equal(
      invalid.calls.some((c) => c[0] === "remove"),
      false,
    );
  }
});

test(
  "actual pinned WASM decodes JPEG/PNG/WebP, strips metadata, rejects corrupt pixels and denies other coders",
  { skip: !process.env.IMAGE_MAGICK_TEST_DIR },
  async () => {
    const directory = process.env.IMAGE_MAGICK_TEST_DIR;
    const magick = await import(pathToFileURL(join(directory, "dist/index.js")).href);
    await initializeImages(magick, await readFile(join(directory, "dist/x86/magick.wasm")));
    const source = png(2, 1, [chunk("tEXt", Buffer.from("Comment\0private-location-secret"))]);
    const description = Buffer.from("private-location-secret\0");
    const exif = Buffer.alloc(32 + description.length);
    exif.write("Exif\0\0II", "latin1");
    exif.writeUInt16LE(42, 8);
    exif.writeUInt32LE(8, 10);
    exif.writeUInt16LE(1, 14);
    exif.writeUInt16LE(0x010e, 16);
    exif.writeUInt16LE(2, 18);
    exif.writeUInt32LE(description.length, 20);
    exif.writeUInt32LE(26, 24);
    description.copy(exif, 32);
    const inputs = [source];
    for (const format of [magick.MagickFormat.Jpeg, magick.MagickFormat.WebP])
      inputs.push(
        magick.ImageMagick.read(source, (image) => {
          image.setProfile("exif", exif);
          return image.write(format, (data) => data.slice());
        }),
      );
    assert.ok(Buffer.from(inputs[1]).includes(description));
    for (const input of inputs) {
      const output = transformImage(input, magick);
      assert.equal(output.width, 2);
      assert.equal(output.height, 1);
      assert.equal(inspectImage(output.data).format, "WEBP");
      assert.equal(
        Buffer.from(output.data).includes(Buffer.from("private-location-secret")),
        false,
      );
      magick.ImageMagick.read(output.data, (image) => {
        assert.deepEqual(image.profileNames, []);
        assert.equal(image.comment, null);
      });
    }
    assert.throws(() => transformImage(png(100, 100), magick), /safely processed/);
    const resized = transformImage(png(5000, 1, [], Buffer.alloc(15001)), magick);
    assert.equal(resized.width, 4096);
    assert.equal(resized.height, 1);
    assert.throws(
      () =>
        magick.ImageMagick.read(
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
          () => {},
        ),
      /security policy|not.?authorized|delegate|decode/i,
    );
    assert.equal(magick.ResourceLimits.disk, 0n);
    assert.equal(magick.ResourceLimits.memory, 96n * 1024n * 1024n);
    assert.equal(magick.ResourceLimits.time, 2n);
    const compressedBomb = png(5000, 4000, [], Buffer.alloc(60_004_000));
    assert.ok(compressedBomb.length < 100_000);
    assert.equal(inspectImage(compressedBomb).width, 5000);
    assert.throws(() => transformImage(compressedBomb, magick), /safely processed/);
    assert.equal(transformImage(source, magick).width, 2);
  },
);
