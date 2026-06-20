import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys is a Node-only WhatsApp library with dynamic requires + optional
  // native deps — keep it out of the bundler so it loads from node_modules at
  // runtime (server only).
  serverExternalPackages: ["@whiskeysockets/baileys"],
  // The service worker must never be cached by the browser/CDN, or clients get
  // stuck on a stale SW and miss updates.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
