import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { events } from "@/lib/research/data";
import { buildCompanyProfiles, companyProfileIssues } from "@/lib/research/companies";
import { compareMetrics, evidenceIssues } from "@/lib/research/quality";
import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { buildCoverageCompanies, coverageCompanyIssues, providers, snapshotIssues, type IntakeSnapshot } from "@/lib/research/intake";
import CompanyDashboard from "../company-dashboard";
import CoverageCompanyDashboard from "../coverage-company-dashboard";

export const dynamicParams = false;
export function generateStaticParams() { return providers.map((provider) => ({ ticker: provider.ticker })); }
const profiles = buildCompanyProfiles(events);
const snapshot = rawSnapshot as IntakeSnapshot;
const coverageCompanies = buildCoverageCompanies(snapshot);

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const profile = profiles.find((item) => item.ticker === ticker);
  const coverage = coverageCompanies.find((item) => item.ticker === ticker);
  return {
    title: `${profile?.name ?? coverage?.name ?? "Company"} | Tech Phase Research`,
    description: profile ? "Source-linked company history, financial comparisons, and research checkpoints. Historical preview." : "Official-source intake status and preparation for source-linked company research.",
    robots: { index: false, follow: false },
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const profile = profiles.find((item) => item.ticker === ticker);
  const coverage = coverageCompanies.find((item) => item.ticker === ticker);
  if (!coverage) notFound();
  const snapshotProblems = snapshotIssues(snapshot);
  const coverageProblems = coverageCompanyIssues(coverageCompanies);
  if (snapshotProblems.length || coverageProblems.length) throw new Error(`Invalid coverage data: ${[...snapshotProblems, ...coverageProblems].join(", ")}`);
  const companyOptions = coverageCompanies.map(({ ticker, name }) => ({ ticker, name }));
  if (!profile) return <CoverageCompanyDashboard key={ticker} company={coverage} companies={companyOptions} generatedAt={snapshot.generatedAt} />;
  const issues = companyProfileIssues(profile);
  for (const event of profile.events) issues.push(...evidenceIssues({ ...event, metrics: [...event.metrics, ...(event.previous ?? [])] }));
  for (const row of profile.comparisons) {
    const comparison = compareMetrics(row.current, row.previous);
    if (!comparison.ok && comparison.reason !== "non-positive-base") issues.push(`incompatible-comparison:${row.id}`);
  }
  if (issues.length) throw new Error(`Invalid company profile ${ticker}: ${issues.join(", ")}`);
  return <CompanyDashboard key={profile.ticker} profile={profile} companies={companyOptions} />;
}
