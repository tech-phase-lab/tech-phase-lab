"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutCompanyNetwork, networkEdgePath, networkFocus, networkLayers } from "@/lib/research/company-network";
import type { CompanyNetwork, NetworkEdge, NetworkMode, NetworkNode } from "@/lib/research/company-network";
import { nvidiaCompetitorProduct, nvidiaNetworkView } from "@/lib/research/nvidia-network";
import styles from "./nvidia-network.module.css";

type Props = { graph: CompanyNetwork; lang: "ja" | "en" };
const businessLabels = [
  { ja: "製造装置・材料", en: "Equipment & materials" },
  { ja: "半導体製造", en: "Chip manufacturing" },
  { ja: "メモリー", en: "Memory" },
  { ja: "半導体設計", en: "Chip design" },
  { ja: "光通信・部品", en: "Optics & components" },
  { ja: "電源・通信設備", en: "Power & networking" },
  { ja: "クラウド・AI", en: "Cloud & AI" },
  { ja: "関連企業", en: "Related company" },
  { ja: "関連業種", en: "Related industry" },
];
const label = (node: NetworkNode, lang: "ja" | "en") => lang === "ja" ? node.nameJa ?? node.name : node.name;

export function NvidiaCompanyNetworkMap({ graph: sourceGraph, lang }: Props) {
  const [mode, setMode] = useState<NetworkMode>("direct");
  const [width, setWidth] = useState(640);
  const board = useRef<HTMLDivElement>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  function flash(id: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashed(id);
    flashTimer.current = setTimeout(() => setFlashed(null), 620);
  }
  const graph = useMemo(() => nvidiaNetworkView(sourceGraph, mode), [sourceGraph, mode]);
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);
  const selected = byId.get(graph.root)!;
  const focus = useMemo(() => networkFocus(graph, selected.id, mode), [graph, selected.id, mode]);
  const layout = useMemo(() => layoutCompanyNetwork(graph.nodes, width), [graph.nodes, width]);
  const direct = graph.edges.filter(edge => edge.from === selected.id || edge.to === selected.id);
  const sections = [
    ["upstream", tText("供給元（上流）", "Suppliers")],
    ["downstream", tText("納入先・顧客（下流）", "Recipients & customers")],
    ["partner", tText("提携・出資・技術対応", "Partners, investment & compatibility")],
    ["competition", tText("競合", "Competitors")],
  ] as const;
  function tText(ja: string, en: string) { return lang === "ja" ? ja : en; }
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function edgeTone(edge: NetworkEdge) {
    if (edge.kind === "competition") return "competition";
    if (edge.kind !== "supply") return "partner";
    if (edge.to === selected.id) return "upstream";
    if (edge.from === selected.id) return "downstream";
    return "indirect";
  }

  return <section className={styles.network} aria-label={t("企業の連鎖マップ", "Company connection map")}>
    <div className={styles.toolbar}>
      <div className={styles.titleRow}>
        <h3>{t("企業の連鎖マップ", "Company connection map")}</h3>
        <div className={styles.modes} role="group" aria-label={t("線の表示範囲", "Connection depth")}>
          {([["direct", "直接の関係", "Direct"], ["two", "2段先まで", "2 steps"], ["all", "全体", "All"]] as const).map(([value, ja, en]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{t(ja, en)}</button>)}
        </div>
      </div>
      <div className={styles.selection}>
        <div className={styles.selectedName} role="status"><strong>{selected.ticker ?? label(selected, lang)}</strong>{selected.ticker && <span>{label(selected, lang)}</span>}</div>
        <span className={styles.count}>{graph.nodes.filter(node => node.kind === "company").length}{t("社", " companies")} · {graph.edges.length}{t("の関係", " connections")}</span>
      </div>
    </div>

    <div className={styles.legend}>
      <span data-tone="upstream">{t("供給・採用元", "Suppliers")}</span><span data-tone="downstream">{t("納入・採用先", "Recipients")}</span><span data-tone="partner">{t("提携・出資・技術対応", "Partners, investment & compatibility")}</span><span data-tone="indirect">{t("さらに先の関係", "Further connections")}</span><span data-tone="competition">{t("競合", "Competitors")}</span>
    </div>
    <div className={styles.competitors} data-topic="competition">
      <h3><span>05</span>{t("競合は？", "Who competes with it?")}</h3>
      <div>{[...focus.competitors].map(id => {
        const node = byId.get(id)!;
        return <button type="button" key={id} className={styles.competitor} data-flashed={flashed === id} onClick={() => flash(id)}>{node.ticker ?? label(node, lang)}{nvidiaCompetitorProduct(id, lang) && <small>{nvidiaCompetitorProduct(id, lang)}</small>}</button>;
      })}{focus.competitors.size === 0 && <span>{t("具体的な競合は未収録", "No named competitors recorded")}</span>}</div>
    </div>
    <h3 className={styles.mapHeading}><span>06</span>{t("どこと繋がる？", "Who does it work with?")}</h3>
    <div className={styles.board} ref={board} style={{ height: layout.height }} aria-label={t("事業別の企業マップ", "Companies by business area")}>
      {layout.layers.map(layer => <div key={layer.index} className={styles.layer} style={{ top: layer.y }}>{networkLayers[layer.index][lang]}</div>)}
      <svg className={styles.lines} width="100%" height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
        {focus.visibleEdges.map((edge, index) => {
          const from = layout.positions[edge.from], to = layout.positions[edge.to];
          const tone = edgeTone(edge);
          return <path key={edge.id} d={networkEdgePath(from, to, index % 4 * 2)} data-tone={tone} data-direct={edge.from === selected.id || edge.to === selected.id} />;
        })}
      </svg>
      {graph.nodes.map(node => {
        const position = layout.positions[node.id];
        const active = node.id === selected.id;
        const distance = focus.distances.get(node.id);
        const relevant = mode === "all" || distance !== undefined || focus.competitors.has(node.id);
        const tone = active ? "selected" : focus.upstream.has(node.id) ? "upstream" : focus.downstream.has(node.id) ? "downstream" : focus.competitors.has(node.id) ? "competition" : distance === 1 ? "partner" : "indirect";
        return <button type="button" key={node.id} className={styles.node} onClick={() => flash(node.id)} data-flashed={flashed === node.id} style={{ left: position.x, top: position.y, width: position.width, height: position.height }} data-symbol={Boolean(node.ticker)} data-tone={tone} data-relevant={relevant} data-competitor={focus.competitors.has(node.id)} aria-current={active ? "true" : undefined} aria-label={label(node, lang)}>
          <strong>{node.ticker ?? label(node, lang)}</strong><span>{node.ticker ? label(node, lang) : businessLabels[node.layer][lang]}</span>
        </button>;
      })}
    </div>
    <div className={styles.inspector}>
      <h3>{t(`${selected.ticker ?? selected.name}との関係`, `Connections with ${selected.ticker ?? selected.name}`)}</h3>
      {sections.map(([tone, heading]) => {
        const relationships = direct.filter(edge => edgeTone(edge) === tone);
        return relationships.length > 0 && <section key={tone} className={styles.relationshipGroup} data-tone={tone}>
        <h4>{heading} <span>{relationships.length}{t("件", " relationships")}</span></h4>
        <ul>{relationships.map(edge => {
        const other = byId.get(edge.from === selected.id ? edge.to : edge.from)!;
        const evidence = edge.evidence.find(item => item.about === selected.id) ?? edge.evidence[0];
        return <li key={edge.id} data-tone={edgeTone(edge)}>
          <div className={styles.connectionTitle}><strong>{other.ticker ?? label(other, lang)}</strong><small>{other.id === "NBIS" ? t("提携・出資・採用先", "Partner, investment & adopter") : edge.kind === "supply" ? (edge.to === selected.id ? t("供給・採用元", "Supplier") : t("納入・採用先", "Recipient")) : edge.kind === "competition" ? t("競合", "Competitor") : edge.kind === "investment" ? t("出資", "Investment") : t("提携・連携", "Collaboration")}</small></div>
          <p className={styles.relationshipText}>{evidence.about !== selected.id && <span>{byId.get(evidence.about)?.name ?? evidence.about}: </span>}{evidence.label[lang]}</p>
        </li>;
      })}</ul></section>;
      })}
      <details className={styles.evidence}><summary>{t("関係の出典", "Relationship sources")}</summary>
        {direct.map(edge => <div key={edge.id}>{edge.evidence.map((evidence, index) => <div key={index}>
          <span>{byId.get(edge.from)?.name} / {byId.get(edge.to)?.name} · {evidence.reviewedOn}</span>
          {evidence.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}
        </div>)}</div>)}
      </details>
    </div>
    <p className={styles.footnote}>{t("線は公表された関係を示します。2段先の企業同士に直接取引があるとは限りません。", "Lines show disclosed relationships. A two-step path does not imply a direct transaction.")}</p>
  </section>;
}
