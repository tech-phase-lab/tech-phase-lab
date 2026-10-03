import { loadLiveHomeNews } from "@/lib/research/live-result-events";
import type { Metadata } from "next";
import { publicEvent } from "@/lib/research/access";
import ResearchDashboard from "./research-dashboard";
import { events } from "@/lib/research/content-server";
import { evidenceIssues } from "@/lib/research/quality";
import { buildCompanyProfiles } from "@/lib/research/companies";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import { verifiedChanges } from "@/lib/research/verified-changes";
import { deduplicateResearchEvents } from "@/lib/research/deduplicate-events";

export const metadata: Metadata = {
  title: "Tech Phase Research | Research preview",
  description: "Source-linked company research. Historical review examples, not a live news service.",
  robots: { index: false, follow: false },
};

export default async function ResearchPage() {
  const live = await loadLiveHomeNews();
  const currentEvents = deduplicateResearchEvents([...live.events, ...events]);
  for (const event of currentEvents) {
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
    events={currentEvents.map(publicEvent).toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id))}
    initialNews={live.news}
    monitoredCompanies={monitoredCompanies}
  />;
}
