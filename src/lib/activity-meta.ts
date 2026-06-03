/**
 * Visual metadata for activity-log entries: an icon + a colour tone for each
 * known action. Keeps the activity page consistent and lets new actions fall
 * back to a neutral default.
 */
export type ActionTone = "neutral" | "ok" | "warn" | "danger" | "accent" | "gold";

interface ActionMeta {
  icon: string;
  tone: ActionTone;
}

const MAP: Record<string, ActionMeta> = {
  "property.created":         { icon: "⌂", tone: "accent" },
  "property.status":          { icon: "↻", tone: "warn" },
  "property.media_added":     { icon: "▤", tone: "accent" },
  "property.agent_added":     { icon: "+", tone: "accent" },
  "property.agent_removed":   { icon: "−", tone: "warn" },
  "lead.created":             { icon: "+", tone: "accent" },
  "lead.stage":               { icon: "→", tone: "warn" },
  "lead.assign":              { icon: "♟", tone: "accent" },
  "lead.followup_scheduled":  { icon: "⏰", tone: "accent" },
  "lead.score_override":      { icon: "★", tone: "gold" },
  "lead.attach_property":     { icon: "⌂", tone: "accent" },
  "lead.imported":            { icon: "↥", tone: "accent" },
  "deal.created":             { icon: "⇄", tone: "accent" },
  "deal.status":              { icon: "⇄", tone: "warn" },
  "deal.lost":                { icon: "✕", tone: "danger" },
  "commission.generated":     { icon: "%", tone: "gold" },
  "commission.approved":      { icon: "✓", tone: "ok" },
  "commission.rejected":      { icon: "✕", tone: "danger" },
  "commission.share_paid":    { icon: "₨", tone: "ok" },
  "invoice.created":          { icon: "▤", tone: "accent" },
  "invoice.status":           { icon: "↻", tone: "warn" },
  "invoice.cancelled":        { icon: "✕", tone: "danger" },
  "payment.recorded":         { icon: "₨", tone: "accent" },
  "payment.paid":             { icon: "✓", tone: "ok" },
  "document.uploaded":        { icon: "▤", tone: "accent" },
  "showing.recorded":         { icon: "⚑", tone: "accent" },
  "agent.remark":             { icon: "✎", tone: "neutral" },
  "dealer.created":           { icon: "⌗", tone: "accent" },
  "user.created":             { icon: "+", tone: "accent" },
  "user.suspended":           { icon: "⊘", tone: "danger" },
  "user.reactivated":         { icon: "✓", tone: "ok" },
  "commission_rule.updated":  { icon: "⚙", tone: "warn" },
  "company.trial_expired":    { icon: "⏰", tone: "danger" },
  "whatsapp.inbound":         { icon: "✉", tone: "accent" },
};

export function actionMeta(action: string): ActionMeta {
  return MAP[action] ?? { icon: "•", tone: "neutral" };
}

const DOT_BG: Record<ActionTone, string> = {
  neutral: "bg-line text-slate",
  ok:      "bg-ok-bg text-ok",
  warn:    "bg-warn-bg text-warn",
  danger:  "bg-danger-bg text-danger",
  accent:  "bg-accent-wash text-accent",
  gold:    "bg-gold-wash text-[color:var(--color-gold)]",
};

export function dotClass(tone: ActionTone): string {
  return DOT_BG[tone];
}
