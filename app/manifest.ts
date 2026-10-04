import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Tech Phase Research", short_name: "Tech Phase", id: "/research",
    start_url: "/research", scope: "/research", display: "standalone",
    icons: [192, 512].map(size => ({ src: `/tech-phase-${size}.png`, sizes: `${size}x${size}`, type: "image/png" })),
    background_color: "#0b1220", theme_color: "#0b1220" };
}
