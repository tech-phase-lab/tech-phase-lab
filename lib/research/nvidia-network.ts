import roleReview from "./nvidia-network-role-review.data.json" with {type:"json"};
import {networkFocus} from "./company-network.ts";
import type {CompanyNetwork, NetworkMode} from "./company-network.ts";

// A small, stable reading order: core suppliers, chip peers, OEMs, then clouds.
const priority = ["NVDA", "TSM", "MU", "SK hynix", "AMD", "INTC", "AVGO", "NBIS",
  "MSFT", "AMZN", "GOOG", "META", "ORCL", "CRWV", "SMCI", "DELL", "ANET", "AMAT", "ASML", "LRCX"];
export function nvidiaReviewedNetwork(source: CompanyNetwork): CompanyNetwork {
  const peers = new Set(Object.keys(roleReview));
  const edges = source.edges.filter(edge => !((edge.from === source.root || edge.to === source.root) && peers.has(edge.from === source.root ? edge.to : edge.from)));
  for (const [peer, review] of Object.entries(roleReview)) {
    const old = source.edges.filter(edge => (edge.from === source.root && edge.to === peer) || (edge.to === source.root && edge.from === peer));
    edges.push({id: `${review.kind}:${source.root}:${peer}:review20261018`, from: source.root, to: peer,
      kind: review.kind as "partner" | "competition", evidence: [{about: source.root,
        label: {ja: review.ja, en: review.en}, reviewedOn: "2026-10-18",
        sources: [...review.sources, ...old.flatMap(edge => edge.evidence.flatMap(item => item.sources)).filter(item => !review.sources.some(source => source.url === item.url))]}]});
  }
  return {...source, edges};
}
const competitorProducts: Record<string, {ja: string; en: string}> = {
  AMD: {ja: "GPU", en: "GPUs"}, INTC: {ja: "GPU・AI半導体", en: "GPUs & AI chips"},
  AVGO: {ja: "ASIC・通信", en: "ASICs & networking"}, ANET: {ja: "ネットワーク", en: "Networking"},
  GOOG: {ja: "独自AI半導体", en: "Custom AI chips"}, AMZN: {ja: "独自AI半導体", en: "Custom AI chips"},
};
export function nvidiaCompetitorProduct(id: string, lang: "ja" | "en") { return competitorProducts[id]?.[lang]; }
export function nvidiaNetworkView(source: CompanyNetwork, mode: NetworkMode): CompanyNetwork {
  const graph = nvidiaReviewedNetwork(source);
  const limit = mode === "direct" ? 8 : 20;
  const focus = networkFocus(graph, graph.root, mode);
  const eligible = new Set([graph.root, ...focus.distances.keys(), ...focus.competitors]);
  const candidates = graph.nodes.filter(node => eligible.has(node.id));
  const rank = (id: string) => { const i = priority.indexOf(id); return i < 0 ? priority.length : i; };
  const chosen = [...candidates].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, limit);
  const ids = new Set(chosen.map(node => node.id));
  return {...graph, nodes: chosen,
    edges: focus.visibleEdges.filter(edge => ids.has(edge.from) && ids.has(edge.to))};
}
