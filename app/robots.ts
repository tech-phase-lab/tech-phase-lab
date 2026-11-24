import type { MetadataRoute } from "next";

/**
 * robots.txt (production QA, Nov 24). Indexing is decided page by page with `robots: { index: false }` (most research pages, the home
 * page and the legal pages are noindex on purpose before launch). Crawlers must be able to open those pages to see their noindex, so
 * robots.txt does not block them; it only keeps crawlers off the APIs and the owner-only operator pages (404 for everyone else).
 * No sitemap: the home page and most pages are deliberately noindex, so a sitemap would list pages that are not meant to be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/research/review", "/research/editorial", "/research/questions", "/research/intake"],
    },
  };
}
