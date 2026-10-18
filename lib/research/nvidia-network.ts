import {networkFocus} from "./company-network.ts";
import type {CompanyNetwork, NetworkMode} from "./company-network.ts";

// A small, stable reading order: core suppliers, chip peers, OEMs, then clouds.
const priority = ["NVDA", "TSM", "MU", "SK hynix", "AMD", "SMCI", "DELL", "MSFT",
  "AMZN", "GOOG", "META", "ORCL", "CRWV", "NBIS", "AVGO", "ANET", "AMAT", "ASML", "LRCX", "ARM"];
export function nvidiaNetworkView(graph: CompanyNetwork, mode: NetworkMode): CompanyNetwork {
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
