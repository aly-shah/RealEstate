"use client";

import { useActionState } from "react";
import { Brand } from "@/components/ui/Brand";
import { loginAction, type LoginState } from "./actions";

const DEMO_ACCOUNTS = [
  { role: "Owner", email: "owner@skyline.test" },
  { role: "Admin", email: "admin@skyline.test" },
  { role: "Agent", email: "agent@skyline.test" },
  { role: "Dealer", email: "dealer@skyline.test" },
  { role: "Super Admin", email: "super@scalamatic.test" },
];

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <Brand variant="dark" />
        <div className="max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">
            Real Estate CRM / ERP
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            One home for properties, people, deals and money.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/55">
            Run listings, leads, agents, dealers, commissions, payments and
            reporting — built for the office and the field.
          </p>
        </div>
        <p className="text-xs text-white/35">
          © {new Date().getFullYear()} promptzer · Real Estate CRM &amp; ERP
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-muted">
            Welcome back. Enter your credentials to continue.
          </p>

          <form action={action} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className="field" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="field" placeholder="••••••••" />
            </div>

            {state.error && (
              <p className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}

            <button type="submit" disabled={pending} className="btn-primary w-full">
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8 rounded-lg border border-line bg-white p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Demo accounts · password <code className="text-accent-soft">password</code>
            </p>
            <ul className="space-y-1 text-sm">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex justify-between gap-2">
                  <span className="text-slate">{a.role}</span>
                  <code className="text-xs text-muted">{a.email}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
