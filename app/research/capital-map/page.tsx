import CapitalMap from "./screen";
import { getMembership } from "@/lib/membership/server";
import { comparisonAccess } from "@/lib/research/comparison";
import type { CapitalPortfolio, CapitalSnapshot } from "@/lib/research/capital-map";
export const dynamic = "force-dynamic";
export const metadata = { title: "資本マップ | CAPITAL MAP | Tech Phase Research", robots: { index: false, follow: false } };
export default async function Page() {
  const member = await getMembership().catch(() => null);
  if (!member || comparisonAccess(member) !== 200) return <CapitalMap />;
  const [{ default: disclosures }, { default: acwi }, { default: corporate }, { default: history }, { default: additional }] = await Promise.all([
    import("@/lib/research/capital-map-disclosures.json"),
    import("@/lib/research/capital-map-acwi.json"),
    import("@/lib/research/capital-map-corporate.json"),
    import("@/lib/research/capital-map-history.json"),
    import("@/lib/research/capital-map-additional-managers.json"),
  ]);
  const previous = history as Record<string, CapitalSnapshot>;
  const portfolios = ([...disclosures, ...corporate, acwi, ...additional] as CapitalPortfolio[]).map(portfolio => ({ ...portfolio, previous: previous[portfolio.id] ?? portfolio.previous }));
  return <CapitalMap portfolios={portfolios} mode="reports" />;
}
