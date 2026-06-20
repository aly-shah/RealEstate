import type { Metadata, Viewport } from "next";
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
  title: "Proptimizr — Real Estate CRM / ERP",
  description:
    "Proptimizr is the back-office for Pakistani real estate agencies: properties, leads, agents, dealers, deals, commissions, payments and reporting.",
  applicationName: "Proptimizr",
  // Installable PWA: home-screen launch behaves like a native app on iOS.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Proptimizr" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  // Let the standalone web app fill the iPhone notch/home-indicator area.
  viewportFit: "cover",
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
