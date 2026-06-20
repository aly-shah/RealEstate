import { prisma } from "@/lib/prisma";
import { runAi } from "@/lib/ai/run";
import { tolerantJsonParse } from "@/lib/ai/handlers/whatsapp-classify";
import { fmtDate, toNumber } from "@/lib/format";

/**
 * AI Sales Assistant — a per-lead conversion assessment + action plan.
 *
 * Gathers the lead's full state (stage, recency, engagement, visits, deals,
 * budget/prefs + a few matching listings) and asks the model for a structured
 * plan: conversion probability, urgency/risk, the reasons behind the score, the
 * next best actions, and a ready-to-send WhatsApp message. Cached via the
 * AiSuggestion pipeline (runAi); the input hash invalidates on fresh activity.
 */

export interface LeadSalesPlan {
  conversionProbability: number; // 0-100
  urgency: "LOW" | "MEDIUM" | "HIGH";
  risk: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  nextActions: string[];
  suggestedMessage: string;
}

export type LeadSalesPlanResult =
  | { ok: true; plan: LeadSalesPlan; fromCache: boolean }
  | { ok: false; reason: string };

const SYSTEM = `You are an AI sales assistant for a Pakistani real-estate brokerage CRM (Proptimizr).
Given a lead's full context, assess their likelihood to convert into a closed deal and produce a concrete action plan.

Respond with a SINGLE JSON object — no prose, no Markdown, no code fences. Keys EXACTLY:
  conversionProbability: integer 0-100, your honest estimate
  urgency: one of LOW, MEDIUM, HIGH — how soon the agent should act
  risk: one of LOW, MEDIUM, HIGH — risk of losing this lead
  reasons: array of 2-4 short strings justifying the probability (e.g. "Requested a visit", "Budget matches available stock", "No contact in 6 days")
  nextActions: array of 2-4 short imperative steps for the agent (e.g. "Send 3 DHA Phase 8 apartments under 3 crore", "Schedule a viewing this weekend")
  suggestedMessage: a ready-to-send WhatsApp message to the client, warm and professional, referencing their specifics, <= 320 chars, plain text (no Markdown)

Rules: use ONLY the provided context — never invent prices, areas, names, or commitments. Currency is PKR. Areas use MARLA/KANAL/SQFT — don't convert. Direct tone, no preamble.`;

const VALID = new Set(["LOW", "MEDIUM", "HIGH"]);

export async function generateLeadSalesPlan(input: { companyId: string; leadId: string }): Promise<LeadSalesPlanResult> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: {
      client: { select: { id: true, name: true } },
      showings: { orderBy: { createdAt: "desc" }, take: 5, select: { interestLevel: true, clientFeedback: true } },
      deals: { select: { status: true } },
    },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };

  const views = lead.client
    ? await prisma.propertyView.count({ where: { companyId: input.companyId, clientId: lead.client.id } })
    : 0;

  // A few matching available listings for grounding the plan's suggestions.
  const matches = await prisma.property.findMany({
    where: {
      companyId: input.companyId,
      status: "AVAILABLE",
      ...(lead.prefType ? { type: lead.prefType } : {}),
      ...(lead.prefArea ? { area: { contains: lead.prefArea, mode: "insensitive" } } : {}),
    },
    take: 3,
    orderBy: { createdAt: "desc" },
    select: { title: true, area: true, salePrice: true, monthlyRent: true },
  });

  const lastTouch = lead.lastContactedAt ?? lead.createdAt;
  const inputs: Record<string, unknown> = {
    stage: lead.stage,
    source: lead.source,
    last_contacted: lead.lastContactedAt ? fmtDate(lead.lastContactedAt) : `never (created ${fmtDate(lead.createdAt)})`,
    days_since_contact: Math.floor((Date.now() - lastTouch.getTime()) / 86_400_000),
    client: lead.client?.name ?? "Unknown",
    listing_views: views,
    visits: lead.showings.length,
    visit_interest: lead.showings.map((s) => s.interestLevel ?? "?").join(",") || "none",
    deals: lead.deals.map((d) => d.status).join(",") || "none",
  };
  if (lead.prefType) inputs.preferred_type = lead.prefType;
  if (lead.prefArea) inputs.preferred_area = lead.prefArea;
  if (lead.budgetMax) inputs.budget_pkr_max = lead.budgetMax.toString();
  if (lead.budgetMin) inputs.budget_pkr_min = lead.budgetMin.toString();
  if (lead.requirements) inputs.requirements = lead.requirements.slice(0, 300);
  if (matches.length) {
    inputs.matching_properties = matches
      .map((m) => `${m.title} (${m.area ?? "?"}, ${m.salePrice ? `sale ${toNumber(m.salePrice)}` : m.monthlyRent ? `rent ${toNumber(m.monthlyRent)}/mo` : "POA"})`)
      .join(" | ");
  }

  const res = await runAi({
    companyId: input.companyId,
    type: "LEAD_NEXT_ACTION",
    entity: { type: "LEAD", id: input.leadId },
    system: SYSTEM,
    prompt: "Assess this lead and return the JSON action plan.",
    inputs,
    maxTokens: 600,
    cacheTtlMs: 20 * 60_000,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  const plan = validatePlan(tolerantJsonParse(res.content) as Record<string, unknown> | null);
  if (!plan) return { ok: false, reason: "AI returned an unreadable plan — try again." };
  return { ok: true, plan, fromCache: res.fromCache };
}

function validatePlan(o: Record<string, unknown> | null): LeadSalesPlan | null {
  if (!o || typeof o !== "object") return null;
  if (typeof o.conversionProbability !== "number" || !Number.isFinite(o.conversionProbability)) return null;
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 160)).slice(0, 5) : [];
  return {
    conversionProbability: Math.max(0, Math.min(100, Math.round(o.conversionProbability))),
    urgency: typeof o.urgency === "string" && VALID.has(o.urgency) ? (o.urgency as LeadSalesPlan["urgency"]) : "MEDIUM",
    risk: typeof o.risk === "string" && VALID.has(o.risk) ? (o.risk as LeadSalesPlan["risk"]) : "MEDIUM",
    reasons: arr(o.reasons),
    nextActions: arr(o.nextActions),
    suggestedMessage: typeof o.suggestedMessage === "string" ? o.suggestedMessage.slice(0, 600) : "",
  };
}
