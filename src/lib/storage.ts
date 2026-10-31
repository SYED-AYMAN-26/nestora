/**
 * File storage — one interface, two backends.
 *
 *   BLOB_READ_WRITE_TOKEN set → Vercel Blob (durable object storage).
 *   otherwise                 → the local `uploads/` directory (development).
 *
 * Why this exists: the original implementation wrote every photo and every
 * private verification document to the local filesystem. A serverless
 * filesystem is read-only outside /tmp and does not survive a request, so on
 * Vercel every upload failed and every stored document vanished. Local disk is
 * still the default for `npm run dev`, so laptop behaviour is unchanged.
 *
 * PRIVATE documents never go to the public bucket: they are stored under a
 * `private/` prefix and served only through /api/files/private/[name], which
 * performs the ownership check and writes an audit entry. On Vercel Blob the
 * object is uploaded as a private blob and can only be read by this server with
 * the read-write token — it is never exposed as a public URL.
 */

export type StorageScope = "public" | "private";

export type StoredFile =
  | { ok: true; name: string; url: string }
  | { ok: false; error: string };

export const storageBackend: "blob" | "local" =
  process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";

/**
 * A production process must not write uploads to the local filesystem: on a
 * serverless platform it is read-only outside /tmp and does not survive the
 * request. src/lib/boot.ts refuses to start such a process; this is the second
 * line of defence, so a local write can never happen even if that gate is
 * bypassed or the module is imported by a script.
 */
function assertWritableTarget(): void {
  if (process.env.NODE_ENV !== "production" || storageBackend === "blob") return;
  const allowInsecure = ["1", "true", "yes"].includes(
    String(process.env.RENTLINK_ALLOW_INSECURE_PROD ?? "").toLowerCase()
  );
  if (allowInsecure) return;
  throw new Error(
    "Refusing to write uploads to the local filesystem in production: BLOB_READ_WRITE_TOKEN is not set."
  );
}

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

/* ------------------------------------------------------------------- local */

async function localWrite(scope: StorageScope, name: string, buf: Buffer): Promise<void> {
  const { UPLOAD_ROOT } = await import("./uploads");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(UPLOAD_ROOT, scope);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
}

async function localRead(scope: StorageScope, name: string): Promise<Buffer | null> {
  const { resolveFile } = await import("./uploads");
  const file = resolveFile(scope, name);
  if (!file) return null;
  const fs = await import("node:fs");
  return fs.readFileSync(file);
}

/* -------------------------------------------------------------------- blob */

async function blobWrite(scope: StorageScope, name: string, buf: Buffer, contentType: string): Promise<string> {
  const { put } = await import("@vercel/blob");
  const blob = await put(`${scope}/${name}`, buf, {
    access: scope === "public" ? "public" : "private",
    contentType,
    token: blobToken(),
    // Names are already unique (timestamp + 128 bits of randomness), so a
    // collision means something is wrong — fail rather than silently overwrite.
    allowOverwrite: false,
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Reads a blob through the SDK's `get()`, which authenticates with the
 * read-write token. Private blobs therefore never need — and never get — a
 * publicly reachable URL.
 */
async function blobRead(scope: StorageScope, name: string): Promise<Buffer | null> {
  const { get } = await import("@vercel/blob");
  try {
    const found = await get(`${scope}/${name}`, {
      access: scope === "public" ? "public" : "private",
      token: blobToken(),
    });
    if (!found || !found.stream) return null;
    const chunks: Uint8Array[] = [];
    // `stream` is a web ReadableStream in the current SDK.
    const reader = found.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- interface */

/** Writes a validated file and returns the URL the application stores. */
export async function putFile(
  scope: StorageScope,
  name: string,
  buf: Buffer,
  contentType: string
): Promise<StoredFile> {
  try {
    assertWritableTarget();
    if (storageBackend === "blob") {
      await blobWrite(scope, name, buf, contentType);
    } else {
      await localWrite(scope, name, buf);
    }
  } catch (e) {
    console.error(`[storage] ${storageBackend} write failed for ${scope}/${name}`, e);
    return {
      ok: false,
      error:
        storageBackend === "blob"
          ? "Could not store the file in object storage. Check BLOB_READ_WRITE_TOKEN."
          : "Could not store the file on disk.",
    };
  }
  // The application always addresses files through its own authorised routes,
  // so the stored URL is stable regardless of where the bytes actually live.
  return { ok: true, name, url: `/api/files/${scope}/${name}` };
}

/** Reads a file for serving. Returns null when it does not exist. */
export async function getFile(scope: StorageScope, name: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|avif|pdf)$/i.test(name)) return null;
  try {
    return storageBackend === "blob" ? await blobRead(scope, name) : await localRead(scope, name);
  } catch (e) {
    console.error(`[storage] ${storageBackend} read failed for ${scope}/${name}`, e);
    return null;
  }
}

export function storageReport() {
  return {
    backend: storageBackend,
    durable: storageBackend === "blob",
    note:
      storageBackend === "blob"
        ? "Uploads are written to durable object storage."
        : "Uploads are written to the local filesystem. Fine for local development; on a serverless deployment this is NOT durable and must be replaced with object storage.",
  };
}
