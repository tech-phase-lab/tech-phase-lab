import CapitalMap from "./screen";
import { getMembership } from "@/lib/membership/server";
import { comparisonAccess } from "@/lib/research/comparison";
import type { CapitalPortfolio } from "@/lib/research/capital-map";
export const dynamic = "force-dynamic";
export const metadata = { title: "資本マップ | CAPITAL MAP | Tech Phase Research", robots: { index: false, follow: false } };
export default async function Page() {
  const member = await getMembership().catch(() => null);
  if (!member || comparisonAccess(member) !== 200) return <CapitalMap />;
  const [{ default: disclosures }, { default: acwi }, { default: corporate }] = await Promise.all([
    import("@/lib/research/capital-map-disclosures.json"),
    import("@/lib/research/capital-map-acwi.json"),
    import("@/lib/research/capital-map-corporate.json"),
  ]);
  return <CapitalMap portfolios={[...disclosures, ...corporate, acwi] as CapitalPortfolio[]} mode="reports" />;
}
