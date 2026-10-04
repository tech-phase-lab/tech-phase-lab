export type ResearchView = "home" | "changes" | "metrics" | "saved" | "companies" | "pro";

export const researchViewHashes: Record<ResearchView, string> = {
  home: "#research-main",
  changes: "#what-changed",
  metrics: "#metrics",
  saved: "#saved",
  companies: "#monitored-companies",
  pro: "#tech-phase-pro",
};

// Every menu destination restores its own view on reload and history navigation.
export function researchViewFromHash(hash: string): ResearchView | null {
  if (!hash || hash === "#research-main") return "home";
  if (hash === "#what-changed" || /^#what-changed\/[a-z0-9-]+$/.test(hash)) return "changes";
  if (hash === "#metrics") return "metrics";
  if (hash === "#saved") return "saved";
  if (hash === "#monitored-companies") return "companies";
  if (hash === "#tech-phase-pro") return "pro";
  return null;
}
