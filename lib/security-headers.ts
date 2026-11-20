// Site-wide security headers (owner request, Nov 19). The Content-Security-Policy is sent as Report-Only first:
// violations are reported to /api/csp-report and show in the Vercel logs, nothing is blocked. After 1–2 weeks without
// unexpected reports, rename the header key to "Content-Security-Policy" (see CSP_HEADER_KEY) to enforce it.
//
// A nonce policy (Next.js guide) would force every page to render per request (no static pages, no CDN cache), so this
// is an allow-list policy that keeps 'unsafe-inline' for scripts: Next.js and our boot scripts are inline. It still limits
// where scripts, connections and frames may come from, which is what protects the sign-in and payment pages.

export const CSP_HEADER_KEY = "Content-Security-Policy-Report-Only";
export const CSP_REPORT_PATH = "/api/csp-report";
const PRODUCTION_CLERK = "https://clerk.techphase.app";
const CLERK_PROTECT_SCRIPT = "https://cdn.protect.clerk.com";
const CLERK_PROTECT_PROBE = "https://*.client.protect.clerk.com:*";

/** The Clerk Frontend API host named by a publishable key (pk_live_/pk_test_ + base64("host$")); the key is public. */
export function clerkFrontendHost(publishableKey: string | undefined): string | null {
  const encoded = /^pk_(?:live|test)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? "")?.[1];
  if (!encoded) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host.toLowerCase()}` : null;
  } catch { return null; }
}

export function contentSecurityPolicy({ clerk = PRODUCTION_CLERK, preview = false }: { clerk?: string | null; preview?: boolean } = {}) {
  const clerkHosts = [...new Set([PRODUCTION_CLERK, clerk ?? PRODUCTION_CLERK])];
  // Preview deployments use a Clerk development instance (telemetry) and the Vercel toolbar.
  const previewScript = preview ? ["https://vercel.live"] : [];
  const previewConnect = preview ? ["https://clerk-telemetry.com", "https://vercel.live"] : [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    // Clerk's script, Clerk Protect (seen on production /research, Nov 19) and Cloudflare Turnstile (Clerk bot protection on sign-up).
    ["script-src", ["'self'", "'unsafe-inline'", ...clerkHosts, CLERK_PROTECT_SCRIPT, "https://challenges.cloudflare.com", ...previewScript]],
    // Inline style attributes are used throughout; /start loads Google Fonts.
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    // Notes / RIZEL'S DESK show owner-provided images from any HTTPS host; Clerk avatars; favicons.
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com"]],
    // Clerk and Clerk Protect's probes (several ports); the monitor's price-target stream (Railway); direct uploads of DESK audio and photos (Cloudflare R2).
    ["connect-src", ["'self'", ...clerkHosts, CLERK_PROTECT_PROBE, "https://*.up.railway.app", "https://*.r2.cloudflarestorage.com", ...previewConnect]],
    ["media-src", ["'self'", "blob:", "https:"]],
    ["frame-src", ["https://www.youtube-nocookie.com", "https://challenges.cloudflare.com", ...previewScript]],
    // The notification service worker, the PDF viewer worker and Clerk's blob worker.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Headers for every path. Stricter per-path rules listed after these (no-referrer) override them. */
export function siteSecurityHeaders(env: Record<string, string | undefined> = process.env) {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The DESK voice memo records from the microphone on our own pages only.
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
    { key: CSP_HEADER_KEY, value: contentSecurityPolicy({ clerk: clerkFrontendHost(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY), preview: env.VERCEL_ENV === "preview" }) },
  ];
}

const KEYWORDS = new Set(["inline", "eval", "self", "data", "blob", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "about", "filesystem", "mediastream"]);

/** Reduces a blocked URI to its host (or a CSP keyword). Paths, query strings and anything else are dropped. */
export function blockedHost(value: unknown): string {
  if (typeof value !== "string" || !value) return "none";
  const trimmed = value.trim().toLowerCase();
  if (KEYWORDS.has(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "ws:") return url.host.replace(/[^a-z0-9.:-]/g, "").slice(0, 100) || "unknown";
    const scheme = url.protocol.replace(/:$/, "");
    return /^[a-z][a-z0-9+.-]{0,20}$/.test(scheme) ? `${scheme}:` : "unknown";
  } catch {
    return "unknown";
  }
}

export function directiveName(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const name = value.trim().toLowerCase().split(/[\s;]+/)[0];
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown";
}

type Report = { directive: string; blocked: string };

/** A per-instance log budget: each (directive, blocked host) once per minute, at most `max` lines a minute. */
export function reportLimiter({ windowMs = 60_000, max = 30 } = {}) {
  let windowStart = 0;
  const seen = new Set<string>();
  return (key: string, now = Date.now()) => {
    if (now - windowStart >= windowMs) { windowStart = now; seen.clear(); }
    if (seen.has(key) || seen.size >= max) return false;
    seen.add(key);
    return true;
  };
}

/** Accepts the legacy report-uri body ({"csp-report": {...}}) and Reporting API batches ([{type, body}]). */
export function parseCspReports(body: unknown): Report[] {
  const items = Array.isArray(body) ? body.slice(0, 20).map(entry => (entry && typeof entry === "object" && (entry as { type?: unknown }).type === "csp-violation" ? (entry as { body?: unknown }).body : null))
    : [body && typeof body === "object" ? (body as Record<string, unknown>)["csp-report"] : null];
  return items.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const report = item as Record<string, unknown>;
    return [{
      directive: directiveName(report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"]),
      blocked: blockedHost(report["blocked-uri"] ?? report.blockedURL),
    }];
  });
}
