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
  const watch=companyWatchForMember(ticker,member);
  if(!watch) notFound();
  return <CompanyWatch key={ticker} companies={companyOptions} watch={watch} titles={watchTitles}/>;
}
