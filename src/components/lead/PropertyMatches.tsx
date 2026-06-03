import Link from "next/link";
import type { PropertyMatch } from "@/lib/lead-matching";
import { compactMoney, humanize } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { attachPropertyToLead } from "@/app/(app)/leads/actions";

/**
 * Suggestion list for the lead detail page. Each row shows:
 *   - the property reference + title
 *   - chips explaining why it matched ("In DHA Phase 5", "Within budget")
 *   - the match strength
 *   - an "Attach" button that links the property to the lead in one click
 */
export function PropertyMatches({
  leadId,
  matches,
}: {
  leadId: string;
  matches: PropertyMatch[];
}) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted">
        No matches yet — capture budget, type and preferred area to get suggestions.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {matches.map((m) => {
        const price = m.salePrice || m.monthlyRent;
        return (
          <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link
                href={`/properties/${m.id}`}
                className="text-sm font-medium text-ink hover:text-accent"
              >
                {m.title}
              </Link>
              <p className="text-xs text-muted" data-keep-latin>
                {m.reference}
                {m.area ? ` · ${m.area}` : ""}
                {" · "}
                {humanize(m.type)}
                {price > 0 ? ` · ${compactMoney(price)}${m.monthlyRent ? "/mo" : ""}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.reasons.map((r) => (
                  <Badge key={r} tone="neutral">{r}</Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-xs font-semibold text-accent" title="Match strength">
                {m.score}%
              </span>
              <form action={attachPropertyToLead}>
                <input type="hidden" name="leadId" value={leadId} />
                <input type="hidden" name="propertyId" value={m.id} />
                <button className="btn-ghost px-2 py-1 text-xs">Attach</button>
              </form>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
