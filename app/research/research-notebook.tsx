"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { eraseAnnotationRanges, inkColors, markedSegments, maxAnnotations, parseAnnotations, textBlockId, type Annotation, type InkColor, type InkKind, type InkPart } from "@/lib/research/annotations";
import styles from "./research-notebook.module.css";
import { mergeSavedDocuments } from "@/lib/research/saved-document";

function inkStyle(mark: Annotation): CSSProperties {
  const color = inkColors[mark.color];
  if (mark.kind === "highlight") return { backgroundColor: `${color}55`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" };
  if (mark.kind === "box") return {};
  return { textDecoration: "underline", textDecorationColor: color, textDecorationThickness: "2px", textUnderlineOffset: "4px", textDecorationStyle: mark.kind === "note" ? "dotted" : "solid" };
}

// Transform only text we own. Links and interactive children keep their original behavior.
function annotate(nodes: ReactNode, annotations: Annotation[], path = "r", blocks = new Map<string, string>()): ReactNode {
  return Children.map(nodes, (node, index) => {
    const key = `${path}.${index}`;
    if (typeof node === "string" || typeof node === "number") {
      const text = String(node);
      if (!text.trim()) return node;
      const block = textBlockId(key, text);
      blocks.set(block, text);
      return <span data-ink-block={block}>{markedSegments(text, block, annotations).map(segment =>
        <span key={segment.start}>{segment.marks.reduce<ReactNode>((child, mark) => <span data-ink-id={mark.id} data-ink-part={mark.parts.find(part => part.block === block && part.start <= segment.start && part.end > segment.start)?.start} data-ink-split={mark.parts.filter(part => part.block === block).length > 1 ? "true" : undefined} data-ink-kind={mark.kind} data-ink-color={mark.color} style={inkStyle(mark)}>{child}</span>, segment.text)}</span>
      )}</span>;
    }
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;
    if (typeof node.type === "string" && ["a", "button", "input", "textarea", "select", "svg", "script", "style"].includes(node.type)) return node;
    // Fragments are transparent; custom components are left untouched.
    if (typeof node.type !== "string" && typeof node.type !== "symbol") return node;
    return cloneElement(node, {}, annotate(node.props.children, annotations, key, blocks));
  });
}

function selectedParts(root: HTMLElement): InkPart[] {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return [];
  const parts: InkPart[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("[data-ink-block]")) {
    if (!range.intersectsNode(element)) continue;
    const text = element.textContent ?? "";
    let start = 0, end = text.length;
    if (element.contains(range.startContainer)) {
      const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset); start = prefix.toString().length;
    }
    if (element.contains(range.endContainer)) {
      const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(range.endContainer, range.endOffset); end = prefix.toString().length;
    }
    if (end > start && text.slice(start, end).trim()) parts.push({ block: element.dataset.inkBlock!, start, end, quote: text.slice(start, end) });
  }
  return parts.length <= 100 && parts.every(p => p.quote.length <= 10000) ? parts : [];
}

// Measure a whole wrapped passage once, rather than outlining every line fragment.
// The overlay never participates in text layout or native selection.
function drawBoxes(content: HTMLElement) {
  content.querySelectorAll("[data-ink-outline]").forEach(node => node.remove());
  const origin = content.getBoundingClientRect();
  const groups = new Map<string, { left: number; top: number; right: number; bottom: number; color: string }>();
  for (const span of content.querySelectorAll<HTMLElement>('[data-ink-kind="box"]')) {
    const block = span.closest<HTMLElement>("[data-ink-block]");
    const key = `${span.dataset.inkId}:${block?.dataset.inkBlock}:${span.dataset.inkPart}`;
    for (const rect of span.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const fragmentKey = span.dataset.inkSplit ? `${key}:${Math.round(rect.top)}` : key;
      const old = groups.get(fragmentKey);
      groups.set(fragmentKey, { left: Math.min(old?.left ?? rect.left, rect.left), top: Math.min(old?.top ?? rect.top, rect.top), right: Math.max(old?.right ?? rect.right, rect.right), bottom: Math.max(old?.bottom ?? rect.bottom, rect.bottom), color: inkColors[span.dataset.inkColor as InkColor] });
    }
  }
  for (const rect of groups.values()) {
    const box = content.ownerDocument.createElement("span");
    box.dataset.inkOutline = "true";
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, { position: "absolute", pointerEvents: "none", userSelect: "none", boxSizing: "border-box", border: `1.5px solid ${rect.color}`, borderRadius: "3px", left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
    content.append(box);
  }
}

function exportPrint(content: HTMLElement, marks: Annotation[], title: string, lang: string) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  const doc = popup.document;
  doc.documentElement.lang = lang;
  doc.title = `Tech Phase — ${title}`;
  const viewport = doc.createElement("meta");
  viewport.name = "viewport"; viewport.content = "width=device-width, initial-scale=1";
  doc.head.append(viewport);
  const style = doc.createElement("style");
  style.textContent = `*{box-sizing:border-box}body{margin:32px auto;padding:0 24px;max-width:800px;font:18px/1.85 system-ui,sans-serif;color:#182431;background:white}h1,h2,h3,h4{line-height:1.5;break-after:avoid}h2{font-size:24px}h3{font-size:18px}p,li{orphans:3;widows:3}a{color:#245b89;overflow-wrap:anywhere}a[href^="https"]:after{content:" (" attr(href) ")";font-size:10px}table{width:100%;border-collapse:collapse;font-size:16px}th,td{border:1px solid #bbc7ce;padding:6px}dl>div{display:flex;gap:12px}dd{margin:0}small{display:block}svg{display:none}blockquote{margin:10px 0;padding:8px 14px;border-left:3px solid #abc}aside{margin:20px 0;padding:16px;background:#eff6f5;border-radius:8px}button{padding:10px 20px;font-size:16px;cursor:pointer}header{border-bottom:1px solid #ccd8de;margin-bottom:24px}article>div,article>section{margin:18px 0}article>div:first-child{font-size:12px}section{break-inside:auto}article span{print-color-adjust:exact;-webkit-print-color-adjust:exact}@page{margin:12mm}@media print{body{margin:0;padding:0;max-width:none;font-size:14pt}table{font-size:12pt}.print-tools{display:none}}`;
  doc.head.append(style);
  const controls = doc.createElement("aside"); controls.className = "print-tools";
  const hint = doc.createElement("p"); hint.textContent = lang === "ja" ? "印刷画面で「PDFに保存」を選んでください。iPhoneは印刷プレビューを開き、共有から「ファイルに保存」を選べます。" : "Choose Save as PDF in the print dialog. On iPhone, open the print preview, then Share → Save to Files.";
  const button = doc.createElement("button"); button.textContent = lang === "ja" ? "PDF保存・印刷" : "Save PDF / Print"; button.onclick = () => { drawBoxes(article); popup.print(); };
  controls.append(hint, button); doc.body.append(controls);
  const header = doc.createElement("header"); header.textContent = "TECH PHASE RESEARCH"; doc.body.append(header);
  const article = doc.createElement("article"); article.style.position = "relative";
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-ink-outline]").forEach(element => element.remove());
  clone.querySelectorAll("[class]").forEach(element => element.removeAttribute("class"));
  article.append(...Array.from(clone.childNodes)); doc.body.append(article);
  if (marks.some(mark => mark.note)) {
    const heading = doc.createElement("h2"); heading.textContent = lang === "ja" ? "自分のメモ" : "My notes"; doc.body.append(heading);
    for (const mark of marks.filter(mark => mark.note)) {
      const note = doc.createElement("section");
      const quote = doc.createElement("blockquote"); quote.textContent = mark.parts.map(p => p.quote).join(" "); quote.style.borderColor = inkColors[mark.color];
      const body = doc.createElement("p"); body.textContent = mark.note; body.style.whiteSpace = "pre-wrap"; body.style.borderLeft = `3px solid ${inkColors[mark.color]}`; body.style.paddingLeft = "14px";
      note.append(quote, body); doc.body.append(note);
    }
  }
  drawBoxes(article);
  popup.addEventListener("resize", () => drawBoxes(article));
  popup.addEventListener("beforeprint", () => drawBoxes(article));
  return true;
}

export default function ResearchNotebook({ lang, title, enabled, children, raw, onCommit, editable }: { raw: string; onCommit: (raw: string, marks: Annotation[]) => boolean; editable: boolean; lang: "ja" | "en"; title: string; enabled: boolean; children: ReactNode }) {
  const marks = useMemo(() => parseAnnotations(raw), [raw]);
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(true);
  const [color, setColor] = useState<InkColor>("yellow");
  const [selection, setSelection] = useState<InkPart[]>([]);
  const [draft, setDraft] = useState<{ id?: string; original?: string; parts: InkPart[]; text: string } | null>(null);
  const [history, setHistory] = useState<{ before: Annotation[]; after: Annotation[] }[]>([]);
  const [error, setError] = useState("");
  const draftConflict = Boolean(draft?.id && JSON.stringify(marks.find(mark => mark.id === draft.id)) !== draft.original);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDetailsElement>(null);
  const notesList = useRef<HTMLElement>(null);
  const notes = marks.filter(mark => mark.kind === "note");
  const inkMarks = marks.filter(mark => mark.kind !== "note");
  const savedRange = useRef<Range | null>(null);
  const toolPointer = useRef(false);
  const [activeMark, setActiveMark] = useState<string | null>(null);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const labels: Record<InkKind, string> = { underline: t("下線", "Underline"), highlight: t("蛍光ペン", "Highlight"), box: t("囲み", "Box"), note: t("メモ", "Note") };

  useEffect(() => {
    if (!enabled) return;
    // Let native selection handles finish moving before reading the whole article.
    let timer: ReturnType<typeof setTimeout>;
    const capture = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!root.current || toolPointer.current) return;
        const parts = selectedParts(root.current);
        if (parts.length) {
          savedRange.current = window.getSelection()!.getRangeAt(0).cloneRange();
          setSelection(previous => JSON.stringify(previous) === JSON.stringify(parts) ? previous : parts);
          setEditing(true);
          setActiveMark(null);
        }
        else if (savedRange.current) {
          savedRange.current = null;
          setSelection([]);
          // A note draft survives moving focus from the passage to its textarea.
          if (!draft) { setEditing(false); setActiveMark(null); }
        }
      }, 120);
    };
    const closeForMenu = () => { clearTimeout(timer); savedRange.current = null; window.getSelection()?.removeAllRanges(); setSelection([]); setEditing(false); setActiveMark(null); };
    window.addEventListener("tech-phase:menu-open", closeForMenu);
    document.addEventListener("selectionchange", capture);
    return () => { clearTimeout(timer); window.removeEventListener("tech-phase:menu-open", closeForMenu); document.removeEventListener("selectionchange", capture); };
  }, [enabled, draft]);

  function restoreSelection() {
    const range = savedRange.current;
    if (!range || !root.current?.contains(range.startContainer) || !root.current.contains(range.endContainer)) return;
    const native = window.getSelection(); native?.removeAllRanges(); native?.addRange(range.cloneRange());
    setSelection(selectedParts(root.current));
  }
  function clearSelection() {
    savedRange.current = null;
    setSelection([]);
    window.getSelection()?.removeAllRanges();
  }
  function commit(next: Annotation[], undo = false) {
    if (next.some(mark => mark.parts.length > 100)) { setError(t("細かな書き込みが多すぎます。書き込みを管理から整理してください。", "Too many fragments. Remove an annotation from Manage marks first.")); return false; }
    try {
      if (!editable || !onCommit(raw, next)) { setError(t("保存できませんでした。同期状態を確認して、もう一度お試しください。", "Could not save. Check sync status and try again.")); return false; }
      if (!undo) setHistory(previous => [...previous.slice(-29), { before: marks, after: next }]);
      setError(""); return true;
    } catch { setError(t("書き込みを保存できませんでした。ブラウザーの保存設定や空き容量を確認してください。", "Could not save. Check browser storage permissions and available space.")); return false; }
  }
  function add(kind: InkKind) {
    if (!selection.length) return;
    if (kind === "note") { setDraft({ parts: selection, text: "" }); return; }
    if (marks.length >= maxAnnotations) { setError(t("1記事の書き込みは200件までです。", "Up to 200 annotations per article.")); return; }
    // One rectangular box per text block keeps adjacent/nested outlines from colliding.
    const retained = kind === "box" ? marks.flatMap(mark => {
      if (mark.kind !== "box") return [mark];
      const parts = mark.parts.filter(part => !selection.some(selected => selected.block === part.block));
      return parts.length ? [{ ...mark, parts }] : [];
    }) : marks;
    if (commit([...retained, { id: crypto.randomUUID(), kind, color, parts: selection, note: "" }])) { clearSelection(); }
  }
  // Tool/color/selection state must not rebuild the text DOM under native selection.
  const { rendered, presentMarks } = useMemo(() => {
    const blocks = new Map<string, string>();
    const rendered = enabled ? annotate(children, visible ? marks : [], "r", blocks) : children;
    return { rendered, presentMarks: marks.filter(mark => mark.parts.every(part => blocks.get(part.block)?.slice(part.start, part.end) === part.quote)) };
  }, [children, enabled, visible, marks]);
  useEffect(() => {
    const content = root.current;
    if (!content || !enabled) return;
    const redraw = () => drawBoxes(content);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(content);
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) redraw(); });
    return () => { cancelled = true; observer.disconnect(); content.querySelectorAll("[data-ink-outline]").forEach(node => node.remove()); };
  }, [rendered, enabled]);
  const removable = marks.filter(mark => mark.id === activeMark || mark.parts.some(part => selection.some(selected => selected.block === part.block && selected.start < part.end && selected.end > part.start)));
  function selectLine() {
    const content = root.current;
    const block = content && Array.from(content.querySelectorAll<HTMLElement>("[data-ink-block]")).find(el => el.dataset.inkBlock === selection[0]?.block);
    if (!block || !content) return;
    // Use rendered glyph positions, not paragraph boundaries or guessed character counts.
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const glyphs: { node: Text; start: number; end: number; offset: number; rect: DOMRect }[] = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (const glyph of new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(node.data)) {
        const range = document.createRange();
        range.setStart(node, glyph.index); range.setEnd(node, glyph.index + glyph.segment.length);
        // A wrapped glyph may expose a zero-width caret on the preceding line.
        const rect = Array.from(range.getClientRects()).filter(rect => rect.width > 0.1 && rect.height > 0).at(-1);
        if (rect && rect.width && rect.height) glyphs.push({ node, start: glyph.index, end: glyph.index + glyph.segment.length, offset: offset + glyph.index, rect });
      }
      offset += node.length;
    }
    const anchor = glyphs.find(glyph => glyph.offset >= selection[0].start);
    if (!anchor) return;
    const center = anchor.rect.top + anchor.rect.height / 2;
    const sameLine = (glyph: typeof anchor) => Math.abs(glyph.rect.top + glyph.rect.height / 2 - center) < Math.min(anchor.rect.height, glyph.rect.height) * 0.4;
    const anchorIndex = glyphs.indexOf(anchor);
    let first = anchorIndex, last = anchorIndex;
    while (first > 0 && sameLine(glyphs[first - 1])) first--;
    while (last + 1 < glyphs.length && sameLine(glyphs[last + 1])) last++;
    const line = glyphs.slice(first, last + 1);
    if (!line.length) return;
    const range = document.createRange();
    range.setStart(line[0].node, line[0].start); range.setEnd(line.at(-1)!.node, line.at(-1)!.end);
    savedRange.current = range;
    restoreSelection();
  }
  function currentMarks() {
    const blocks = new Map(Array.from(root.current?.querySelectorAll<HTMLElement>("[data-ink-block]") ?? []).map(el => [el.dataset.inkBlock!, el.textContent ?? ""]));
    return marks.filter(mark => mark.parts.every(part => blocks.get(part.block)?.slice(part.start, part.end) === part.quote));
  }
  return <div className={styles.notebook} data-enabled={enabled}>
    {enabled && <div className={styles.controls}>
      <div className={styles.actions}>
        <button className={styles.writeAction} aria-pressed={editing} onClick={() => { setEditing(!editing); clearSelection(); setDraft(null); }}>{t("書き込む", "Annotate")}<svg className={styles.actionIcon} aria-hidden="true" viewBox="0 0 24 24"><path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5M4 15l5 5" /></svg></button>
        <button onClick={() => { if (root.current && !exportPrint(root.current, visible ? currentMarks() : [], title, lang)) setError(t("印刷用画面を開けません。ポップアップの設定を確認してください。", "Allow pop-ups to open the print view.")); }}>{t("PDF保存", "Save PDF")}<svg className={styles.actionIcon} aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5" /></svg></button>
        {marks.length > 0 && <details className={styles.moreActions}>
          <summary>{t("その他", "More")} <span aria-hidden="true">⋯</span></summary>
          <div>
            {notes.length > 0 && <button onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); notesList.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{t("メモへ移動", "Go to notes")}</button>}
            {inkMarks.length > 0 && <button onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); if (list.current) { list.current.open = true; list.current.scrollIntoView({ behavior: "smooth", block: "start" }); } }}>{t("書き込みを管理", "Manage marks")}</button>}
            <button aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? t("書き込みを隠す", "Hide marks") : t("書き込みを表示", "Show marks")}</button>
          </div>
        </details>}
      </div>
      {editing && <div className={styles.editor} onPointerDown={event => {
        if (!(event.target as HTMLElement).closest("button")) return;
        toolPointer.current = true;
        const parts = root.current && selectedParts(root.current);
        if (parts?.length) { savedRange.current = window.getSelection()!.getRangeAt(0).cloneRange(); setSelection(parts); }
        // Touch as well as mouse: do not transfer focus away from the article selection.
        event.preventDefault();
      }} onPointerUp={() => { toolPointer.current = false; }} onPointerCancel={() => { toolPointer.current = false; }}>
        <div className={styles.palette}>
          <div className={styles.colors} aria-label={t("書き込みの色", "Ink color")}>{(["red", "yellow", "blue"] as const).map(value => <button key={value} aria-label={{ red: t("赤", "Red"), yellow: t("黄", "Yellow"), blue: t("青", "Blue") }[value]} aria-pressed={color === value} style={{ "--ink": inkColors[value] } as CSSProperties} onClick={() => { setColor(value); restoreSelection(); }}><span />{color === value && <b aria-hidden="true">✓</b>}</button>)}</div>
          <button disabled={!selection.length} onClick={selectLine}>{t("この1行を選択", "Select this line")}</button>
          <button className={styles.done} onClick={() => { setEditing(false); setSelection([]); setDraft(null); setActiveMark(null); clearSelection(); }}>{t("完了", "Done")}</button>
        </div>
        <div className={styles.tools}>
          {(Object.keys(labels) as InkKind[]).map(kind => <button key={kind} disabled={!selection.length} onClick={() => add(kind)}><span className={styles.toolIcon} aria-hidden="true">{kind === "underline" ? <svg viewBox="0 0 24 24"><path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16" /></svg> : kind === "highlight" ? <svg viewBox="0 0 24 24"><path d="m8 16 8-12 5 4-9 11-4-3ZM8 16l-4 5h8M3 22h18" /></svg> : kind === "box" ? <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /></svg> : <svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" /></svg>}</span><span>{labels[kind]}</span></button>)}
        </div>
        <div className={styles.utilities}>
          <button disabled={!removable.length} onClick={() => { if (commit(selection.length ? eraseAnnotationRanges(marks, selection) : marks.filter(mark => mark.id !== activeMark))) { setActiveMark(null); clearSelection(); } }}>{selection.length ? t("選択部分を消す", "Erase selection") : t("この書き込みを削除", "Delete this mark")}</button>
          <button disabled={!history.length} onClick={() => { const previous = history.at(-1); if (!previous) return; const wrap = (items: Annotation[]) => ({ saved: [], notebooks: { "undo:ja": items } }); const merged = mergeSavedDocuments(wrap(previous.after), wrap(previous.before), wrap(marks)); if (!merged) { setError(t("別の端末で変更された書き込みは元に戻せません。", "Cannot undo an annotation changed on another device.")); return; } if (commit(merged.notebooks["undo:ja"] ?? [], true)) setHistory(history.slice(0, -1)); }}>{t("元に戻す", "Undo")}</button>
        </div>
        <p className={styles.selected}>{selection.length ? selection.map(p => p.quote).join(" ").slice(0, 100) : "\u00a0"}</p>
        {draft && <form onSubmit={event => { event.preventDefault(); if (!draft.text.trim()) return; const next = draft.id && !draftConflict ? marks.map(mark => mark.id === draft.id ? { ...mark, note: draft.text.trim(), color } : mark) : [...marks, { id: crypto.randomUUID(), kind: "note" as const, color, parts: draft.parts, note: draft.text.trim() }]; if (next.length > maxAnnotations) { setError(t("1記事の書き込みは200件までです。", "Up to 200 annotations per article.")); return; } if (commit(next)) { setDraft(null); clearSelection(); } }}>
          {draftConflict && <p>{t("元のメモが更新されました。別のメモとして残せます。", "The original note changed. You can save this as a separate note.")}</p>}
          <textarea aria-label={t("自分のメモ", "My note")} placeholder={t("気づいたことを書き残す", "Write down your thoughts")} maxLength={1000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} />
          <button type="submit" disabled={!draft.text.trim()}>{draftConflict ? t("別のメモとして保存", "Save as a separate note") : t("メモを保存", "Save note")}</button><button type="button" onClick={() => setDraft(null)}>{t("キャンセル", "Cancel")}</button>
        </form>}
      </div>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>}
    <div ref={root} className={styles.content} onClick={event => {
      if (!enabled || !window.getSelection()?.isCollapsed) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-ink-id]")?.dataset.inkId;
      if (id) { savedRange.current = null; setActiveMark(id); setSelection([]); setDraft(null); setEditing(true); }
    }}>{rendered}</div>
    {enabled && notes.length > 0 && <section ref={notesList} className={styles.notesList} aria-label={t("自分のメモ", "My notes")}>
      <h3>{t("自分のメモ", "My notes")} <span>{notes.length}</span></h3>
      {presentMarks.filter(mark => mark.kind === "note").map(mark => <div key={mark.id} className={`${styles.markItem} ${styles.noteItem}`} style={{ borderLeftColor: inkColors[mark.color] }}>
        <p>{mark.note}</p>
        <blockquote className={styles.noteQuote}><span>{t("メモした箇所", "Referenced passage")}</span>{mark.parts.map(p => p.quote).join(" ")}</blockquote>
        <div><button onClick={() => { clearSelection(); setEditing(true); setColor(mark.color); setDraft({ id: mark.id, original: JSON.stringify(mark), parts: mark.parts, text: mark.note }); }}>{t("編集", "Edit")}</button><button onClick={() => commit(marks.filter(a => a.id !== mark.id))}>{t("削除", "Delete")}</button></div>
      </div>)}
      {notes.length > presentMarks.filter(mark => mark.kind === "note").length && <p>{t("本文が更新された箇所のメモは非表示になっています。", "Notes on changed passages are hidden.")}</p>}
    </section>}
    {enabled && inkMarks.length > 0 && <details ref={list} className={styles.markList}>
      <summary>{t("下線・蛍光ペン・囲み", "Underlines, highlights & boxes")} <span>{inkMarks.length}</span></summary>
      <p>{t("記事が更新された箇所の書き込みは非表示になります。", "Marks on changed passages are hidden.")}</p>
      {presentMarks.filter(mark => mark.kind !== "note").map(mark => <div key={mark.id} className={styles.markItem} style={{ borderLeftColor: inkColors[mark.color] }}>
        <span>{labels[mark.kind]}</span><blockquote>{mark.parts.map(p => p.quote).join(" ")}</blockquote>
        <div><button onClick={() => commit(marks.filter(a => a.id !== mark.id))}>{t("削除", "Delete")}</button></div>
      </div>)}
    </details>}
  </div>;
}
