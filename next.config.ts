import type { NextConfig } from "next";
import { siteSecurityHeaders } from "./lib/security-headers.ts";

// Files that never change under the same name (the fonts carry a content hash) are kept by the browser for a year;
// images and icons for a week, and re-checked quietly in the background for a month after that.
const keepForever = "public, max-age=31536000, immutable";
const keepAWeek = "public, max-age=604800, stale-while-revalidate=2592000";
const cached = [
  ["/fonts/:path*", keepForever],
  ["/brand/:path*", keepAWeek],
  ["/intro/screens/:path*", keepAWeek],
  ["/rizel-avatar.webp", keepAWeek],
  ["/capital-map/:path*", keepAWeek],
  ["/apple-touch-icon.png", keepAWeek],
  ["/tech-phase-192.png", keepAWeek],
  ["/tech-phase-512.png", keepAWeek],
  ["/tech-phase-512-maskable.png", keepAWeek],
  ["/favicon.ico", keepAWeek],
  ["/start/logo.png", keepAWeek],
  ["/start/rizel.png", keepAWeek],
].map(([source, value]) => ({ source, headers: [{ key: "Cache-Control", value }] }));

const nextConfig: NextConfig = {
  // The sign-in-free start page for the LINE broadcast (owner, Nov 9): a single static file, opened at /start (Next.js also sends /start/ to it).
  async rewrites() {
    return { beforeFiles: [{ source: "/start", destination: "/start/index.html" }], afterFiles: [], fallback: [] };
  },
  // The 特商法 notice moved next to /terms and /privacy (Nov 19); old links (LPs, emails, payment settings) keep working, with ?lang= carried over.
  async redirects() {
    // 割安判別ツール became トレジャーハント (owner, Nov 22): the old address opens the new page. The API and monitor keep their value-check names.
    return [
      { source: "/resolute/legal/commerce", destination: "/commerce", permanent: false },
      { source: "/research/value-check", destination: "/research/treasure-hunt", permanent: false },
    ];
  },
  async headers() {
    // The notification worker is never kept by a cache: a phone checking for a new version must get the current file (owner, Nov 16).
    const worker = { source: "/research-sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] };
    // Every path gets the site-wide security headers first; the stricter account/billing rules below override them (no-referrer).
    const site = { source: "/:path*", headers: siteSecurityHeaders() };
    return [site, ...cached, worker, ...["/research/account/:path*", "/resolute/checkout/:path*", "/api/research/member/:path*", "/api/research/billing/:path*", "/api/resolute/payments/:path*", "/api/resolute/live-payments/:path*"].map(source => ({
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
