import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.ts";
import { blockedHost, clerkFrontendHost, contentSecurityPolicy, parseCspReports, reportLimiter, siteSecurityHeaders } from "../lib/security-headers.ts";

const directive = (policy, name) => policy.split(";").map(part => part.trim()).find(part => part.split(" ")[0] === name)?.split(" ").slice(1) ?? null;

test("every path gets the site-wide security headers, and the CSP is report-only", async () => {
  const rules = await config.headers();
  const site = rules.find(rule => rule.source === "/:path*");
  assert.ok(site, "a rule for every path");
  const value = key => site.headers.find(h => h.key === key)?.value;
  assert.equal(value("X-Frame-Options"), "DENY");
  assert.equal(value("X-Content-Type-Options"), "nosniff");
  assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(value("Permissions-Policy"), "camera=(), geolocation=(), microphone=(self)");
  // Report-only until the owner switches it on; an enforcing CSP must not appear by accident.
  assert.equal(value("Content-Security-Policy"), undefined);
  const policy = value("Content-Security-Policy-Report-Only");
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "report-uri"), ["/api/csp-report"]);
  // The site-wide rule comes first so the stricter account and billing rules (no-referrer) win.
  assert.equal(rules.indexOf(site), 0);
  for (const source of ["/research/account/:path*", "/resolute/checkout/:path*", "/api/research/billing/:path*", "/api/resolute/payments/:path*"]) {
    const rule = rules.find(r => r.source === source);
    assert.equal(rule.headers.find(h => h.key === "Referrer-Policy")?.value, "no-referrer", source);
    assert.ok(rules.indexOf(rule) > rules.indexOf(site), source);
  }
});

test("the policy allows what sign-in, the DESK, YouTube and the price stream need, and nothing is embeddable", () => {
  const policy = contentSecurityPolicy();
  assert.ok(directive(policy, "script-src").includes("https://clerk.techphase.app"));
  assert.ok(directive(policy, "script-src").includes("https://challenges.cloudflare.com"));
  // Clerk Protect, loaded by Clerk on production /research.
  assert.ok(directive(policy, "script-src").includes("https://cdn.protect.clerk.com"));
  assert.ok(directive(policy, "connect-src").includes("https://*.client.protect.clerk.com:*"));
  assert.ok(directive(policy, "connect-src").includes("https://clerk.techphase.app"));
  assert.ok(directive(policy, "connect-src").includes("https://*.up.railway.app"));
  assert.ok(directive(policy, "connect-src").includes("https://*.r2.cloudflarestorage.com"));
  assert.deepEqual(directive(policy, "frame-src"), ["https://www.youtube-nocookie.com", "https://challenges.cloudflare.com"]);
  assert.ok(directive(policy, "img-src").includes("https:"));
  assert.ok(directive(policy, "worker-src").includes("'self'"));
  // No wildcard script host and no eval in production.
  assert.equal(directive(policy, "script-src").some(source => source.includes("*") || source === "'unsafe-eval'" || source === "https:"), false);
  assert.equal(policy.includes("vercel.live"), false);
  assert.ok(contentSecurityPolicy({ preview: true }).includes("https://vercel.live"));
});

test("a preview Clerk instance is added from its publishable key; production keeps clerk.techphase.app", () => {
  const key = host => `pk_test_${Buffer.from(`${host}$`).toString("base64")}`;
  assert.equal(clerkFrontendHost(key("example-1.clerk.accounts.dev")), "https://example-1.clerk.accounts.dev");
  assert.equal(clerkFrontendHost(undefined), null);
  assert.equal(clerkFrontendHost("nonsense"), null);
  const preview = siteSecurityHeaders({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key("example-1.clerk.accounts.dev"), VERCEL_ENV: "preview" }).find(h => h.key === "Content-Security-Policy-Report-Only").value;
  assert.ok(directive(preview, "script-src").includes("https://example-1.clerk.accounts.dev"));
  assert.ok(directive(preview, "script-src").includes("https://clerk.techphase.app"));
});

test("CSP reports are reduced to the directive and the blocked host; paths, queries and user data never reach the log", () => {
  assert.equal(blockedHost("https://evil.example.com/steal?card=4111111111111111#x"), "evil.example.com");
  assert.equal(blockedHost("inline"), "inline");
  assert.equal(blockedHost("data:image/png;base64,AAAA"), "data:");
  assert.equal(blockedHost("javascript:alert(1)"), "javascript:");
  assert.equal(blockedHost(42), "none");
  const legacy = parseCspReports({ "csp-report": { "document-uri": "https://techphase.app/research/account?email=a@b.c", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example.com/x.js?u=1" } });
  assert.deepEqual(legacy, [{ directive: "script-src-elem", blocked: "evil.example.com" }]);
  const batch = parseCspReports([{ type: "csp-violation", body: { documentURL: "https://techphase.app/x?y", effectiveDirective: "connect-src", blockedURL: "wss://socket.example.org:443/a" } }, { type: "deprecation", body: {} }]);
  assert.deepEqual(batch, [{ directive: "connect-src", blocked: "socket.example.org" }]);
  assert.deepEqual(parseCspReports({ "csp-report": { "effective-directive": "script-src; drop table", "blocked-uri": "eval" } }), [{ directive: "script-src", blocked: "eval" }]);
  assert.deepEqual(parseCspReports({ "csp-report": { "effective-directive": "<b>", "blocked-uri": "eval" } }), [{ directive: "unknown", blocked: "eval" }]);
  assert.deepEqual(parseCspReports("nonsense"), []);
});

test("the report log is rate limited per instance", () => {
  const allow = reportLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(allow("script-src a", 1), true);
  assert.equal(allow("script-src a", 2), false, "the same pair is logged once a minute");
  assert.equal(allow("script-src b", 3), true);
  assert.equal(allow("script-src c", 4), true);
  assert.equal(allow("script-src d", 5), false, "at most three lines a minute");
  assert.equal(allow("script-src d", 60_002), true, "the budget resets the next minute");
});
