import path from "node:path";

/** Root directory for tenant-scoped uploads (outside /public, served via API). */
export const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Strip path separators and unsafe chars from a user-supplied filename. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}
