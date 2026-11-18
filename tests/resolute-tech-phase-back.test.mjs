import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECH_PHASE_HOME, cameFromTechPhase, entersResolute } from "../lib/resolute/tech-phase-back.ts";

const origin = "https://techphase.app";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the way back is shown only to a visitor who came from Tech Phase", () => {
  // Marked by a Tech Phase link into RESOLUTE (this tab).
  assert.equal(cameFromTechPhase("1", "", origin), true);
  assert.equal(cameFromTechPhase("1", "https://ads.example.com/x", origin), true);
  // Opened from a Tech Phase page (same site).
  assert.equal(cameFromTechPhase(null, "https://techphase.app/research", origin), true);
  assert.equal(cameFromTechPhase(null, "https://techphase.app/research/companies/NVDA?x=1#a", origin), true);
  // Ads, direct links, other sites, RESOLUTE's own pages: hidden.
  assert.equal(cameFromTechPhase(null, "", origin), false);
  assert.equal(cameFromTechPhase(null, "https://www.instagram.com/", origin), false);
  assert.equal(cameFromTechPhase(null, "https://techphase.app.evil.example/research", origin), false);
  assert.equal(cameFromTechPhase(null, "https://techphase.app/resolute/lp", origin), false);
  assert.equal(cameFromTechPhase(null, "https://techphase.app/resolute/checkout", origin), false);
  assert.equal(cameFromTechPhase(null, "https://techphase.app/", origin), false);
  assert.equal(cameFromTechPhase(null, "https://techphase.app/researcher", origin), false);
  assert.equal(cameFromTechPhase(null, "not a url", origin), false);
  assert.equal(cameFromTechPhase("0", "", origin), false);
});

test("Tech Phase marks only its links into RESOLUTE", () => {
  for (const href of ["/resolute", "/resolute?lang=en", "/resolute/lp", "https://techphase.app/resolute/settings"]) assert.equal(entersResolute(href, origin), true, href);
  for (const href of ["/research", "/research/account", "/resoluteness", "https://other.example/resolute", "#top"]) assert.equal(entersResolute(href, origin), false, href);
});

test("both landing pages carry the faint link, and every Tech Phase page marks the way in", () => {
  assert.equal(TECH_PHASE_HOME, "/research");
  assert.match(read("../app/resolute/lp/landing.tsx"), /<TechPhaseBack en=\{false\} \/>/);
  assert.match(read("../app/resolute/lp/landing-en.tsx"), /<TechPhaseBack en=\{true\} \/>/);
  assert.match(read("../app/research/layout.tsx"), /<ResoluteEntryMark \/>/);
  const back = read("../app/resolute/lp/tech-phase-back.tsx");
  assert.match(back, />Tech Phase\n/);
  assert.match(back, /useSyncExternalStore\(subscribe, visible, \(\) => false\)/, "never rendered on the server, so ad visitors never see it");
  const css = read("../app/resolute/lp/lp.module.css");
  const rule = css.match(/\.tpBack \{([^}]*)\}/)[1];
  assert.match(rule, /position:absolute/);
  assert.match(rule, /safe-area-inset-top/);
  assert.match(rule, /opacity:\.45/);
});
