import { setLeadScoreOverride } from "@/app/(app)/leads/actions";

/**
 * Admin-only chip group that pins a lead's band. NULL submission clears the
 * override (auto-computed score returns). Renders as a vanilla form so it
 * works without client JS — the existing pattern across the codebase.
 */
export function ScoreOverrideControl({
  leadId,
  current,
}: {
  leadId: string;
  current: "HOT" | "WARM" | "COLD" | null;
}) {
  const options: Array<{ value: "HOT" | "WARM" | "COLD" | ""; label: string }> = [
    { value: "",     label: "Auto" },
    { value: "HOT",  label: "Hot" },
    { value: "WARM", label: "Warm" },
    { value: "COLD", label: "Cold" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isActive = (current ?? "") === o.value;
        return (
          <form key={o.value} action={setLeadScoreOverride}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="override" value={o.value} />
            <button
              type="submit"
              className={`chip transition ${
                isActive
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-white text-slate hover:border-accent/40 hover:text-accent"
              }`}
            >
              {o.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
