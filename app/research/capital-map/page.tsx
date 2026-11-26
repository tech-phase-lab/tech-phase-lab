import CapitalMap from "./screen";
import { firstView, loadCapitalPortfolios, withoutHoldings } from "@/lib/research/capital-map-data";
export const dynamic = "force-dynamic";
export const metadata = { title: "資本マップ | CAPITAL MAP | Tech Phase Research", robots: { index: false, follow: false } };
/** The list of every portfolio, with the holdings of the first view only (lib/research/capital-map-data.ts); the rest load when chosen. */
export default async function Page({ searchParams }: { searchParams?: Promise<{ portfolio?: string | string[] }> } = {}) {
  const requested = (await searchParams)?.portfolio;
  const portfolios = await loadCapitalPortfolios();
  const loaded = firstView(portfolios, typeof requested === "string" ? requested : null);
  return <CapitalMap portfolios={portfolios.map(item => loaded.includes(item.id) ? item : withoutHoldings(item))} loaded={loaded} mode="reports" />;
}
