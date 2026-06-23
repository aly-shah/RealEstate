"use client";

import { useTransition } from "react";
import { deletePaymentPlan } from "./actions";

export function DeletePlanButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => { if (window.confirm("Delete this payment plan?")) start(() => { deletePaymentPlan(id); }); }}
      className="btn-ghost text-xs text-danger"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
