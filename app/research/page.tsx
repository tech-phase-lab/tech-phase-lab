import type { Metadata } from "next";
import ResearchDashboard from "./research-dashboard";
import { events } from "@/lib/research/data";
import { evidenceIssues } from "@/lib/research/quality";

export const metadata: Metadata = {
  title: "Tech Phase Research | Research preview",
  description: "Source-linked company research. Historical review examples, not a live news service.",
  robots: { index: false, follow: false },
};

export default function ResearchPage() {
  for (const event of events) {
    const issues = evidenceIssues({ ...event, metrics: [...event.metrics, ...(event.previous ?? [])] });
    if (issues.length) throw new Error(`Invalid research record ${event.id}: ${issues.join(", ")}`);
  }
  return <ResearchDashboard events={events} />;
}
