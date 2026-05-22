"use client";

import { useActionState, useState } from "react";
import { Brand } from "@/components/ui/Brand";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Dict } from "@/lib/i18n/dictionary";
import { loginAction, type LoginState } from "./actions";

interface DemoAccount {
  role: string;
  email: string;
  hintKey: "owner" | "admin" | "agent" | "dealer" | "super";
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: "Owner",       email: "owner@skyline.test",    hintKey: "owner"  },
  { role: "Admin",       email: "admin@skyline.test",    hintKey: "admin"  },
  { role: "Agent",       email: "agent@skyline.test",    hintKey: "agent"  },
  { role: "Dealer",      email: "dealer@skyline.test",   hintKey: "dealer" },
  { role: "Super Admin", email: "super@scalamatic.test", hintKey: "super"  },
];

export function LoginForm({ dict }: { dict: Dict }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "var(--gradient-brand)" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-ink/25" aria-hidden />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(700px 380px at 8% 12%, rgba(255,255,255,0.10), transparent 60%), radial-gradient(800px 380px at 110% 100%, rgba(2,132,199,0.45), transparent 60%)",
          }}
          aria-hidden
        />
        <svg className="absolute inset-0 h-full w-full opacity-[0.12]" aria-hidden>
          <defs>
            <pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>

        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Brand variant="dark" size="lg" />

          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85 backdrop-blur">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
              {dict.login.tagline}
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
              {dict.login.heroTitle}
            </h1>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-white/75">
              {dict.login.heroSubtitle}
            </p>

            <ul className="mt-8 grid grid-cols-2 gap-3 text-sm">
              {([
                ["dashboard", dict.login.feat.dashboards],
                ["flag",      dict.login.feat.field],
                ["percent",   dict.login.feat.commission],
                ["document",  dict.login.feat.docs],
              ] as Array<[IconName, string]>).map(([icon, label]) => (
                <li key={label} className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 backdrop-blur">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15">
                    <Icon name={icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-white/90">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/55">
            © {new Date().getFullYear()} promptzer · {dict.login.copyright}
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Brand size="lg" />
          </div>

          <h2 className="text-3xl font-semibold tracking-tight text-ink">{dict.login.welcomeBack}</h2>
          <p className="mt-1.5 text-sm text-muted">{dict.login.subtitle}</p>

          <form action={action} className="mt-8 space-y-4">
            <div>
              <label className="label" htmlFor="email">{dict.login.email}</label>
              <input
                id="email" name="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="field" placeholder="you@company.com"
                dir="ltr"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label className="label !mb-0" htmlFor="password">{dict.login.password}</label>
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="text-xs font-medium text-accent hover:text-accent-soft"
                >
                  {showPw ? dict.login.hide : dict.login.show}
                </button>
              </div>
              <input
                id="password" name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="field" placeholder="••••••••"
                dir="ltr"
              />
            </div>

            {state.error && (
              <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}

            <button type="submit" disabled={pending} className="btn-primary w-full py-2.5 text-base">
              {pending ? dict.login.signingIn : dict.login.signIn}
            </button>
          </form>

          <div className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                {dict.login.demoAccounts}
              </p>
              <span className="kbd">password</span>
            </div>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => { setEmail(a.email); setPassword("password"); }}
                    className="group flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start transition hover:bg-accent-wash"
                  >
                    <span>
                      <span className="block text-sm font-medium text-ink">{a.role}</span>
                      <span className="block text-xs text-muted" data-keep-latin>{a.email}</span>
                    </span>
                    <code className="rounded-md bg-subtle px-2 py-0.5 text-[11px] text-slate group-hover:bg-white" dir="ltr">
                      {a.email}
                    </code>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
