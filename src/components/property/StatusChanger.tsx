"use client";

import { humanize } from "@/lib/format";
import { updatePropertyStatus } from "@/app/(app)/properties/actions";

const STATUSES = ["AVAILABLE", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE", "PENDING_VERIFICATION"];

export function StatusChanger({ id, current }: { id: string; current: string }) {
  return (
    <form action={updatePropertyStatus} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={current} className="field max-w-[200px]">
        {STATUSES.map((s) => (
          <option key={s} value={s}>{humanize(s)}</option>
        ))}
      </select>
      <button type="submit" className="btn-ghost px-3 py-2 text-xs">Update</button>
    </form>
  );
}
