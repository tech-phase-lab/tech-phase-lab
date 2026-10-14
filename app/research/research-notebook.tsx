"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { inkColors, markedSegments, maxAnnotations, parseAnnotations, textBlockId, type Annotation, type InkColor, type InkKind, type InkPart } from "@/lib/research/annotations";
import styles from "./research-notebook.module.css";

const changed = "tech-phase:annotations-changed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changed, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); };
}

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
        <span key={segment.start}>{segment.marks.reduce<ReactNode>((child, mark) => <span data-ink-id={mark.id} data-ink-kind={mark.kind} data-ink-color={mark.color} style={inkStyle(mark)}>{child}</span>, segment.text)}</span>
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
    const key = `${span.dataset.inkId}:${block?.dataset.inkBlock}`;
    for (const rect of span.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const old = groups.get(key);
      groups.set(key, { left: Math.min(old?.left ?? rect.left, rect.left), top: Math.min(old?.top ?? rect.top, rect.top), right: Math.max(old?.right ?? rect.right, rect.right), bottom: Math.max(old?.bottom ?? rect.bottom, rect.bottom), color: inkColors[span.dataset.inkColor as InkColor] });
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
  const style = doc.createElement("style");
  style.textContent = `*{box-sizing:border-box}body{margin:32px auto;padding:0 24px;max-width:800px;font:15px/1.85 system-ui,sans-serif;color:#182431;background:white}h1,h2,h3,h4{line-height:1.5;break-after:avoid}h2{font-size:24px}h3{font-size:18px}p,li{orphans:3;widows:3}a{color:#245b89;overflow-wrap:anywhere}a[href^="https"]:after{content:" (" attr(href) ")";font-size:10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bbc7ce;padding:6px}dl>div{display:flex;gap:12px}dd{margin:0}small{display:block}svg{display:none}blockquote{margin:10px 0;padding:8px 14px;border-left:3px solid #abc}aside{margin:20px 0;padding:16px;background:#eff6f5;border-radius:8px}button{padding:10px 20px;font-size:16px;cursor:pointer}header{border-bottom:1px solid #ccd8de;margin-bottom:24px}article>div,article>section{margin:18px 0}article>div:first-child{font-size:12px}section{break-inside:auto}article span{print-color-adjust:exact;-webkit-print-color-adjust:exact}@page{margin:16mm}@media print{body{margin:0;padding:0;max-width:none}.print-tools{display:none}}`;
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

export default function ResearchNotebook({ articleId, lang, title, enabled, children }: { articleId: string; lang: "ja" | "en"; title: string; enabled: boolean; children: ReactNode }) {
  const storageKey = `tech-phase:annotations:v1:${encodeURIComponent(articleId)}:${lang}`;
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(storageKey) ?? "[]"; } catch { return "[]"; } }, () => "[]");
  const marks = useMemo(() => parseAnnotations(raw), [raw]);
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(true);
  const [color, setColor] = useState<InkColor>("yellow");
  const [selection, setSelection] = useState<InkPart[]>([]);
  const [draft, setDraft] = useState<{ id?: string; parts: InkPart[]; text: string } | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDetailsElement>(null);
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
        if (!root.current) return;
        const parts = selectedParts(root.current);
        if (parts.length) {
          setSelection(previous => JSON.stringify(previous) === JSON.stringify(parts) ? previous : parts);
          setEditing(true);
          setActiveMark(null);
        }
        else if (root.current.contains(document.activeElement) || window.getSelection()?.anchorNode && root.current.contains(window.getSelection()!.anchorNode)) setSelection([]);
      }, 120);
    };
    document.addEventListener("selectionchange", capture);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", capture); };
  }, [enabled]);

  function commit(next: Annotation[], undo = false) {
    try {
      // Never overwrite a change made in another tab while this view was stale.
      if ((localStorage.getItem(storageKey) ?? "[]") !== raw) { window.dispatchEvent(new Event(changed)); setError(t("別の画面で更新されました。もう一度操作してください。", "Updated in another tab. Please try again.")); return false; }
      localStorage.setItem(storageKey, JSON.stringify(next));
      if (!undo) setHistory(previous => [...previous.slice(-29), marks]);
      window.dispatchEvent(new Event(changed)); setError(""); return true;
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
    if (commit([...retained, { id: crypto.randomUUID(), kind, color, parts: selection, note: "" }])) { setSelection([]); window.getSelection()?.removeAllRanges(); }
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
  function selectParagraph() {
    const block = root.current && Array.from(root.current.querySelectorAll<HTMLElement>("[data-ink-block]")).find(el => el.dataset.inkBlock === selection[0]?.block);
    if (!block) return;
    const paragraph = block.closest("p, li, h2, h3, h4, dd, dt, blockquote") ?? block;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const native = window.getSelection(); native?.removeAllRanges(); native?.addRange(range);
    setSelection(selectedParts(root.current!));
  }
  function currentMarks() {
    const blocks = new Map(Array.from(root.current?.querySelectorAll<HTMLElement>("[data-ink-block]") ?? []).map(el => [el.dataset.inkBlock!, el.textContent ?? ""]));
    return marks.filter(mark => mark.parts.every(part => blocks.get(part.block)?.slice(part.start, part.end) === part.quote));
  }
  return <div className={styles.notebook} data-enabled={enabled}>
    {enabled && <div className={styles.controls}>
      <div className={styles.actions}>
        <button aria-pressed={editing} onClick={() => { setEditing(!editing); setSelection([]); setDraft(null); }}>{t("ペンツール", "Pen tools")}</button>
        {marks.length > 0 && <button onClick={() => { if (list.current) { list.current.open = true; list.current.scrollIntoView({ behavior: "smooth", block: "start" }); } }}>{t("書き込みを管理", "Manage marks")} ({marks.length})</button>}
        {marks.length > 0 && <button aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? t("書き込みを隠す", "Hide marks") : t("書き込みを表示", "Show marks")}</button>}
        <button onClick={() => { if (root.current && !exportPrint(root.current, visible ? currentMarks() : [], title, lang)) setError(t("印刷用画面を開けません。ポップアップの設定を確認してください。", "Allow pop-ups to open the print view.")); }}>{t("PDF保存", "Save PDF")}</button>
      </div>
      {editing && <div className={styles.editor} onPointerDown={event => { if (event.pointerType === "mouse" && (event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
        <p>{selection.length ? t("選択した文章に書き込む", "Annotate selected text") : activeMark ? t("選んだ書き込みを消せます", "Erase the selected annotation") : t("長押しで選択 · 書き込みをタップで削除", "Select text · Tap a mark to erase")}</p>
        <button className={styles.done} onClick={() => { setEditing(false); setSelection([]); setDraft(null); setActiveMark(null); window.getSelection()?.removeAllRanges(); }}>{t("完了", "Done")}</button>
        <div className={styles.palette}>
          <div className={styles.colors} aria-label={t("書き込みの色", "Ink color")}>{(["red", "yellow", "blue"] as const).map(value => <button key={value} aria-label={{ red: t("赤", "Red"), yellow: t("黄", "Yellow"), blue: t("青", "Blue") }[value]} aria-pressed={color === value} style={{ "--ink": inkColors[value] } as CSSProperties} onClick={() => setColor(value)}><span />{color === value && <b aria-hidden="true">✓</b>}</button>)}</div>
          <button disabled={!selection.length} onClick={selectParagraph}>{t("段落全体", "Whole paragraph")}</button>
        </div>
        <div className={styles.tools}>
          {(Object.keys(labels) as InkKind[]).map(kind => <button key={kind} disabled={!selection.length} onClick={() => add(kind)}>{labels[kind]}</button>)}
        </div>
        <div className={styles.utilities}>
          <button disabled={!removable.length} onClick={() => { if (commit(marks.filter(mark => !removable.some(item => item.id === mark.id)))) { setActiveMark(null); setSelection([]); window.getSelection()?.removeAllRanges(); } }}>{t("書き込みを消す", "Erase marks")}{removable.length ? ` (${removable.length})` : ""}</button>
          <button disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous && commit(previous, true)) setHistory(history.slice(0, -1)); }}>{t("元に戻す", "Undo")}</button>
        </div>
        <p className={styles.selected}>{selection.length ? selection.map(p => p.quote).join(" ").slice(0, 100) : "\u00a0"}</p>
        {draft && <form onSubmit={event => { event.preventDefault(); if (!draft.text.trim()) return; const next = draft.id ? marks.map(mark => mark.id === draft.id ? { ...mark, note: draft.text.trim(), color } : mark) : [...marks, { id: crypto.randomUUID(), kind: "note" as const, color, parts: draft.parts, note: draft.text.trim() }]; if (next.length > maxAnnotations) { setError(t("1記事の書き込みは200件までです。", "Up to 200 annotations per article.")); return; } if (commit(next)) { setDraft(null); setSelection([]); window.getSelection()?.removeAllRanges(); } }}>
          <textarea aria-label={t("自分のメモ", "My note")} placeholder={t("気づいたことを書き残す", "Write down your thoughts")} maxLength={1000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} />
          <button type="submit" disabled={!draft.text.trim()}>{t("メモを保存", "Save note")}</button><button type="button" onClick={() => setDraft(null)}>{t("キャンセル", "Cancel")}</button>
        </form>}
      </div>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>}
    <div ref={root} className={styles.content} onClick={event => {
      if (!enabled || !window.getSelection()?.isCollapsed) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-ink-id]")?.dataset.inkId;
      if (id) { setActiveMark(id); setSelection([]); setDraft(null); setEditing(true); }
    }}>{rendered}</div>
    {enabled && marks.length > 0 && <details ref={list} className={styles.markList}>
      <summary>{t("書き込み", "Annotations")} <span>{marks.length}</span></summary>
      <p>{t("このブラウザーに保存。記事が更新された箇所の書き込みは非表示になります。", "Saved in this browser. Marks on changed passages are hidden.")}</p>
      {presentMarks.length < marks.length && <p>{t(`${marks.length - presentMarks.length}件は現在の本文と一致しないため表示していません。`, `${marks.length - presentMarks.length} annotations no longer match the visible article.`)}</p>}
      {presentMarks.map(mark => <div key={mark.id} className={styles.markItem} style={{ borderLeftColor: inkColors[mark.color] }}>
        <span>{labels[mark.kind]}</span><blockquote>{mark.parts.map(p => p.quote).join(" ")}</blockquote>
        {mark.note && <p>{mark.note}</p>}
        <div>{mark.kind === "note" && <button onClick={() => { setEditing(true); setColor(mark.color); setDraft({ id: mark.id, parts: mark.parts, text: mark.note }); }}>{t("編集", "Edit")}</button>}<button onClick={() => commit(marks.filter(a => a.id !== mark.id))}>{t("削除", "Delete")}</button></div>
      </div>)}
    </details>}
  </div>;
}
