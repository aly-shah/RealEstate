/**
 * Magic-byte sniffer. Trusts the file's actual bytes over the client-claimed
 * extension/MIME — the upload endpoint compares the sniff result against the
 * declared extension and rejects on mismatch, so a `.pdf` filename containing
 * a PE executable is caught.
 *
 * Kept dependency-free (no `file-type` package) because the allowlist is
 * small. If you add formats later, add a row here.
 */

export type SniffedKind =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "pdf"
  | "zip" // covers .docx / .xlsx (Office files are zipped containers)
  | "ole" // legacy .doc / .xls
  | "text" // .csv / .txt — no magic, best-effort heuristic
  | "unknown";

/** Map every allowed extension to the set of magic-byte families it may contain. */
const EXT_KINDS: Record<string, ReadonlyArray<SniffedKind>> = {
  ".jpg":  ["jpeg"],
  ".jpeg": ["jpeg"],
  ".png":  ["png"],
  ".gif":  ["gif"],
  ".webp": ["webp"],
  ".avif": ["avif"],
  ".pdf":  ["pdf"],
  ".docx": ["zip"],
  ".xlsx": ["zip"],
  ".doc":  ["ole"],
  ".xls":  ["ole"],
  ".csv":  ["text"],
  ".txt":  ["text"],
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Inspect the leading bytes of `buf` and return the most specific match.
 * Reads up to 32 bytes — every supported format is identifiable within that
 * window, so callers can pass a `subarray(0, 32)` slice if they want.
 */
export function sniffKind(buf: Buffer): SniffedKind {
  if (buf.length < 4) return "unknown";

  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // GIF: "GIF87a" or "GIF89a"
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return "gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  // AVIF: bytes 4-11 = "ftypavif" (or "ftypheic"/"ftypmif1" for sibling formats — we only accept avif).
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)) {
    return "avif";
  }
  // PDF: "%PDF-"
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  // ZIP container (Office .docx / .xlsx): "PK\x03\x04" or "PK\x05\x06" (empty zip).
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    return "zip";
  }
  // OLE2 container (legacy Office): D0 CF 11 E0 A1 B1 1A E1
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";

  // Best-effort text test: no NUL byte in the first 512 bytes.
  const slice = buf.subarray(0, Math.min(512, buf.length));
  if (!slice.includes(0)) return "text";

  return "unknown";
}

/**
 * Validate a file's bytes match its declared extension. Returns `{ ok: true }`
 * on a match, or `{ ok: false, reason }` describing the mismatch.
 *
 * Extension is the lowercased "." + ext (e.g. ".pdf"); buf is the file's
 * leading bytes (32 is enough for every format we check).
 */
export function mimeMatchesExtension(
  ext: string,
  buf: Buffer,
): { ok: true; kind: SniffedKind } | { ok: false; reason: string; kind: SniffedKind } {
  const allowed = EXT_KINDS[ext.toLowerCase()];
  if (!allowed) {
    return { ok: false, reason: `Extension ${ext} is not in the allowlist.`, kind: "unknown" };
  }
  const kind = sniffKind(buf);
  if (allowed.includes(kind)) return { ok: true, kind };
  return {
    ok: false,
    reason: `File content (${kind}) does not match declared extension (${ext}).`,
    kind,
  };
}
