import { loadLiveHomeNews } from "@/lib/research/live-result-events";
import type { Metadata } from "next";
import { publicEvent } from "@/lib/research/access";
import { newsStartupScript } from "@/lib/research/news-startup";
import { Suspense } from "react";
import HomeDashboard, { LiveHomeUpdate } from "./home-dashboard";
import { events } from "@/lib/research/content-server";
import { evidenceIssues } from "@/lib/research/quality";
import { buildCompanyProfiles } from "@/lib/research/companies";
import { providers, sectorNames, sectorNamesEn } from "@/lib/research/intake";
import { companyWatches } from "@/lib/research/company-watch";
import { deduplicateResearchEvents } from "@/lib/research/deduplicate-events";

export const metadata: Metadata = {
  title: "Tech Phase Research | Research preview",
  description: "Source-linked company research. Historical review examples, not a live news service.",
  robots: { index: false, follow: false },
};

async function LiveHomeData() {
  const live = await loadLiveHomeNews();
  const currentEvents = deduplicateResearchEvents(live.events);
  for (const event of currentEvents) {
    const issues = evidenceIssues({ ...event, metrics: [...event.metrics, ...(event.previous ?? [])] });
    if (issues.length) throw new Error(`Invalid research record ${event.id}: ${issues.join(", ")}`);
  }
  return <LiveHomeUpdate events={currentEvents.map(publicEvent)} news={live.news} />;
}

export default function ResearchPage() {
  const verifiedTickers = new Set([
    ...buildCompanyProfiles(events).map((profile) => profile.ticker),
    ...companyWatches.map((item) => item.ticker),
  ]);
  const monitoredCompanies = providers.map((provider) => ({
    ticker: provider.ticker,
    name: provider.name,
    sector: { ja: sectorNames[provider.sector], en: sectorNamesEn[provider.sector] },
    verified: verifiedTickers.has(provider.ticker),
  }));
  return <><script dangerouslySetInnerHTML={{ __html: newsStartupScript }} /><HomeDashboard
    events={events.map(publicEvent).toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.id.localeCompare(b.id))}
    monitoredCompanies={monitoredCompanies}
  ><Suspense fallback={null}><LiveHomeData /></Suspense></HomeDashboard></>;
}
