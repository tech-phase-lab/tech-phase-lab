import type { NextConfig } from "next";

// Files that never change under the same name (the fonts carry a content hash) are kept by the browser for a year;
// images and icons for a week, and re-checked quietly in the background for a month after that.
const keepForever = "public, max-age=31536000, immutable";
const keepAWeek = "public, max-age=604800, stale-while-revalidate=2592000";
const cached = [
  ["/fonts/:path*", keepForever],
  ["/brand/:path*", keepAWeek],
  ["/intro/screens/:path*", keepAWeek],
  ["/rizel-avatar.webp", keepAWeek],
  ["/apple-touch-icon.png", keepAWeek],
  ["/tech-phase-192.png", keepAWeek],
  ["/tech-phase-512.png", keepAWeek],
  ["/tech-phase-512-maskable.png", keepAWeek],
  ["/favicon.ico", keepAWeek],
].map(([source, value]) => ({ source, headers: [{ key: "Cache-Control", value }] }));

const nextConfig: NextConfig = {
  async headers() {
    return [...cached, ...["/research/account/:path*", "/resolute/checkout/:path*", "/api/research/member/:path*", "/api/research/billing/:path*", "/api/resolute/payments/:path*", "/api/resolute/live-payments/:path*"].map(source => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }))];
  },
};

export default nextConfig;
