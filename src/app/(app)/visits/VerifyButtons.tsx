"use client";

import { verifyShowing } from "./actions";

export function VerifyButtons({ id }: { id: string }) {
  return (
    <div className="flex gap-1">
      <form action={verifyShowing}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="VERIFIED" />
        <button type="submit" className="btn-ghost px-2 py-1 text-xs">✓ Verify</button>
      </form>
      <form action={verifyShowing}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="FLAGGED" />
        <button type="submit" className="btn-ghost px-2 py-1 text-xs">⚐ Flag</button>
      </form>
    </div>
  );
}
