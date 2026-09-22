import type { Metadata } from "next";
import ResearchDashboard from "./research-dashboard";
import { events } from "@/lib/research/data";
import { evidenceIssues } from "@/lib/research/quality";
import { buildCompanyProfiles } from "@/lib/research/companies";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import { verifiedChanges } from "@/lib/research/verified-changes";

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
  const verifiedTickers = new Set([
    ...buildCompanyProfiles(events).map((profile) => profile.ticker),
    ...verifiedChanges.map((item) => item.ticker),
  ]);
  const monitoredCompanies = providers.map((provider) => ({
    ticker: provider.ticker,
    name: provider.name,
    sector: { ja: sectorNames[provider.sector], en: sectorNamesEn[provider.sector] },
    verified: verifiedTickers.has(provider.ticker),
  }));
  return <ResearchDashboard
    events={events.toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id))}
    monitoredCompanies={monitoredCompanies}
  />;
}
