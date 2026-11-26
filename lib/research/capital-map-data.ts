import { createHash } from "node:crypto";
import type { CapitalPortfolio, CapitalSnapshot } from "./capital-map";

/** 資本マップ: every reported portfolio (public, the same for everyone). Speed, Nov 26: the page had embedded all of them, every holding of
 * 33 portfolios, in its first HTML (5.8 MB, 938 KB compressed; a phone on 4G waited over five seconds). Now the page carries the list and
 * the first view's holdings only (`firstView`), and the screen reads a portfolio's holdings when it is chosen from
 * /api/research/capital-map, which the CDN keeps (the data changes only with a deployment). */
export async function loadCapitalPortfolios(): Promise<CapitalPortfolio[]> {
  const [{ default: disclosures }, { default: acwi }, { default: corporate }, { default: history }, { default: additional }, { default: additionalCorporate }] = await Promise.all([
    import("./capital-map-disclosures.json"),
    import("./capital-map-acwi.json"),
    import("./capital-map-corporate.json"),
    import("./capital-map-history.json"),
    import("./capital-map-additional-managers.json"),
    import("./capital-map-additional-corporate.json"),
  ]);
  const previous = history as Record<string, CapitalSnapshot>;
  return ([...disclosures, ...corporate, ...additionalCorporate, acwi, ...additional] as CapitalPortfolio[]).map(portfolio => ({ ...portfolio, previous: previous[portfolio.id] ?? portfolio.previous }));
}

let version: Promise<string> | null = null;
/** A short hash of the reported data: the page asks /api/research/capital-map?v=<this>, so a deployment with new data never gets an
 * answer the CDN or the browser kept for the old one. */
export function capitalDataVersion(): Promise<string> {
  return version ??= loadCapitalPortfolios().then(all => createHash("sha256").update(JSON.stringify(all)).digest("hex").slice(0, 12));
}

/** The holdings of a portfolio, as the screen merges them in. */
export type CapitalHoldings = Pick<CapitalPortfolio, "current" | "previous">;

/** A portfolio without its holdings (the snapshot's dates and sources stay, so the list and labels draw as before). */
export function withoutHoldings(portfolio: CapitalPortfolio): CapitalPortfolio {
  return { ...portfolio, current: { ...portfolio.current, holdings: [] }, previous: portfolio.previous && { ...portfolio.previous, holdings: [] } };
}

/** The portfolios the page opens on: the first fund manager (the default tab), or the one a shared link names (`?portfolio=`). */
export function firstView(portfolios: CapitalPortfolio[], requested?: string | null): string[] {
  const first = portfolios.find(item => item.kind === "manager")?.id ?? portfolios[0]?.id;
  return [...new Set([first, portfolios.find(item => item.id === requested)?.id].filter((id): id is string => !!id))];
}
