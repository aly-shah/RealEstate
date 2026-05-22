import { cookies } from "next/headers";
import { DICT, type Dict, type Locale } from "./dictionary";

export const LOCALE_COOKIE = "pz-locale";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return v === "ur" ? "ur" : "en";
}

export async function getDict(): Promise<{ locale: Locale; dict: Dict }> {
  const locale = await getLocale();
  return { locale, dict: DICT[locale] as Dict };
}
