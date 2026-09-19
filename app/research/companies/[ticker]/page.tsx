import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { events } from "@/lib/research/data";
import { buildCompanyProfiles, companyProfileIssues } from "@/lib/research/companies";
import { compareMetrics, evidenceIssues } from "@/lib/research/quality";
import CompanyDashboard from "../company-dashboard";

export const dynamicParams = false;
export function generateStaticParams() { return [{ ticker: "MU" }, { ticker: "NBIS" }]; }
const profiles = buildCompanyProfiles(events);

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const profile = profiles.find((item) => item.ticker === ticker);
  return {
    title: `${profile?.name ?? "Company"} | Tech Phase Research`,
    description: "Source-linked company history, financial comparisons, and research checkpoints. Historical preview.",
    robots: { index: false, follow: false },
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const profile = profiles.find((item) => item.ticker === ticker);
  if (!profile) notFound();
  const issues = companyProfileIssues(profile);
  for (const event of profile.events) issues.push(...evidenceIssues({ ...event, metrics: [...event.metrics, ...(event.previous ?? [])] }));
  for (const row of profile.comparisons) {
    const comparison = compareMetrics(row.current, row.previous);
    if (!comparison.ok && comparison.reason !== "non-positive-base") issues.push(`incompatible-comparison:${row.id}`);
  }
  if (issues.length) throw new Error(`Invalid company profile ${ticker}: ${issues.join(", ")}`);
  return <CompanyDashboard key={profile.ticker} profile={profile} />;
}
