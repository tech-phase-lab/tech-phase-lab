"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlanSnapshot } from "@/lib/resolute/plan-data";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import { rulebookChapters, bookMoney, chapterGroup, type BookChapter } from "@/lib/resolute/rulebook";
import { BookCover } from "./book";
import styles from "../diagnosis.module.css";
import b from "./book-pc.module.css";

/* PC rulebook (owner, Nov 25, 01_税金の目安_マイルール_PC part 2): a two-page spread (01–02, 03–04 and so on) after the cover alone.
 * Clicking the right page turns forward, the left page back, as do ← → and the buttons under the book. The table of contents
 * on the right lists the chapters from rulebook.ts with their page numbers; the pages in view glow gold.
 * Every word stays inside a page: what does not fit flows on to the next page, a sentence at a time, never cut or hidden. */

type Plan = NonNullable<PlanSnapshot["plan"]>;
type Atom = "head" | "metrics" | "ladder" | "practiceTitle" | "closing";
type Unit = { chapter: number } & ({ kind: Atom } | { kind: "para" | "step"; item: number; text: string });
type Block = { kind: "atom"; unit: number } | { kind: "prose"; paras: string[] } | { kind: "practice"; title: number | null; start: number; items: string[] };
type Page = { chapter: number; units: number[] };
type Side = "cover" | "blank" | "none" | number;

const TURN_MS = 620;
// Text flows to the next page at a phrase boundary (after 。、 or a comma / full stop), so a page is filled before it turns.
const sentences = (text: string, en: boolean) => (en ? text.split(/(?<=[.,;:!?])\s+/) : text.split(/(?<=[。、！？])/)).filter(part => part.trim());

function bookUnits(chapters: BookChapter[], en: boolean): Unit[] {
 const units: Unit[] = [];
 chapters.forEach((chapter, c) => {
  units.push({ chapter: c, kind: "head" });
  if (chapter.metrics.length) units.push({ chapter: c, kind: "metrics" });
  if (chapter.lines?.length) units.push({ chapter: c, kind: "ladder" });
  chapter.paragraphs.forEach((text, item) => sentences(text, en).forEach(part => units.push({ chapter: c, kind: "para", item, text: part })));
  if (chapter.practice) {
   units.push({ chapter: c, kind: "practiceTitle" });
   chapter.practice.steps.forEach((text, item) => sentences(text, en).forEach(part => units.push({ chapter: c, kind: "step", item, text: part })));
  }
  if (chapter.closing) units.push({ chapter: c, kind: "closing" });
 });
 return units;
}

/** Groups a page's units into what is drawn: whole pieces, paragraphs (sentences joined) and the numbered practice steps. */
function blocksOf(indexes: number[], units: Unit[], en: boolean): Block[] {
 const blocks: Block[] = [];
 let lastPara = -1, lastStep = -1;
 for (const index of indexes) {
  const unit = units[index], top = blocks.at(-1);
  if (unit.kind === "para") {
   if (top?.kind === "prose" && lastPara === unit.item) top.paras[top.paras.length - 1] += (en ? " " : "") + unit.text;
   else if (top?.kind === "prose") top.paras.push(unit.text);
   else blocks.push({ kind: "prose", paras: [unit.text] });
   lastPara = unit.item;
  } else if (unit.kind === "step") {
   if (top?.kind === "practice" && top.items.length && lastStep === unit.item) top.items[top.items.length - 1] += (en ? " " : "") + unit.text;
   else if (top?.kind === "practice") top.items.push(unit.text);
   else blocks.push({ kind: "practice", title: null, start: unit.item + 1, items: [unit.text] });
   lastStep = unit.item;
  } else if (unit.kind === "practiceTitle") blocks.push({ kind: "practice", title: index, start: 1, items: [] });
  else blocks.push({ kind: "atom", unit: index });
 }
 return blocks;
}

export default function SpreadBook({ plan, locale, actions, notes }: { plan: Plan; locale: DiagnosisLocale; actions: ReactNode; notes: ReactNode }) {
 const en = locale === "en";
 const chapters = useMemo(() => rulebookChapters(plan, locale), [plan, locale]);
 const units = useMemo(() => bookUnits(chapters, en), [chapters, en]);
 // One page per chapter until the pages are measured (before the first paint).
 const [pages, setPages] = useState<Page[]>(() => chapters.map((_, chapter) => ({ chapter, units: units.flatMap((u, i) => u.chapter === chapter ? [i] : []) })));
 const [spread, setSpread] = useState(0), [turn, setTurn] = useState<{ from: number; to: number } | null>(null);
 const bookRef = useRef<HTMLDivElement>(null), sources = useRef<HTMLDivElement>(null), scratch = useRef<HTMLDivElement>(null);
 const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const total = pages.length, last = Math.ceil(total / 2), shown = Math.min(spread, last);

 const atom = (index: number): ReactNode => {
  const unit = units[index], chapter = chapters[unit.chapter];
  if (unit.kind === "head") return <div className={b.head}><span className={styles.chapterKicker}>{chapter.kicker}</span><h2>{chapter.title}</h2><p className={styles.chapterLead}>{chapter.lead}</p></div>;
  if (unit.kind === "metrics") return <dl className={styles.chapterMetrics}>{chapter.metrics.map(metric => <div key={metric.label} data-text={metric.text || undefined}><dt>{metric.label}</dt><dd>{metric.value}</dd>{metric.detail ? <dd className={styles.metricDetail}>{metric.detail}</dd> : null}</div>)}</dl>;
  if (unit.kind === "ladder") return <ol className={styles.purchaseLadder}>{chapter.lines!.map((line, i) => <li key={line.dropPct}><span className={styles.ladderDot}>{i + 1 + (Number(chapter.id.split("-").at(-1)) || 0) * 3}</span><div><strong>−{line.dropPct}%</strong><span>{en ? "from reference price" : "基準株価から"}</span></div><b>{bookMoney(line.amount, plan.currency, locale)}</b></li>)}</ol>;
  if (unit.kind === "practiceTitle") return <h3>{chapter.practice!.title}</h3>;
  if (unit.kind === "closing") return <p className={styles.chapterClosing}>{chapter.closing}</p>;
  return null;
 };
 const body = (indexes: number[]) => blocksOf(indexes, units, en).map((block, i) => block.kind === "atom" ? <div key={i} className={b.atom}>{atom(block.unit)}</div>
  : block.kind === "prose" ? <div key={i} className={styles.chapterProse}>{block.paras.map((text, k) => <p key={k}>{text}</p>)}</div>
  : <section key={i} className={`${styles.chapterPractice} ${block.title === null ? b.continued : ""}`}>{block.title !== null ? atom(block.title) : null}{block.items.length ? <ol start={block.start}>{block.items.map((text, k) => <li key={k}>{text}</li>)}</ol> : null}</section>);

 // Measuring: the same markup is built in an invisible page of the same size, a unit at a time; a unit that does not fit
 // starts the next page. A heading is never left alone at the bottom of a page.
 const paginate = useCallback(() => {
  const host = scratch.current, source = sources.current;
  if (!host || !source || !host.clientWidth) return;
  const area = host.querySelector<HTMLElement>("[data-body]");
  if (!area) return;
  const draw = (indexes: number[]) => {
   area.replaceChildren();
   for (const block of blocksOf(indexes, units, en)) {
    if (block.kind === "atom") { const wrap = document.createElement("div"); wrap.className = b.atom; const node = source.querySelector(`[data-atom="${block.unit}"]`)?.firstElementChild; if (node) wrap.append(node.cloneNode(true)); area.append(wrap); continue; }
    if (block.kind === "prose") { const wrap = document.createElement("div"); wrap.className = styles.chapterProse; for (const text of block.paras) { const p = document.createElement("p"); p.textContent = text; wrap.append(p); } area.append(wrap); continue; }
    const section = document.createElement("section"); section.className = `${styles.chapterPractice} ${block.title === null ? b.continued : ""}`;
    if (block.title !== null) { const node = source.querySelector(`[data-atom="${block.title}"]`)?.firstElementChild; if (node) section.append(node.cloneNode(true)); }
    if (block.items.length) { const ol = document.createElement("ol"); ol.start = block.start; for (const text of block.items) { const li = document.createElement("li"); li.textContent = text; ol.append(li); } section.append(ol); }
    area.append(section);
   }
   return area.scrollHeight <= area.clientHeight + 1;
  };
  const next: Page[] = [];
  chapters.forEach((_, chapter) => {
   let current: number[] = [];
   units.forEach((unit, index) => {
    if (unit.chapter !== chapter) return;
    if (draw([...current, index])) { current.push(index); return; }
    const carried: number[] = [];
    while (current.length && ["head", "practiceTitle"].includes(units[current.at(-1)!].kind)) carried.unshift(current.pop()!);
    if (current.length) next.push({ chapter, units: current });
    current = [...carried, index];
   });
   if (current.length) next.push({ chapter, units: current });
  });
  area.replaceChildren();
  setPages(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
 }, [chapters, units, en]);
 // Measuring the laid-out page before the first paint is what a layout effect is for; the pages are set once, not in a loop.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useLayoutEffect(() => { paginate(); }, [paginate]);
 useEffect(() => {
  let alive = true;
  void document.fonts?.ready.then(() => { if (alive) paginate(); });
  const host = scratch.current;
  let width = host?.clientWidth ?? 0;
  const observer = new ResizeObserver(() => { const now = scratch.current?.clientWidth ?? 0; if (Math.abs(now - width) > 1) { width = now; paginate(); } });
  if (host) observer.observe(host);
  return () => { alive = false; observer.disconnect(); };
 }, [paginate]);
 useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

 const go = useCallback((to: number) => {
  if (turn || to < 0 || to > last || to === shown) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setSpread(to); return; }
  setTurn({ from: shown, to });
  timer.current = setTimeout(() => { setSpread(to); setTurn(null); }, TURN_MS);
 }, [turn, last, shown]);
 useEffect(() => {
  const key = (event: KeyboardEvent) => {
   if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
   const target = event.target as HTMLElement | null;
   if (target?.closest("input,textarea,select,[contenteditable=true]")) return;
   if (event.key === "ArrowRight") { event.preventDefault(); go(shown + 1); }
   if (event.key === "ArrowLeft") { event.preventDefault(); go(shown - 1); }
  };
  window.addEventListener("keydown", key);
  return () => window.removeEventListener("keydown", key);
 }, [go, shown]);

 const leftOf = (s: number): Side => s === 0 ? "none" : 2 * s - 1;
 const rightOf = (s: number): Side => s === 0 ? "cover" : 2 * s <= total ? 2 * s : "blank";
 const pad = (n: number) => String(n).padStart(2, "0");
 const page = (side: Side, where: "left" | "right"): ReactNode => {
  if (side === "none") return null;
  if (side === "cover") return <div className={b.cover}><BookCover plan={plan} locale={locale}/></div>;
  const gutter = where === "left" ? b.leftPage : b.rightPage;
  if (side === "blank") return <div className={`${styles.paperPage} ${b.page} ${gutter}`}/>;
  return <div className={`${styles.paperPage} ${b.page} ${gutter}`}>
   <div className={styles.paperRunning}><span>RESOLUTE</span><span>MY RULES</span></div>
   <div className={b.body}>{body(pages[side - 1]?.units ?? [])}</div>
   <footer className={styles.paperFolio}><span>{en ? "A promise to myself" : "自分との約束"}</span><span>{pad(side)}</span></footer>
  </div>;
 };
 const forward = turn ? turn.to > turn.from : false;
 const still = turn ? (forward ? [leftOf(turn.from), rightOf(turn.to)] : [leftOf(turn.to), rightOf(turn.from)]) : [leftOf(shown), rightOf(shown)];
 const leaf = turn ? (forward ? [rightOf(turn.from), leftOf(turn.to)] : [leftOf(turn.from), rightOf(turn.to)]) : null;
 const target = turn?.to ?? shown;
 const inView = new Set([leftOf(target), rightOf(target)].filter((s): s is number => typeof s === "number"));
 const status = shown === 0 ? (en ? "COVER" : "表紙") : 2 * shown <= total ? `${pad(2 * shown - 1)}–${pad(2 * shown)} / ${pad(total)}` : `${pad(2 * shown - 1)} / ${pad(total)}`;
 // The contents: each chapter once (a chapter over two pages is listed at its first page), in the order of rulebook.ts.
 const contents: { group: string; title: string; first: number; pages: number[] }[] = [];
 pages.forEach((p, i) => {
  const group = chapterGroup(chapters[p.chapter]), entry = contents.find(c => c.group === group);
  if (entry) entry.pages.push(i + 1); else contents.push({ group, title: chapters[p.chapter].title, first: i + 1, pages: [i + 1] });
 });
 const closed = turn ? turn.to === 0 : shown === 0;

 return <div className={b.layout}>
  <div className={b.bookColumn}>
   <div ref={bookRef} className={b.book} data-closed={closed} role="region" aria-roledescription={en ? "Book" : "本"} aria-label={en ? "My investing rulebook" : "私の投資ルール"}>
    <div className={`${b.half} ${b.left}`} data-side="left" onClick={() => go(shown - 1)}>{page(still[0], "left")}</div>
    <div className={`${b.half} ${b.right}`} data-side="right" onClick={() => go(shown + 1)}>{page(still[1], "right")}</div>
    {leaf ? <div className={`${b.leaf} ${forward ? b.leafForward : b.leafBack}`} aria-hidden="true">
     <div className={b.face}>{page(leaf[0], forward ? "right" : "left")}</div>
     <div className={`${b.face} ${b.faceBack}`}>{page(leaf[1], forward ? "left" : "right")}</div>
    </div> : null}
    {closed ? null : <div className={b.ribbon} aria-hidden="true"/>}
    <div ref={scratch} className={b.measure} aria-hidden="true"><div className={`${styles.paperPage} ${b.page}`}><div className={styles.paperRunning}><span>RESOLUTE</span><span>MY RULES</span></div><div className={`${b.body} ${b.measureBody}`} data-body/></div></div>
    <div ref={sources} hidden>{units.map((unit, index) => unit.kind === "para" || unit.kind === "step" ? null : <div key={index} data-atom={index}>{atom(index)}</div>)}</div>
   </div>
   <nav className={b.controls} aria-label={en ? "Turn pages" : "ページをめくる"}>
    <button type="button" disabled={shown === 0 || turn !== null} onClick={() => go(shown - 1)} aria-label={en ? "Previous pages" : "前のページ"}>←</button>
    <span role="status" aria-live="polite">{status}</span>
    <button type="button" disabled={shown === last || turn !== null} onClick={() => go(shown + 1)} aria-label={en ? "Next pages" : "次のページ"}>→</button>
   </nav>
  </div>
  <aside className={b.contents} aria-label={en ? "Contents" : "目次"}>
   <h2>{en ? "Contents" : "目次"}</h2>
   <ol>{contents.map(entry => <li key={entry.group}><button type="button" aria-current={entry.pages.some(n => inView.has(n)) ? "page" : undefined} onClick={() => go(Math.ceil(entry.first / 2))}><i>{pad(entry.first)}</i><span>{entry.title}</span></button></li>)}</ol>
   <div className={b.actions}>
    {actions}
    <button type="button" className={styles.secondary} disabled={shown === 0 || turn !== null} onClick={() => go(0)}>{en ? "Back to the cover" : "表紙に戻る"}</button>
   </div>
   {notes}
  </aside>
 </div>;
}
