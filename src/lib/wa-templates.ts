import { prisma } from "@/lib/prisma";
import type { TemplateDef } from "@/lib/wa-business";

/**
 * Persist a freshly-fetched template catalog for a tenant — shared by
 * the OWNER-triggered sync server action (`syncWhatsappTemplates`) and
 * the cron-driven `sweepWhatsAppTemplateCatalog`. Kept out of
 * `"use server"` files because every export from those is exposed as
 * an RPC endpoint; this helper has no auth + needs to be callable
 * from server-only contexts.
 *
 * Upserts run in parallel chunks of 10 so a tenant with 500 templates
 * doesn't take 5+ seconds. Pruning is one deleteMany. Idempotent.
 */
const UPSERT_CHUNK_SIZE = 10;

export async function persistTemplateCatalog(
  companyId: string,
  templates: TemplateDef[],
): Promise<{ pruned: number }> {
  const upsertOne = (t: TemplateDef) =>
    prisma.whatsAppTemplate.upsert({
      where: {
        companyId_name_language: {
          companyId,
          name: t.name,
          language: t.language,
        },
      },
      create: {
        companyId,
        name: t.name,
        language: t.language,
        category: t.category,
        // Surface media-headers as a non-selectable status so the dropdown
        // filter (status === "APPROVED") skips them automatically while
        // the Settings list still shows what's there for triage.
        status: t.hasMediaHeader && t.status === "APPROVED" ? "UNSUPPORTED_MEDIA_HEADER" : t.status,
        bodyText: t.bodyText,
        paramCount: t.paramCount,
        headerText: t.headerText || null,
        headerParamCount: t.headerParamCount,
      },
      update: {
        category: t.category,
        status: t.hasMediaHeader && t.status === "APPROVED" ? "UNSUPPORTED_MEDIA_HEADER" : t.status,
        bodyText: t.bodyText,
        paramCount: t.paramCount,
        headerText: t.headerText || null,
        headerParamCount: t.headerParamCount,
        syncedAt: new Date(),
      },
    });

  for (let i = 0; i < templates.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = templates.slice(i, i + UPSERT_CHUNK_SIZE);
    await Promise.all(chunk.map(upsertOne));
  }

  // Prune local rows that vanished upstream (deleted in Business Manager).
  const survivors = templates.map((t) => `${t.name}::${t.language}`);
  const stale = await prisma.whatsAppTemplate.findMany({
    where: { companyId },
    select: { id: true, name: true, language: true },
  });
  const toDelete = stale
    .filter((s) => !survivors.includes(`${s.name}::${s.language}`))
    .map((s) => s.id);
  let pruned = 0;
  if (toDelete.length > 0) {
    const r = await prisma.whatsAppTemplate.deleteMany({
      where: { id: { in: toDelete } },
    });
    pruned = r.count;
  }
  return { pruned };
}
