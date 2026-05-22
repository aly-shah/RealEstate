import type { Prisma } from "@prisma/client";
import type { Locale } from "@/lib/i18n/dictionary";

type Decimalish = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

const URDU_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** Convert ASCII digits to Urdu (Eastern-Arabic) digits when locale === "ur". */
export function localizeDigits(value: string | number, locale: Locale = "en"): string {
  const s = String(value);
  if (locale !== "ur") return s;
  return s.replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
}

const currencyEn = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

const groupedEn = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** Money formatter. PKR-prefixed in English, "روپے" prefix in Urdu. */
export function money(value: Decimalish, locale: Locale = "en"): string {
  const n = toNumber(value);
  if (locale === "ur") {
    return `${localizeDigits(groupedEn.format(n), "ur")} روپے`;
  }
  return currencyEn.format(n);
}

export function compactMoney(value: Decimalish, locale: Locale = "en"): string {
  const n = toNumber(value);
  const suffix = (() => {
    if (n >= 1_000_000) return { num: (n / 1_000_000).toFixed(2), unit: "M" } as const;
    if (n >= 1_000) return { num: (n / 1_000).toFixed(1), unit: "K" } as const;
    return null;
  })();

  if (!suffix) return money(n, locale);

  if (locale === "ur") {
    return `${localizeDigits(suffix.num, "ur")}${suffix.unit} روپے`;
  }
  return `PKR ${suffix.num}${suffix.unit}`;
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

/** Translate a status enum via the dictionary; falls back to humanize. */
export function localizedStatus(
  status: string,
  statusDict: Partial<Record<string, string>> | undefined,
): string {
  return statusDict?.[status] ?? humanize(status);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
