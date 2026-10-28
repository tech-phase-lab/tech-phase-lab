import { inkColors, type Annotation } from "./annotations";
import { createNotebookPdf, type PdfBlock, type PdfRun, type PdfMark, type FontSubset } from "./notebook-pdf";

export function notebookPdfBlocks(root: HTMLElement, notes: Annotation[], lang: string): PdfBlock[] {
  const blocks: PdfBlock[] = []; let pending: PdfRun[] = [];
  let size = 12; let indent = 0;
  const flush = () => { if (pending.some(r => r.text.trim())) blocks.push({ runs: pending, size, indent }); pending = []; };
  function walk(node: Node, marks: PdfMark[] = [], href?: string) {
    if (node.nodeType === 3) { pending.push({ text: node.textContent ?? "", marks, href }); return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.hidden || node.hasAttribute("data-ink-outline") || node.getAttribute("aria-hidden") === "true" || ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "SCRIPT", "STYLE"].includes(node.tagName)) return;
    const markId = node.dataset.inkId;
    if (markId) {
      const color = inkColors[node.dataset.inkColor as keyof typeof inkColors];
      if (color) marks = [...marks, { id: `${markId}:${node.dataset.inkPart ?? ""}`, kind: node.dataset.inkKind ?? "", color }];
    }
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
    if (boundary) { flush(); size = oldSize; indent = oldIndent; }
  }
  for (const node of root.childNodes) walk(node);
  flush();
  if (notes.some(n => n.note)) {
    blocks.push({ runs: [{ text: lang === "ja" ? "自分のメモ" : "My notes" }], size: 16 });
    for (const note of notes.filter(n => n.note)) {
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
  const bytes = await createNotebookPdf(blocks, title, manifest, async file => {
    const response = await fetch(`/research-pdf-fonts/${encodeURIComponent(file)}`);
    if (!response.ok) throw new Error("PDF font unavailable");
    return new Uint8Array(await response.arrayBuffer());
  }, lang);
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
