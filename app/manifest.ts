import type { MetadataRoute } from "next";
/** Home-screen app (Add to Home Screen): the Tech Phase mark on the site's dark navy, opened without the address bar. */
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Tech Phase", short_name: "Tech Phase", id: "/research",
    start_url: "/research", scope: "/research", display: "standalone",
    icons: [
      { src: "/tech-phase-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/tech-phase-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Extra margin so the mark survives the round or squircle masks some phones apply.
      { src: "/tech-phase-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    background_color: "#0b1220", theme_color: "#0b1220" };
}
