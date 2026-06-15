"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { invalidateUserStatus } from "@/lib/user-status";
import { setFlash } from "@/lib/flash";
import { canAddUser } from "@/lib/plans";
import { encryptSecret } from "@/lib/crypto";

const userSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Min 6 characters"),
  role: z.enum(["ADMIN", "AGENT", "DEALER"]),
  phone: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageUsers")) return { error: "Not allowed." };

  const parsed = userSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() } });
  if (existing) return { error: "That email is already in use." };

  // Phase 8: plan-level cap. Returns a human-readable upgrade hint when blocked.
  const usage = await canAddUser(user.companyId);
  if (!usage.ok) return { error: usage.reason ?? "User limit reached for your current plan." };

  const created = await prisma.user.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      email: d.email.toLowerCase(),
      passwordHash: await bcrypt.hash(d.password, 10),
      role: d.role,
      phone: d.phone || null,
    },
  });

  // A dealer login also gets a dealer profile so inventory can link to them.
  if (d.role === "DEALER") {
    await prisma.dealer.create({
      data: { companyId: user.companyId, userId: created.id, name: d.name, contact: d.phone || null },
    });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "user.created",
    entityType: "USER",
    entityId: created.id,
    summary: `Added ${d.role.toLowerCase()} ${d.name}`,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Toggle a user between ACTIVE and SUSPENDED. Hardened against:
 *  - self-suspension (would lock the actor out of the company)
 *  - touching SUPER_ADMIN (platform-level account; not ours to manage)
 *  - cross-tenant access (only users inside the same company)
 *
 * Suspended users are already rejected at the login step (auth.ts:26),
 * so they cannot create new sessions. Existing JWT sessions remain valid
 * until expiry — Phase 2 will add token-version invalidation.
 */
export async function setUserStatus(formData: FormData): Promise<void> {
  const actor = await requireCompanyUser();
  if (!can(actor.role, "manageUsers")) return;

  const targetId = String(formData.get("userId") || "");
  const next = String(formData.get("status") || "");
  if (!targetId || (next !== "ACTIVE" && next !== "SUSPENDED")) return;

  if (targetId === actor.id) return; // never let an actor suspend themselves

  const target = await prisma.user.findFirst({
    where: { id: targetId, companyId: actor.companyId },
    select: { id: true, name: true, role: true, status: true },
  });
  if (!target) return;
  if (target.role === "SUPER_ADMIN") return; // out of scope for company actors
  if (target.status === next) return; // no-op; avoids noisy activity-log entries

  await prisma.user.update({
    where: { id: targetId },
    data: { status: next as "ACTIVE" | "SUSPENDED" },
  });
  // Drop the cached status so the next requireUser() call sees the change
  // without waiting for the 60s TTL to expire.
  invalidateUserStatus(targetId);
  await logActivity({
    companyId: actor.companyId,
    userId: actor.id,
    action: next === "SUSPENDED" ? "user.suspended" : "user.reactivated",
    entityType: "USER",
    entityId: targetId,
    summary: next === "SUSPENDED" ? `Suspended ${target.name}` : `Reactivated ${target.name}`,
    meta: { previousStatus: target.status, newStatus: next },
  });

  await setFlash({
    tone: next === "SUSPENDED" ? "warn" : "ok",
    message: next === "SUSPENDED"
      ? `${target.name} suspended. Existing sessions will be rejected within 60s.`
      : `${target.name} reactivated.`,
  });
  revalidatePath("/settings");
}

const brandingSchema = z.object({
  // Hex color or empty (clears the override). Validation is permissive — the
  // settings UI provides a color picker; manual typing is uncommon.
  brandColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Hex like #4f46e5").or(z.literal("")).optional(),
  // Free-text IANA timezone. Empty clears.
  timezone: z.string().max(60).optional(),
  // Logo URL — typically an /api/files path or a CDN URL. No format check; the
  // UI uses an Uploader so the value is structurally trusted.
  logoUrl: z.string().max(500).optional(),
  invoiceFooter: z.string().max(500).optional(),
  receiptFooter: z.string().max(500).optional(),
  whatsappSignature: z.string().max(280).optional(),
});

/**
 * OWNER-only — updates the per-company white-label fields. Empty strings clear
 * the override (fall back to platform defaults at the render layer).
 */
export async function updateCompanyBranding(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireCompanyUser();
  // Branding is a strategic setting; gate to OWNER only (Admins don't get to
  // change the company's outward presentation).
  if (user.role !== "OWNER") return { error: "Only the company owner can edit branding." };

  const parsed = brandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  // Empty string → null so the UI's "fall back to default" logic works.
  const blank = (s?: string) => (s && s.trim() ? s.trim() : null);

  await prisma.company.update({
    where: { id: user.companyId },
    data: {
      brandColor: blank(d.brandColor),
      timezone: blank(d.timezone),
      logoUrl: blank(d.logoUrl),
      invoiceFooter: blank(d.invoiceFooter),
      receiptFooter: blank(d.receiptFooter),
      whatsappSignature: blank(d.whatsappSignature),
    },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "company.branding_updated",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: "Updated branding & locale settings",
  });
  await setFlash({ tone: "ok", message: "Branding saved." });
  revalidatePath("/settings");
  return { ok: true };
}

const ruleSchema = z.object({
  mainAgentPct: z.coerce.number().min(0).max(100),
  companyPct: z.coerce.number().min(0).max(100),
  otherAgentPct: z.coerce.number().min(0).max(100),
  dealerPct: z.coerce.number().min(0).max(100),
  noOtherFallback: z.enum(["MAIN", "COMPANY"]),
});

export async function updateCommissionRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "setCommissionRules")) return { error: "Not allowed." };

  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const sum = d.mainAgentPct + d.companyPct + d.otherAgentPct + d.dealerPct;
  if (Math.round(sum) !== 100) return { error: `Percentages must total 100% (currently ${sum}%).` };

  const existing = await prisma.commissionRule.findFirst({ where: { companyId: user.companyId, isDefault: true } });
  const data = {
    mainAgentPct: new Prisma.Decimal(d.mainAgentPct),
    companyPct: new Prisma.Decimal(d.companyPct),
    otherAgentPct: new Prisma.Decimal(d.otherAgentPct),
    dealerPct: new Prisma.Decimal(d.dealerPct),
    noOtherFallback: d.noOtherFallback,
  };

  if (existing) {
    await prisma.commissionRule.update({ where: { id: existing.id }, data });
  } else {
    await prisma.commissionRule.create({
      data: { companyId: user.companyId, name: "Company Default", isDefault: true, ...data },
    });
  }

  // Build a before/after audit pair — payout disputes hinge on knowing
  // exactly what the rule was at the moment a commission was generated.
  const before = existing
    ? {
        mainAgentPct: Number(existing.mainAgentPct),
        companyPct: Number(existing.companyPct),
        otherAgentPct: Number(existing.otherAgentPct),
        dealerPct: Number(existing.dealerPct),
        noOtherFallback: existing.noOtherFallback,
      }
    : null;
  const after = {
    mainAgentPct: d.mainAgentPct,
    companyPct: d.companyPct,
    otherAgentPct: d.otherAgentPct,
    dealerPct: d.dealerPct,
    noOtherFallback: d.noOtherFallback,
  };

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission_rule.updated",
    entityType: "COMMISSION_RULE",
    summary: `Updated default split → ${d.mainAgentPct}/${d.companyPct}/${d.otherAgentPct}/${d.dealerPct}`,
    meta: { before, after },
  });

  revalidatePath("/settings");
  return { ok: true };
}

// ─────────────────────────────────────────────────────── Phase 9.5 ───
// Integrations: WhatsApp Business API credentials + AI master switch.

const integrationsSchema = z.object({
  whatsappPhoneId: z.string().trim().max(64).optional(),
  // Length 0 means "leave unchanged" (so the operator can edit the
  // phoneId without re-pasting the long token); "__CLEAR__" wipes it.
  whatsappAccessToken: z.string().trim().max(500).optional(),
  // WABA id — used by the template-catalog sync.
  whatsappBusinessAccountId: z.string().trim().max(64).optional(),
  // Checkboxes are absent from FormData when unticked.
  aiEnabled: z.string().optional(),
});

/**
 * OWNER-only — updates the WhatsApp Cloud API credentials + the AI
 * master switch. Token handling has two affordances: empty input
 * preserves the existing token (operator can fix phoneId without
 * re-pasting the long token), and the literal "__CLEAR__" sentinel
 * wipes it (matching the "Disconnect" button).
 *
 * The action never returns the stored token — the form renders a
 * masked placeholder ("•••• stored") when one is present.
 */
export async function updateIntegrations(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") {
    return { error: "Only the company owner can edit integrations." };
  }

  const parsed = integrationsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const phoneId = d.whatsappPhoneId && d.whatsappPhoneId.length > 0 ? d.whatsappPhoneId : null;

  // Tri-state token: undefined ⇒ leave alone; "__CLEAR__" ⇒ wipe;
  // anything else ⇒ new value (encrypted at rest via AES-256-GCM — see
  // lib/crypto.ts. AUTH_SECRET-derived key, so token security follows
  // the same custody chain as session cookies).
  let tokenUpdate: { whatsappAccessToken: string | null } | undefined;
  if (d.whatsappAccessToken === "__CLEAR__") {
    tokenUpdate = { whatsappAccessToken: null };
  } else if (d.whatsappAccessToken && d.whatsappAccessToken.length > 0) {
    try {
      tokenUpdate = { whatsappAccessToken: encryptSecret(d.whatsappAccessToken) };
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Failed to encrypt the access token.",
      };
    }
  }

  const aiEnabled = d.aiEnabled === "on" || d.aiEnabled === "true";

  const wabaId =
    d.whatsappBusinessAccountId && d.whatsappBusinessAccountId.length > 0
      ? d.whatsappBusinessAccountId
      : null;

  // Uniqueness on phoneId is enforced at the DB layer (@@unique).
  try {
    await prisma.company.update({
      where: { id: user.companyId },
      data: {
        whatsappPhoneId: phoneId,
        whatsappBusinessAccountId: wabaId,
        ...(tokenUpdate ?? {}),
        aiEnabled,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That WhatsApp phone number ID is already claimed by another workspace." };
    }
    throw e;
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "company.integrations_updated",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: "Updated WhatsApp / AI integration settings",
    // Never log the token — only flags.
    meta: {
      whatsappPhoneIdSet: !!phoneId,
      tokenAction:
        d.whatsappAccessToken === "__CLEAR__"
          ? "cleared"
          : d.whatsappAccessToken
            ? "rotated"
            : "unchanged",
      aiEnabled,
    },
  });
  await setFlash({ tone: "ok", message: "Integration settings saved." });
  revalidatePath("/settings");
  return { ok: true };
}

const leadRoutingSchema = z.object({
  strategy: z.enum(["MANUAL", "ROUND_ROBIN", "TERRITORY_MATCH", "SHARK_TANK"]),
});

/**
 * Set the company's auto lead-routing strategy. Gated to the roles that manage
 * lead assignment (assignLeadsCalendars = OWNER/ADMIN). MANUAL disables
 * auto-routing — incoming unassigned leads stay for manual triage.
 */
export async function updateLeadRouting(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return { error: "Not allowed." };

  const parsed = leadRoutingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick a valid routing strategy." };

  await prisma.company.update({
    where: { id: user.companyId },
    data: { leadRoutingStrategy: parsed.data.strategy },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "company.lead_routing_updated",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: `Lead routing → ${parsed.data.strategy.replace(/_/g, " ").toLowerCase()}`,
  });
  await setFlash({ tone: "ok", message: "Lead routing saved." });
  revalidatePath("/settings");
  return { ok: true };
}

const automationSchema = z.object({
  event: z.enum(["CONTRACT_VERIFY"]),
  // "name|language" of an approved template, or "" to turn the automation off.
  template: z.string(),
});

/**
 * Map (or clear) the approved WhatsApp template used for an automation event.
 * Owner-only. Validates the chosen template is APPROVED + belongs to the tenant
 * so a stale/foreign name can't be wired in.
 */
export async function updateWhatsappAutomation(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") return { error: "Only the company owner can configure this." };

  const parsed = automationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid selection." };
  const { event, template } = parsed.data;

  if (!template) {
    await prisma.whatsAppAutomation.deleteMany({ where: { companyId: user.companyId, event } });
  } else {
    const [templateName, language] = template.split("|");
    if (!templateName || !language) return { error: "Invalid template." };
    const tpl = await prisma.whatsAppTemplate.findFirst({
      where: { companyId: user.companyId, name: templateName, language, status: "APPROVED" },
      select: { id: true },
    });
    if (!tpl) return { error: "Pick an approved template." };
    await prisma.whatsAppAutomation.upsert({
      where: { companyId_event: { companyId: user.companyId, event } },
      create: { companyId: user.companyId, event, templateName, language },
      update: { templateName, language },
    });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "company.wa_automation_updated",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: `WhatsApp automation: ${event} → ${template || "off"}`,
  });
  await setFlash({ tone: "ok", message: "WhatsApp automation saved." });
  revalidatePath("/settings");
  return { ok: true };
}
