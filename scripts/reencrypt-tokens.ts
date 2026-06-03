/**
 * AUTH_SECRET rotation helper — re-encrypts every stored
 * Company.whatsappAccessToken under a NEW key derived from a new
 * AUTH_SECRET, so outbound WhatsApp keeps working across the rotation.
 *
 * Without this script, rotating AUTH_SECRET silently breaks outbound:
 * the existing ciphertext was encrypted with the SHA-256 of the OLD
 * secret, and the new server can't decrypt it. Owners would have to
 * re-paste their tokens via Settings → Integrations one by one.
 *
 * Usage:
 *
 *   OLD_AUTH_SECRET="<old value>" \
 *   AUTH_SECRET="<new value>" \
 *   DATABASE_URL="..." \
 *     npx tsx scripts/reencrypt-tokens.ts [--dry-run]
 *
 *   - OLD_AUTH_SECRET must be the secret the tokens were encrypted under.
 *   - AUTH_SECRET is the new one (also what the next deploy will use).
 *   - --dry-run only counts rows; pass without it to actually update.
 *
 * Safety:
 *   - The script reads every row, decrypts with the OLD key, and re-encrypts
 *     with the NEW key before writing back. Rows that are still in legacy
 *     plaintext form get encrypted under the new key (one-way upgrade).
 *   - On any decryption failure the row is reported but NOT touched — the
 *     operator can drop into Settings to re-paste manually. We never
 *     overwrite a row we can't read.
 *   - Use a DB transaction per row (Prisma's default for update) so a
 *     mid-run crash leaves the DB in a consistent state — partial progress
 *     is fine because the script is re-runnable.
 *
 * Re-run safety: running this twice with the same OLD/NEW pair is a no-op
 * on the second pass (the script detects rows already under the new key
 * and skips them; see `attemptDecrypt` fallback chain).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [b64u(iv), b64u(tag), b64u(enc)].join(".");
}

function tryDecrypt(stored: string, key: Buffer): string | null {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const parts = stored.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = b64uDecode(parts[0]);
    const tag = b64uDecode(parts[1]);
    const ct = b64uDecode(parts[2]);
    const d = createDecipheriv(ALGO, key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function b64u(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

async function main() {
  const oldSecret = process.env.OLD_AUTH_SECRET;
  const newSecret = process.env.AUTH_SECRET;
  const dryRun = process.argv.includes("--dry-run");

  if (!oldSecret || !newSecret) {
    console.error("OLD_AUTH_SECRET and AUTH_SECRET must both be set.");
    process.exit(2);
  }
  if (oldSecret === newSecret) {
    console.error("OLD_AUTH_SECRET === AUTH_SECRET — nothing to do.");
    process.exit(2);
  }

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.company.findMany({
      where: { whatsappAccessToken: { not: null } },
      select: { id: true, name: true, whatsappAccessToken: true },
    });
    console.log(`Found ${rows.length} tenant(s) with a stored access token.`);

    let rotated = 0;
    let alreadyNew = 0;
    let unreadable = 0;
    let legacyEncrypted = 0;

    for (const r of rows) {
      const stored = r.whatsappAccessToken!;
      // Try the NEW key first — if it decrypts, this row is already
      // rotated (or always-was-new) and we skip.
      if (tryDecrypt(stored, newKey) !== null && stored.startsWith(PREFIX)) {
        alreadyNew += 1;
        continue;
      }
      // Try the OLD key.
      const plain = tryDecrypt(stored, oldKey);
      if (plain === null) {
        unreadable += 1;
        console.warn(`  [skip] ${r.name} (${r.id}) — cannot decrypt with old key.`);
        continue;
      }
      if (!stored.startsWith(PREFIX)) legacyEncrypted += 1;

      if (!dryRun) {
        await prisma.company.update({
          where: { id: r.id },
          data: { whatsappAccessToken: encrypt(plain, newKey) },
        });
      }
      rotated += 1;
      console.log(`  [${dryRun ? "dry" : "ok"}] ${r.name} (${r.id})`);
    }

    console.log("");
    console.log(`Rotated:           ${rotated}${dryRun ? " (dry-run, no writes)" : ""}`);
    console.log(`Already new key:   ${alreadyNew}`);
    console.log(`Legacy → encrypted: ${legacyEncrypted}`);
    console.log(`Unreadable (skip): ${unreadable}`);
    if (unreadable > 0) {
      console.log("");
      console.log("Unreadable rows need the owner to re-paste their token via Settings → Integrations.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
