import providers from "./providers.json" with { type: "json" };
import type { ComparisonCompany } from "./comparison";
const groups: Record<string, string> = { MU: "memory", SKHY: "memory", SNDK: "nand", NVDA: "compute", AMD: "compute", ARM: "ip", AVGO: "diversified-chips", TSM: "foundry", ASML: "equipment", MRVL: "connectivity", CRDO: "connectivity", ANET: "networking", NBIS: "cloud", CRWV: "cloud", VRT: "cooling", GEV: "generation", BE: "fuel-cell", DELL: "servers", PLTR: "software", MSFT: "diversified-platform", GOOGL: "advertising-platform", ORCL: "enterprise-cloud" };
const cautions: Record<string, [string, string]> = {
  memory: ["メモリ価格と需給の循環、HBM構成比、設備投資を確認。好況期の利益だけで割安とは判断しません。", "Check memory pricing cycles, HBM mix and capex. Peak-cycle earnings do not establish value."],
  cloud: ["契約額・ARRと売上実績は別物です。稼働率、設備投資、資金調達と希薄化を確認します。", "Contracts and ARR are not realized revenue. Check utilization, capex, funding and dilution."],
  compute: ["顧客の設備投資、輸出規制、競争と製品構成の変化を確認します。", "Check customer capex, export controls, competition and changes in product mix."],
};
export const comparisonCatalog: ComparisonCompany[] = providers.map(p => {
  const peer = groups[p.ticker] || p.ticker;
  const [ja, en] = cautions[peer] || ["買収・売却、為替、一時損益、顧客集中、株式報酬の影響は原資料で追加確認が必要です。", "Review acquisitions, disposals, FX, one-offs, customer concentration and stock-based compensation in the filings."];
  return { ticker: p.ticker, name: p.name, peer, caution: { ja, en } };
});
