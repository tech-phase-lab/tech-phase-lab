import c_aaoi from "../../data/chain/AAOI.json" with { type: "json" };
import c_aapl from "../../data/chain/AAPL.json" with { type: "json" };
import c_abnb from "../../data/chain/ABNB.json" with { type: "json" };
import c_adbe from "../../data/chain/ADBE.json" with { type: "json" };
import c_akam from "../../data/chain/AKAM.json" with { type: "json" };
import c_alab from "../../data/chain/ALAB.json" with { type: "json" };
import c_amat from "../../data/chain/AMAT.json" with { type: "json" };
import c_amd from "../../data/chain/AMD.json" with { type: "json" };
import c_amzn from "../../data/chain/AMZN.json" with { type: "json" };
import c_anet from "../../data/chain/ANET.json" with { type: "json" };
import c_aph from "../../data/chain/APH.json" with { type: "json" };
import c_arm from "../../data/chain/ARM.json" with { type: "json" };
import c_asml from "../../data/chain/ASML.json" with { type: "json" };
import c_avgo from "../../data/chain/AVGO.json" with { type: "json" };
import c_be from "../../data/chain/BE.json" with { type: "json" };
import c_ceg from "../../data/chain/CEG.json" with { type: "json" };
import c_cohr from "../../data/chain/COHR.json" with { type: "json" };
import c_crdo from "../../data/chain/CRDO.json" with { type: "json" };
import c_crm from "../../data/chain/CRM.json" with { type: "json" };
import c_crwd from "../../data/chain/CRWD.json" with { type: "json" };
import c_crwv from "../../data/chain/CRWV.json" with { type: "json" };
import c_dell from "../../data/chain/DELL.json" with { type: "json" };
import c_gev from "../../data/chain/GEV.json" with { type: "json" };
import c_googl from "../../data/chain/GOOGL.json" with { type: "json" };
import c_ibm from "../../data/chain/IBM.json" with { type: "json" };
import c_intc from "../../data/chain/INTC.json" with { type: "json" };
import c_ionq from "../../data/chain/IONQ.json" with { type: "json" };
import c_iren from "../../data/chain/IREN.json" with { type: "json" };
import c_klac from "../../data/chain/KLAC.json" with { type: "json" };
import c_lite from "../../data/chain/LITE.json" with { type: "json" };
import c_lrcx from "../../data/chain/LRCX.json" with { type: "json" };
import c_meta from "../../data/chain/META.json" with { type: "json" };
import c_mrvl from "../../data/chain/MRVL.json" with { type: "json" };
import c_msft from "../../data/chain/MSFT.json" with { type: "json" };
import c_mu from "../../data/chain/MU.json" with { type: "json" };
import c_nbis from "../../data/chain/NBIS.json" with { type: "json" };
import c_nflx from "../../data/chain/NFLX.json" with { type: "json" };
import c_now from "../../data/chain/NOW.json" with { type: "json" };
import c_nvda from "../../data/chain/NVDA.json" with { type: "json" };
import c_orcl from "../../data/chain/ORCL.json" with { type: "json" };
import c_panw from "../../data/chain/PANW.json" with { type: "json" };
import c_pltr from "../../data/chain/PLTR.json" with { type: "json" };
import c_qcom from "../../data/chain/QCOM.json" with { type: "json" };
import c_skhy from "../../data/chain/SKHY.json" with { type: "json" };
import c_sndk from "../../data/chain/SNDK.json" with { type: "json" };
import c_snow from "../../data/chain/SNOW.json" with { type: "json" };
import c_sofi from "../../data/chain/SOFI.json" with { type: "json" };
import c_stx from "../../data/chain/STX.json" with { type: "json" };
import c_tsla from "../../data/chain/TSLA.json" with { type: "json" };
import c_tsm from "../../data/chain/TSM.json" with { type: "json" };
import c_vrt from "../../data/chain/VRT.json" with { type: "json" };
import c_vst from "../../data/chain/VST.json" with { type: "json" };

/** One stock's reviewed chain map: boxes by business row, lines by relation type, plus two-step links.
 * Add another stock by dropping data/chain/<TICKER>.json in the same shape and listing it below. */
export type ChainKind = "up" | "down" | "tie" | "rival";
export type ChainSource = { label: string; label_en: string; url: string; level: "official" | "press"; date?: string; quote?: string; note?: string; note_en?: string };
export type ChainRelation = { type: ChainKind; text: string; text_en: string; source: ChainSource };
export type ChainCompany = { id: string; ticker: string; name: string; name_en?: string; sub: string; sub_en: string; row: number; relations: ChainRelation[] };
export type ChainFar = { from: string; to: string; text: string; text_en: string; source: ChainSource };
export type ChainMapData = {
  root: { ticker: string; name: string };
  /** Row 0 sits above the root by default; `above: true` puts further supplier rows above it too. Rows without companies are not drawn. */
  rows: { ja: string; en: string; above?: boolean }[];
  rivals: string[];
  companies: ChainCompany[];
  far: ChainFar[];
  note: { ja: string; en: string };
};

const available: Record<string, ChainMapData> = {
  AAOI: c_aaoi as ChainMapData,
  AAPL: c_aapl as ChainMapData,
  ABNB: c_abnb as ChainMapData,
  ADBE: c_adbe as ChainMapData,
  AKAM: c_akam as ChainMapData,
  ALAB: c_alab as ChainMapData,
  AMAT: c_amat as ChainMapData,
  AMD: c_amd as ChainMapData,
  AMZN: c_amzn as ChainMapData,
  ANET: c_anet as ChainMapData,
  APH: c_aph as ChainMapData,
  ARM: c_arm as ChainMapData,
  ASML: c_asml as ChainMapData,
  AVGO: c_avgo as ChainMapData,
  BE: c_be as ChainMapData,
  CEG: c_ceg as ChainMapData,
  COHR: c_cohr as ChainMapData,
  CRDO: c_crdo as ChainMapData,
  CRM: c_crm as ChainMapData,
  CRWD: c_crwd as ChainMapData,
  CRWV: c_crwv as ChainMapData,
  DELL: c_dell as ChainMapData,
  GEV: c_gev as ChainMapData,
  GOOGL: c_googl as ChainMapData,
  IBM: c_ibm as ChainMapData,
  INTC: c_intc as ChainMapData,
  IONQ: c_ionq as ChainMapData,
  IREN: c_iren as ChainMapData,
  KLAC: c_klac as ChainMapData,
  LITE: c_lite as ChainMapData,
  LRCX: c_lrcx as ChainMapData,
  META: c_meta as ChainMapData,
  MRVL: c_mrvl as ChainMapData,
  MSFT: c_msft as ChainMapData,
  MU: c_mu as ChainMapData,
  NBIS: c_nbis as ChainMapData,
  NFLX: c_nflx as ChainMapData,
  NOW: c_now as ChainMapData,
  NVDA: c_nvda as ChainMapData,
  ORCL: c_orcl as ChainMapData,
  PANW: c_panw as ChainMapData,
  PLTR: c_pltr as ChainMapData,
  QCOM: c_qcom as ChainMapData,
  SKHY: c_skhy as ChainMapData,
  SNDK: c_sndk as ChainMapData,
  SNOW: c_snow as ChainMapData,
  SOFI: c_sofi as ChainMapData,
  STX: c_stx as ChainMapData,
  TSLA: c_tsla as ChainMapData,
  TSM: c_tsm as ChainMapData,
  VRT: c_vrt as ChainMapData,
  VST: c_vst as ChainMapData,
};
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
/** Whether a row sits above the root chip (suppliers) or below it. */
export const chainAbove = (data: ChainMapData, row: number) => data.rows[row]?.above ?? row === 0;
export const chainKinds = (company: ChainCompany): ChainKind[] => [...new Set(company.relations.map(relation => relation.type))];
