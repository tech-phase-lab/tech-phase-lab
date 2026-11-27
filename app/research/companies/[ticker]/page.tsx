import "server-only";
import { requireProPage } from "@/lib/membership/pro-page";
import { companyFreeHref } from "@/lib/research/company-href";
import { muWatchForMember, muWatchTitles, muWatchFacts, muWatchSource } from "@/lib/research/mu-watch";
import MuWatch from "../mu-watch";
import { publicEvent } from "@/lib/research/access";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { events } from "@/lib/research/content-server";
import { buildCompanyProfiles } from "@/lib/research/companies";
import { companyWatchForMember, watchTitles } from "@/lib/research/company-watch";
import CompanyWatch from "../company-watch";
import { companyDiveForMember } from "@/lib/research/company-dive";
import { newerReport } from "@/lib/research/dive-staleness";
import { loadEffectiveDive, loadLiveRelease } from "@/lib/research/company-earnings-live.server";
import { isOwnerAccount } from "@/lib/membership/entitlements";
import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { buildCoverageCompanies, coverageCompanyIssues, providers, snapshotIssues, type IntakeSnapshot } from "@/lib/research/intake";

export const dynamicParams = false;
export function generateStaticParams() { return providers.map((provider) => ({ ticker: provider.ticker })); }
const profiles = buildCompanyProfiles(events.map(publicEvent));
const snapshot = rawSnapshot as IntakeSnapshot;
const coverageCompanies = buildCoverageCompanies(snapshot);

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const profile = profiles.find((item) => item.ticker === ticker);
  const coverage = coverageCompanies.find((item) => item.ticker === ticker);
  return {
    title: `${profile?.name ?? coverage?.name ?? "Company"} | Tech Phase Research`,
    description: ticker === "MU" ? "Micron quarterly results, growth drivers, changes and research checkpoints. Reviewed September 30, 2026 release." : "Company earnings, source-linked analysis and automatically refreshed published updates.",
    robots: { index: false, follow: false },
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  // PRO only (owner, Nov 25): FREE and signed-out readers go to the stock's FREE page before anything is read or rendered.
  const verified = await requireProPage(companyFreeHref(ticker));
  // Past the gate the reader is PRO or an owner account; the owner sees every card also while trying the app as FREE.
  const member = { ...verified, status: "signed-in", plan: "pro", accessExpiresAt: Number.MAX_SAFE_INTEGER };
  const coverage = coverageCompanies.find((item) => item.ticker === ticker);
  if (!coverage) notFound();
  const snapshotProblems = snapshotIssues(snapshot);
  const coverageProblems = coverageCompanyIssues(coverageCompanies);
  if (snapshotProblems.length || coverageProblems.length) throw new Error(`Invalid coverage data: ${[...snapshotProblems, ...coverageProblems].join(", ")}`);
  const companyOptions = coverageCompanies.map(({ ticker, name }) => ({ ticker, name }));
  if (ticker === "MU") {
    return <MuWatch companies={companyOptions} cards={muWatchForMember(member)} titles={muWatchTitles} facts={muWatchFacts} source={muWatchSource}/>;
  }
  // The reviewed deep dive (lib/research/dives/<TICKER>.json) replaces the legacy cards once it exists and passes the check; a file
  // that fails is dropped for this ticker only (logged by the loader) and the legacy view stays as the fallback.
  const file = await loadEffectiveDive(ticker);
  const dive = file ? companyDiveForMember(file, verified) : null;
  const watch = dive ? null : companyWatchForMember(ticker, member);
  if (!dive && !watch) notFound();
  const shown = (dive ?? watch)!;
  // A newer quarter the monitor already read from the company's own release (seconds after the filing) replaces the file's quarter at
  // the top of the page; the deep dive keeps its own, labelled quarter until a new dive is published.
  const live = dive ? (await loadLiveRelease({ ticker, period: dive.period, releasedOn: dive.releasedOn, currency: dive.currency })).release : null;
  // Never call an older quarter 直近 when the calendar or the SEC results data already know a newer release.
  const stale = newerReport(ticker, live?.releasedOn ?? shown.releasedOn);
  if (stale) console.warn(`[company-dive] ${ticker}: the page shows ${shown.period} (released ${shown.releasedOn}, ${dive ? "dive file" : "legacy view"}) but a newer release on ${stale.on}${stale.period ? ` (${stale.period})` : ""} is known from the ${stale.source}`);
  return <CompanyWatch key={ticker} companies={companyOptions} watch={watch} dive={dive} live={live} titles={watchTitles} stale={stale} ownerNotice={isOwnerAccount(verified.userId)}/>;
}
