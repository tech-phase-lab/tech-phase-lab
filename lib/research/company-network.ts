export type NetworkText = { ja: string; en: string };
export type NetworkNode = { id: string; name: string; ticker?: string; nameJa?: string; kind: "company" | "industry"; layer: number; summary?: NetworkText };
export type NetworkEvidence = { about: string; label: NetworkText; reviewedOn: string; sources: { label: string; url: string }[] };
export type NetworkEdge = { id: string; from: string; to: string; kind: "supply" | "partner" | "investment" | "competition"; evidence: NetworkEvidence[] };
export type CompanyNetwork = { root: string; nodes: NetworkNode[]; edges: NetworkEdge[] };
export type NetworkMode = "direct" | "two" | "all";
export const networkLayers: NetworkText[] = [
  { ja: "製造装置・材料", en: "Equipment & materials" },
  { ja: "半導体の受託製造", en: "Chip manufacturing" },
  { ja: "メモリー", en: "Memory" },
  { ja: "チップ設計・接続半導体", en: "Chip design & connectivity" },
  { ja: "光通信・接続部品", en: "Optics & components" },
  { ja: "サーバー・ネットワーク・電源", en: "Servers, networking & power" },
  { ja: "クラウド・AIサービス", en: "Cloud & AI services" },
  { ja: "端末・サービス・その他", en: "Devices, services & others" },
  { ja: "関連する業種", en: "Industry relationships" },
];

// Competitors are a side relationship, never a bridge in a supply chain.
export function networkFocus(graph: CompanyNetwork, selected: string, mode: NetworkMode) {
  const distances = new Map<string, number>([[selected, 0]]);
  const limit = mode === "direct" ? 1 : 2;
  for (let depth = 0; depth < limit; depth++) {
    for (const edge of graph.edges) {
      if (edge.kind === "competition") continue;
      if (distances.get(edge.from) === depth && !distances.has(edge.to)) distances.set(edge.to, depth + 1);
      if (distances.get(edge.to) === depth && !distances.has(edge.from)) distances.set(edge.from, depth + 1);
    }
  }
  const competitors = new Set<string>();
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "competition" && (edge.from === selected || edge.to === selected)) competitors.add(edge.from === selected ? edge.to : edge.from);
    if (edge.kind === "supply" && edge.to === selected) upstream.add(edge.from);
    if (edge.kind === "supply" && edge.from === selected) downstream.add(edge.to);
  }
  const visibleEdges = graph.edges.filter(edge => {
    if (edge.kind === "competition") return edge.from === selected || edge.to === selected;
    if (mode === "all") return true;
    const from = distances.get(edge.from), to = distances.get(edge.to);
    // Do not add a spurious extra edge between two nodes at the outer boundary.
    return from !== undefined && to !== undefined && Math.min(from, to) < limit;
  });
  return { distances, competitors, upstream, downstream, visibleEdges };
}

export type NetworkPosition = { x: number; y: number; width: number; height: number };
export function layoutCompanyNetwork(nodes: NetworkNode[], availableWidth: number) {
  const width = Math.max(220, Math.floor(availableWidth));
  const padding = 12, gap = 10;
  const columns = Math.max(2, Math.min(6, Math.floor((width - padding * 2 + gap) / 106)));
  const nodeWidth = Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
  const positions: Record<string, NetworkPosition> = {};
  const layers: { index: number; y: number }[] = [];
  let y = 14;
  for (let index = 0; index < networkLayers.length; index++) {
    const members = nodes.filter(node => node.layer === index);
    if (!members.length) continue;
    layers.push({ index, y });
    y += 32;
    members.forEach((node, i) => {
      positions[node.id] = { x: padding + (i % columns) * (nodeWidth + gap), y: y + Math.floor(i / columns) * 92, width: nodeWidth, height: 68 };
    });
    y += Math.ceil(members.length / columns) * 92 + 26;
  }
  return { width, height: y, positions, layers };
}

export function networkEdgePath(from: NetworkPosition, to: NetworkPosition, offset = 0) {
  const startX = from.x + from.width / 2, endX = to.x + to.width / 2;
  if (Math.abs(from.y - to.y) < 2) {
    const y = from.y + from.height;
    const bend = y + 12 + offset;
    return `M ${startX} ${y} C ${startX} ${bend}, ${endX} ${bend}, ${endX} ${y}`;
  }
  const down = to.y > from.y;
  const startY = down ? from.y + from.height : from.y;
  const endY = down ? to.y : to.y + to.height;
  const middle = (startY + endY) / 2 + offset;
  return `M ${startX} ${startY} C ${startX} ${middle}, ${endX} ${middle}, ${endX} ${endY}`;
}
