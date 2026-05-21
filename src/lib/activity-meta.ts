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
  "property.created":       { icon: "⌂", tone: "accent" },
  "property.status":        { icon: "↻", tone: "warn" },
  "property.media_added":   { icon: "▤", tone: "accent" },
  "lead.created":           { icon: "+", tone: "accent" },
  "lead.stage":             { icon: "→", tone: "warn" },
  "lead.assign":            { icon: "♟", tone: "accent" },
  "deal.created":           { icon: "⇄", tone: "accent" },
  "deal.status":            { icon: "⇄", tone: "warn" },
  "commission.generated":   { icon: "%", tone: "gold" },
  "commission.approved":    { icon: "✓", tone: "ok" },
  "commission.share_paid":  { icon: "₨", tone: "ok" },
  "payment.recorded":       { icon: "₨", tone: "accent" },
  "payment.paid":           { icon: "✓", tone: "ok" },
  "document.uploaded":      { icon: "▤", tone: "accent" },
  "showing.recorded":       { icon: "⚑", tone: "accent" },
  "agent.remark":           { icon: "✎", tone: "neutral" },
  "dealer.created":         { icon: "⌗", tone: "accent" },
  "user.created":           { icon: "+", tone: "accent" },
  "commission_rule.updated":{ icon: "⚙", tone: "warn" },
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
