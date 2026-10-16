export type NetworkText = { ja: string; en: string };
export type NetworkNode = { id: string; name: string; ticker?: string; nameJa?: string; kind: "company" | "industry"; layer: number; summary?: NetworkText; businessLabel?: NetworkText };
export type NetworkEvidence = { about: string; label: NetworkText; reviewedOn: string; sources: { label: string; url: string }[] };
export type NetworkEdge = { id: string; from: string; to: string; kind: "supply" | "partner" | "investment" | "competition"; evidence: NetworkEvidence[] };
export type CompanyNetwork = { root: string; nodes: NetworkNode[]; edges: NetworkEdge[]; layerLabels?: Record<number, NetworkText> };
export type NetworkMode = "direct" | "two" | "all";
// A missing US ticker does not imply private ownership. These names identify
// listed overseas issuers; unresolved names stay out of the stock map.
const listedOverseas = new Set([
  "NTT",
  "FOCI Fiber Optic Communications", "Accton Technology",
  "Renesas Electronics",
  "Panasonic Holdings", "CATL", "BMW AG", "Volkswagen AG",
  "BJ's Wholesale Club", "Target", "Avnet", "Arrow Electronics", "Phison", "InnoLight", "RS",
  "Tokyo Electron", "ASM International", "Schneider Electric", "Legrand", "Samsung", "Samsung Electronics",
  "Nikon", "Canon", "SoftBank", "SK hynix", "Kioxia", "Siemens Energy", "Vestas", "Hitachi", "Lasertec",
  "Lenovo", "Foxconn", "Quanta Computer", "MediaTek", "Xiaomi", "Capgemini", "Infineon", "Infineon Technologies",
  "Seiko Epson", "Brother Industries", "Nokia", "ZTE", "Advantest", "Doosan Robotics", "Omron", "SCREEN",
  "INFICON", "Murata Manufacturing", "Merck", "JCET Group", "Powertech Technology", "Semiconductor Manufacturing International",
  "X-FAB", "Montage Technology", "Nordic Semiconductor", "VeriSilicon", "Novatek Microelectronics", "FocalTech Systems",
  "Ilitek", "Chipbond Technology", "Technoprobe", "Micronics Japan", "MPI", "AEM", "AEM Holdings", "Chroma ATE",
  "Tekscend Photomask", "Dai Nippon Printing", "SK-Electronics", "Anritsu", "AGC", "Nippon Electric Glass",
  "NGK Corporation", "BYD", "Airbus", "Dassault Systèmes", "Siemens", "Nintendo", "Oriental Land", "Meituan", "Tencent",
]);
export function isStockMapCompany(node: NetworkNode) {
  if (node.kind !== "company" || node.id === "QRVO") return false;
  return Boolean(node.ticker) || listedOverseas.has(node.id) || ["Anthropic", "OpenAI"].includes(node.id);
}
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
    if (index === 7 && members.length === 1 && layers.length) y -= 22;
    layers.push({ index, y });
    y += index === 7 && members.length === 1 ? 26 : 32;
    members.forEach((node, i) => {
      positions[node.id] = { x: padding + (i % columns) * (nodeWidth + gap), y: y + Math.floor(i / columns) * 92, width: nodeWidth, height: 68 };
    });
    // Keep room for curved edges between layers; trim the final margin below.
    const rows = Math.ceil(members.length / columns);
    y += (rows - 1) * 92 + 68 + 50;
  }
  return { width, height: layers.length ? y - 26 : y, positions, layers };
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
