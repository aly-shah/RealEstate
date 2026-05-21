import type { Prisma } from "@prisma/client";

type Decimalish = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

const currency = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/** Money formatter. Compacts large figures (e.g. PKR 1.2Cr-style via M/K). */
export function money(value: Decimalish): string {
  return currency.format(toNumber(value));
}

export function compactMoney(value: Decimalish): string {
  const n = toNumber(value);
  if (n >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `PKR ${(n / 1_000).toFixed(1)}K`;
  return money(n);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(new Date(value));
}

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(new Date(value));
}

/** Turn an enum-ish constant into a Title Case label. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
