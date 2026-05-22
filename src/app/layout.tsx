import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Simpler sans-serif Urdu/Arabic face — easier to read at UI sizes than
 * Nastaliq calligraphy and pairs cleanly with Inter for mixed content.
 */
const urdu = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-urdu",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "promptzer — Real Estate CRM / ERP",
  description:
    "Enterprise back-office for real estate agencies: properties, leads, agents, dealers, deals, commissions, payments and reporting.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dir = locale === "ur" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      data-locale={locale}
      className={`${inter.variable} ${urdu.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
