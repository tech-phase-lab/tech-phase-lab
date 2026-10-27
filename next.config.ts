import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return ["/research/account/:path*", "/resolute/checkout/:path*", "/api/research/member/:path*", "/api/research/billing/:path*", "/api/resolute/payments/:path*", "/api/resolute/live-payments/:path*"].map(source => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }));
  },
};

export default nextConfig;
