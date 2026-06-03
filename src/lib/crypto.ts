import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric envelope encryption for at-rest secrets stored in DB
 * columns — currently `Company.whatsappAccessToken` (Phase 9.5 risk
 * fix), designed to be reused for any future tenant-held secret.
 *
 * Algorithm: AES-256-GCM. The key is derived from `AUTH_SECRET` via
 * SHA-256 — reusing the existing system-wide secret rather than
 * adding a new env var the operator can forget to set. AUTH_SECRET
 * is already mandatory (NextAuth refuses to boot without it), so the
 * crypto module fails closed when it's absent.
 *
 * Ciphertext shape (single string, base64url-encoded):
 *
 *     enc:v1:<iv>.<tag>.<ciphertext>
 *
 * The `enc:v1:` prefix lets readers detect "already encrypted" vs
 * legacy plaintext rows during the cutover — if the value doesn't
 * start with `enc:v1:` we treat it as plaintext and re-encrypt on
 * next write. Once every row is migrated the legacy branch can be
 * deleted.
 */

const KEY_VERSION = "v1";
const ALGO = "aes-256-gcm";
const PREFIX = `enc:${KEY_VERSION}:`;
const IV_BYTES = 12; // GCM standard

let _key: Buffer | null | undefined;

/** Derive the 32-byte key from AUTH_SECRET. Cached after first call. */
function getKey(): Buffer | null {
  if (_key !== undefined) return _key;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    _key = null;
    return null;
  }
  _key = createHash("sha256").update(secret).digest();
  return _key;
}

/**
 * Encrypt a UTF-8 string. Returns the `enc:v1:...` envelope.
 * Throws when AUTH_SECRET isn't configured — encryption is mandatory
 * for at-rest secrets; silent fallback to plaintext would be worse
 * than a loud failure (operator notices, fixes the env).
 */
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) {
    throw new Error("AUTH_SECRET not configured — cannot encrypt secret.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [b64u(iv), b64u(tag), b64u(enc)].join(".");
}

/**
 * Decrypt an envelope produced by encryptSecret. Tolerant of legacy
 * plaintext values (lacking the `enc:v1:` prefix) — returns them
 * verbatim so existing rows keep working until the next write
 * re-encrypts them. Returns null on tamper / wrong key / malformed
 * input rather than throwing, so callers can fail-soft on read.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    // Legacy plaintext row — return as-is. Will be re-encrypted on
    // next save via updateIntegrations.
    return stored;
  }
  const key = getKey();
  if (!key) return null;

  const parts = stored.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;

  try {
    const iv = b64uDecode(parts[0]);
    const tag = b64uDecode(parts[1]);
    const ct = b64uDecode(parts[2]);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when the stored value is already in the encrypted envelope. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

function b64u(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
