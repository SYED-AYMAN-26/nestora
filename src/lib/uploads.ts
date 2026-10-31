import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "./constants";

export const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "uploads");
export const PUBLIC_DIR = path.join(UPLOAD_ROOT, "public");
export const PRIVATE_DIR = path.join(UPLOAD_ROOT, "private");

function ensure() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "application/pdf": "pdf",
};

/** Magic-byte sniffing: the declared MIME type alone is not trusted. */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (buf.subarray(0, 4).toString() === "ftyp") return "image/avif";
  return null;
}

export type SaveResult = { ok: true; url: string } | { ok: false; error: string };

export async function saveUpload(file: File, kind: "image" | "document"): Promise<SaveResult> {
  if (!file || typeof file.arrayBuffer !== "function") return { ok: false, error: "No file provided" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `File too large (max ${MAX_UPLOAD_BYTES / 1048576} MB)` };
  if (file.size === 0) return { ok: false, error: "Empty file" };
  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = sniff(buf);
  const allowed = kind === "image" ? ALLOWED_IMAGE_TYPES : ALLOWED_DOC_TYPES;
  const mime = sniffed && allowed.includes(sniffed) ? sniffed : null;
  if (!mime) {
    return {
      ok: false,
      error: `Unsupported file content. Allowed ${kind === "image" ? "JPEG, PNG, WebP" : "PDF, JPEG, PNG, WebP"}.`,
    };
  }
  ensure();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.${EXT[mime]}`;
  const target = kind === "image" ? PUBLIC_DIR : PRIVATE_DIR;
  fs.writeFileSync(path.join(target, name), buf);
  return { ok: true, url: kind === "image" ? `/api/files/public/${name}` : `/api/files/private/${name}` };
}

export function resolveFile(scope: "public" | "private", name: string): string | null {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|avif|pdf)$/i.test(name)) return null;
  const file = path.join(scope === "public" ? PUBLIC_DIR : PRIVATE_DIR, name);
  if (!file.startsWith(UPLOAD_ROOT)) return null;
  return fs.existsSync(file) ? file : null;
}

export function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", pdf: "application/pdf" }[
      ext || ""
    ] || "application/octet-stream"
  );
}
