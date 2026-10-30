import { inkColors, type Annotation } from "./annotations";
import { createNotebookPdf, type PdfBlock, type PdfRun, type PdfMark, type FontSubset } from "./notebook-pdf";

export function notebookPdfBlocks(root: HTMLElement, notes: Annotation[], lang: string): PdfBlock[] {
  const blocks: PdfBlock[] = []; let pending: PdfRun[] = [];
  let size = 12; let indent = 0;
  const flush = () => { if (pending.some(r => r.text.trim() || r.memo)) blocks.push({ runs: pending, size, indent }); pending = []; };
  // Each note gets its number in the order its marker appears; its text is set in a box at the foot of that page.
  const memoNumber = new Map<string, number>();
  const collect = (nodes: Iterable<Node>, marks: PdfMark[], href?: string) => { const keep = pending; pending = []; for (const child of nodes) walk(child, marks, href); const runs = pending; pending = keep; return runs; };
  const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  function walk(node: Node, marks: PdfMark[] = [], href?: string) {
    if (node.nodeType === 3) { pending.push({ text: node.textContent ?? "", marks, href }); return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.hidden || node.hasAttribute("data-ink-outline") || node.getAttribute("aria-hidden") === "true" || ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "SCRIPT", "STYLE"].includes(node.tagName)) return;
    const markId = node.dataset.inkId;
    if (markId) {
      const color = inkColors[node.dataset.inkColor as keyof typeof inkColors];
      if (color) marks = [...marks, { id: `${markId}:${node.dataset.inkPart ?? ""}`, kind: node.dataset.inkKind ?? "", color }];
    }
    const layout = node.dataset.pdf;
    if (layout === "meta") { flush(); const [first, ...rest] = [...node.children].map(child => text(child)); blocks.push({ kind: "meta", runs: [{ text: first ?? "" }], right: [{ text: rest.join(" ") }] }); return; }
    if (layout === "company") { flush(); blocks.push({ kind: "company", runs: collect(node.childNodes, marks) }); return; }
    if (layout === "title") { flush(); blocks.push({ kind: "title", runs: collect(node.childNodes, marks) }); return; }
    if (layout === "facts") {
      flush();
      const items = [...node.children].map(row => ({ label: [{ text: text(row.querySelector("dt")) }], value: collect(row.querySelector("dd")?.childNodes ?? [], marks).map(run => ({ ...run, text: run.text.replace(/\s+/g, " ") })) })).filter(item => /^(発表日|取得日|Announced|Detected)$/.test(item.label[0].text));
      if (items.length) blocks.push({ kind: "facts", runs: [], items });
      return;
    }
    if (layout === "metrics") {
      flush();
      const items = [...node.children].map(card => {
        const [label, ...rest] = [...card.children].filter(child => !(child instanceof HTMLElement && child.hasAttribute("data-ink-outline"))).map(child => text(child)).filter(Boolean);
        return { label: [{ text: label ?? "" }], value: [{ text: rest.join("\n") }] };
      }).filter(item => item.label[0].text);
      if (items.length) blocks.push({ kind: "facts", runs: [], items });
      return;
    }
    if (layout === "change") { flush(); blocks.push({ kind: "change", runs: collect(node.querySelector("p")?.childNodes ?? [], marks), label: [{ text: text(node.querySelector("span")) }] }); return; }
    if (layout === "section") {
      flush();
      const number = text(node.querySelector("[data-pdf-number]"));
      const rest = [...node.childNodes].filter(child => !(child instanceof HTMLElement && (child.hasAttribute("data-pdf-number") || child.tagName === "SMALL")));
      blocks.push({ kind: "section", size: 14, runs: [...(number ? [{ text: number, color: "#8a95a1" }, { text: "  " }] : []), ...collect(rest, marks)] });
      return;
    }
    // Source numbers such as [1] are for the screen; the printed page leaves them out.
    if (node.tagName === "A" && /^\[\d+\]$/.test(text(node))) return;
    if (node.tagName === "A") href = node.getAttribute("href") ? new URL(node.getAttribute("href")!, root.ownerDocument.baseURI).href : undefined;
    if (node.tagName === "BR") { pending.push({ text: "\n" }); return; }
    if (node.tagName === "TABLE") {
      flush();
      for (const row of node.querySelectorAll("tr")) {
        const cells: PdfRun[][] = [];
        for (const cell of row.children) { pending = []; for (const child of cell.childNodes) walk(child, marks, href); cells.push(pending); pending = []; }
        blocks.push({ runs: [], cells });
      }
      return;
    }
    const boundary = /^(DIV|SECTION|P|H[1-6]|LI|UL|OL|DL|DT|DD|BLOCKQUOTE|SMALL)$/.test(node.tagName);
    const oldSize = size, oldIndent = indent;
    if (boundary) {
      flush();
      size = /^H[12]$/.test(node.tagName) ? 19 : /^H[3-6]$/.test(node.tagName) ? 14 : node.tagName === "SMALL" ? 10 : 12;
      if (node.tagName === "LI" || node.tagName === "BLOCKQUOTE") indent += 10;
      if (node.tagName === "LI") pending.push({ text: "• " });
    }
    for (const child of node.childNodes) walk(child, marks, href);
    if (markId && node.dataset.inkTail === "true" && node.dataset.inkKind === "note") {
      const note = notes.find(mark => mark.id === markId)?.note;
      if (note) { if (!memoNumber.has(markId)) memoNumber.set(markId, memoNumber.size + 1); pending.push({ text: "", memo: { index: memoNumber.get(markId)!, text: note } }); }
    }
    if (boundary) { flush(); size = oldSize; indent = oldIndent; }
  }
  for (const node of root.childNodes) walk(node);
  flush();
  // A note whose marker did not appear in the article (its passage changed) is still listed at the end.
  const unplaced = notes.filter(n => n.note && !memoNumber.has(n.id));
  if (unplaced.length) {
    blocks.push({ runs: [{ text: lang === "ja" ? "自分のメモ" : "My notes" }], size: 16 });
    for (const note of unplaced) {
      blocks.push({ runs: [{ text: note.note }], size: 12 });
      blocks.push({ runs: [{ text: note.parts.map(p => p.quote).join("\n") }], size: 10, indent: 12 });
    }
  }
  return blocks;
}

export async function generateNotebookPdf(content: HTMLElement, marks: Annotation[], title: string, lang: string): Promise<Blob> {
  // Snapshot the visible, access-checked article before awaiting font downloads.
  const blocks = notebookPdfBlocks(content, marks, lang);
  const response = await fetch("/research-pdf-fonts/manifest.json");
  if (!response.ok) throw new Error("PDF fonts unavailable");
  const manifest: FontSubset[] = await response.json();
  const fetchFont = async (file: string) => {
    const response = await fetch(`/research-pdf-fonts/${encodeURIComponent(file)}`);
    if (!response.ok) throw new Error("PDF font unavailable");
    return new Uint8Array(await response.arrayBuffer());
  };
  // The bold subsets are for the headings only; if they cannot be had, the headings are set in the regular weight.
  const boldResponse = await fetch("/research-pdf-fonts/manifest-bold.json").catch(() => null);
  const boldManifest: FontSubset[] | null = boldResponse?.ok ? await boldResponse.json().catch(() => null) : null;
  const bytes = await createNotebookPdf(blocks, title, manifest, fetchFont, lang, new Date(), boldManifest ? { manifest: boldManifest, loadFont: fetchFont } : undefined);
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
