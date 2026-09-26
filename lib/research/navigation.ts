export type ResearchView = "home" | "changes" | "metrics" | "saved";

export const researchViewHashes: Record<ResearchView, string> = {
  home: "#research-main",
  changes: "#what-changed",
  metrics: "#metrics",
  saved: "#saved",
};

// Section anchors retain the current view; only view anchors change its content.
export function researchViewFromHash(hash: string): ResearchView | null {
  if (!hash || hash === "#research-main") return "home";
  if (hash === "#what-changed") return "changes";
  if (hash === "#metrics") return "metrics";
  if (hash === "#saved") return "saved";
  return null;
}
