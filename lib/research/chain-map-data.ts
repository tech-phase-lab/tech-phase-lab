import nvda from "../../data/chain/NVDA.json" with { type: "json" };

/** One stock's reviewed chain map: boxes by business row, lines by relation type, plus two-step links.
 * Add another stock by dropping data/chain/<TICKER>.json in the same shape and listing it below. */
export type ChainKind = "up" | "down" | "tie" | "rival";
export type ChainSource = { label: string; label_en: string; url: string; level: "official" | "press"; date?: string; quote?: string; note?: string; note_en?: string };
export type ChainRelation = { type: ChainKind; text: string; text_en: string; source: ChainSource };
export type ChainCompany = { id: string; ticker: string; name: string; sub: string; sub_en: string; row: number; relations: ChainRelation[] };
export type ChainFar = { from: string; to: string; text: string; text_en: string; source: ChainSource };
export type ChainMapData = {
  root: { ticker: string; name: string };
  rows: { ja: string; en: string }[];
  rivals: string[];
  companies: ChainCompany[];
  far: ChainFar[];
  note: { ja: string; en: string };
};

const available: Record<string, ChainMapData> = { NVDA: nvda as ChainMapData };
export const chainDataFor = (root: string): ChainMapData | null => available[root] ?? null;

export const CHAIN_KINDS: ChainKind[] = ["up", "down", "tie", "rival"];
const text = {
  up: { tag: ["供給", "Supplier"], legend: ["供給・採用元", "Suppliers / sources"], group: ["供給元(上流)", "Suppliers (upstream)"] },
  down: { tag: ["納入", "Customer"], legend: ["納入・採用先", "Customers / adopters"], group: ["納入先・顧客(下流)", "Customers (downstream)"] },
  tie: { tag: ["提携・出資", "Partner"], legend: ["提携・出資・技術対応", "Partnerships, investment & technology support"], group: ["提携・出資・技術対応", "Partnerships, investment & technology support"] },
  rival: { tag: ["競合", "Competitor"], legend: ["競合", "Competitors"], group: ["競合", "Competitors"] },
  far: { tag: ["2段先", "2 steps out"], legend: ["さらに先の関係", "Further links"], group: ["さらに先の関係", "Further links"] },
} as const;
export type ChainTone = ChainKind | "far";
export const chainText = (tone: ChainTone, part: "tag" | "legend" | "group", lang: "ja" | "en") => text[tone][part][lang === "ja" ? 0 : 1];

/** Boxes of a type's group: a company with several kinds of relation sits once, in its first kind's group. */
export const chainGroup = (data: ChainMapData, kind: ChainKind) => data.companies.filter(company => company.relations[0].type === kind);
export const chainCounts = (data: ChainMapData) => ({
  companies: data.companies.length,
  relations: data.companies.reduce((sum, company) => sum + company.relations.length, 0) + data.far.length,
});
export const chainKinds = (company: ChainCompany): ChainKind[] => [...new Set(company.relations.map(relation => relation.type))];
