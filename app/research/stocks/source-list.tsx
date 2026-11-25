"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import styles from "./source-list.module.css";

/** One company line under a source: name, tag (供給・提携・出資…) and its one-line description. */
export type SourceRow = { who: string; tone: string; tag: string; text: string };
/** One document and one quote, shown once, with every company it backs (owner, Nov 25). */
export type SourceBlock = { url: string; label: string; press?: boolean; date?: string; dateKind?: "published" | "checked"; quote?: string; notes: string[]; rows: SourceRow[] };
export type SourceInput = Omit<SourceBlock, "notes" | "rows"> & { note?: string; row?: SourceRow };

/** The one note at the bottom of the stock page (owner, Nov 25): it replaces the map's own note and the old footer line. */
export const SOURCES_NOTE = {
  ja: "公式資料で確認できた関係だけを載せています。SECは名簿の正確性や網羅性を保証していません。売買を勧めるものではありません。",
  en: "Only relationships confirmed in official materials are listed. The SEC does not guarantee the accuracy or completeness of its directory. This is not a recommendation to buy or sell.",
} as const;

/** 「報道」 / "Media report" marks a press source, unless its name already says so (「SiliconANGLE の報道 報道」, owner Nov 25). */
export function needsPressMark(label: string, lang: "ja" | "en") {
  return lang === "ja" ? !label.includes("報道") : !/\breport\b/i.test(label);
}

/** The same document with the same quote (and date) becomes one block; a different quote is its own block. Order of first appearance is kept. */
export function groupSources(items: SourceInput[]): SourceBlock[] {
  const blocks = new Map<string, SourceBlock>();
  for (const { note, row, ...source } of items) {
    const key = [source.url, source.quote ?? "", source.date ?? ""].join("\n");
    let block = blocks.get(key);
    if (!block) blocks.set(key, block = { ...source, notes: [], rows: [] });
    block.press ||= source.press;
    if (note && !block.notes.includes(note)) block.notes.push(note);
    if (row && !block.rows.some(other => other.who === row.who && other.tag === row.tag && other.text === row.text)) block.rows.push(row);
  }
  return [...blocks.values()];
}

const slash = (date: string) => date.replace(/-/g, "/");
/** Width of a company name in monospace columns (full-width characters count twice). */
const columns = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);

/** One closed 「▸ 出典 N件」 with 「確認日」 small at the right; N counts the blocks. */
export function SourceList({ blocks, lang, reviewedOn }: { blocks: SourceBlock[]; lang: "ja" | "en"; reviewedOn?: string }) {
  const ja = lang === "ja";
  if (!blocks.length && !reviewedOn) return null;
  // One name width for every block, so tags and descriptions start at the same place all the way down (long names wrap instead).
  const who = Math.min(14, Math.max(4, ...blocks.flatMap(block => block.rows.map(row => columns(row.who)))));
  return <details className={styles.sources} data-chain-sources="">
    <summary><span className={styles.title}>{ja ? "出典" : "Sources"} <span className={styles.count}>{ja ? `${blocks.length}件` : blocks.length}</span></span>
      {reviewedOn && <small className={styles.reviewed}>{ja ? "確認日" : "Reviewed"} <time dateTime={reviewedOn}>{slash(reviewedOn)}</time></small>}</summary>
    {blocks.length > 0 && <ol style={{ "--who": who } as CSSProperties}>{blocks.map((block, index) => <li key={index} className={styles.block}>
      <p className={styles.doc}><a href={block.url} target="_blank" rel="noopener noreferrer">{block.label}</a>{block.press && <> <em>{ja ? "報道" : "Media report"}</em></>}
        {block.date && <small>{block.dateKind === "checked" ? ja ? "確認日" : "Reviewed" : ja ? "発表日" : "Published"} <time dateTime={block.date}>{slash(block.date)}</time></small>}</p>
      {block.quote && <q lang="en">{block.quote}</q>}
      {block.notes.map(note => <p key={note} className={styles.note}>{note}</p>)}
      {block.rows.length > 0 && <div className={styles.rows} role="list">{block.rows.map((row, at) => <div key={at} role="listitem" className={styles.row}>
        <b>{row.who}</b><span className={styles.tg} data-tone={row.tone}>{row.tag}</span><span className={styles.text}>{row.text}</span>
      </div>)}</div>}
    </li>)}</ol>}
  </details>;
}

type Slot = (blocks: SourceBlock[] | null) => void;
const SourcesSlot = createContext<Slot | null>(null);

/** A map inside <MergedSources> hands its blocks up instead of drawing its own 「出典」 and note; elsewhere (the PRO tour) it draws both itself. */
export function useSourcesSlot(blocks: SourceBlock[]) {
  const slot = useContext(SourcesSlot);
  useEffect(() => {
    if (!slot) return;
    slot(blocks);
    return () => slot(null);
  }, [slot, blocks]);
  return slot !== null;
}

/** The stock page's one 「出典」: the relationship map's blocks first, then the company profile's own sources, and the profile's 確認日 in the heading.
 * `note`: the one note below it, for pages without the stock search footer that already carries it. */
export function MergedSources({ children, lang, reviewedOn, extra = [], note = false }: { children: ReactNode; lang: "ja" | "en"; reviewedOn?: string; extra?: SourceBlock[]; note?: boolean }) {
  const [mapBlocks, setMapBlocks] = useState<SourceBlock[]>([]);
  const slot = useCallback<Slot>(blocks => setMapBlocks(blocks ?? []), []);
  return <SourcesSlot.Provider value={slot}>
    {children}
    {/* A profile source the map already links (same address) is not listed twice. */}
    <SourceList blocks={[...mapBlocks, ...extra.filter(block => !mapBlocks.some(shown => shown.url === block.url))]} lang={lang} reviewedOn={reviewedOn} />
    {note && <p className={styles.footnote}>{lang === "ja" ? SOURCES_NOTE.ja : SOURCES_NOTE.en}</p>}
  </SourcesSlot.Provider>;
}
