import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys is a Node-only WhatsApp library with dynamic requires + optional
  // native deps — keep it out of the bundler so it loads from node_modules at
  // runtime (server only).
  serverExternalPackages: ["@whiskeysockets/baileys"],
};

export default nextConfig;
