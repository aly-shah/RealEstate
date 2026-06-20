import type { MetadataRoute } from "next";

/**
 * PWA web app manifest. Makes Proptimizr installable to an agent's home screen
 * (Add to Home Screen on iOS, install prompt on Android/Chrome) so the daily
 * field workflow — leads, visits, WhatsApp — opens like a native app.
 *
 * `start_url` points at the agent dashboard; `display: standalone` drops the
 * browser chrome. Icons live in /public (see scripts that generate them).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Proptimizr — Real Estate CRM",
    short_name: "Proptimizr",
    description:
      "AI-powered sales operating system for real-estate agencies: leads, visits, WhatsApp and deals — on the go.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7fb",
    theme_color: "#4f46e5",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Leads", short_name: "Leads", url: "/leads" },
      { name: "Visits", short_name: "Visits", url: "/visits" },
      { name: "WhatsApp", short_name: "WhatsApp", url: "/whatsapp" },
    ],
  };
}
