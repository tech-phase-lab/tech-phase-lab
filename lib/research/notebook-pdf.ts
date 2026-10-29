import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type PdfMark = { id: string; kind: string; color: string };
/** A note marker: the small "MEMO①" after the annotated passage; the note itself is set in a box at the foot of the page. */
export type PdfMemo = { index: number; text: string };
export type PdfRun = { text: string; marks?: PdfMark[]; href?: string; color?: string; memo?: PdfMemo };
export type PdfBlock = {
  runs: PdfRun[]; size?: number; indent?: number; cells?: PdfRun[][];
  /** How the block is set: the article head (meta line, company, title, facts), the "what changed" box, or a section heading. */
  kind?: "meta" | "company" | "title" | "facts" | "change" | "section";
  /** meta: the right-hand text of the line. */
  right?: PdfRun[];
  /** facts: label and value pairs, set in columns. change: `label` is the box heading. */
  items?: { label: PdfRun[]; value: PdfRun[] }[]; label?: PdfRun[];
};
export type FontSubset = { file: string; ranges: number[][] };
const PAGE = [420, 595] as const;
const MARGIN = 28;
const ink = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const PAPER = "#fbfaf6", TEXT = "#1b2430", QUIET = "#7a8794", LINK = "#3f6fae", GOLD = "#c8a85a", GOLD_INK = "#6b5a2e";
/** Pen colours as they print: line colour and highlighter fill for the three inks of the app. */
const PRINT_INK: Record<string, { line: string; fill: string }> = {
  "#ef777f": { line: "#e0606f", fill: "#f7c5cb" }, "#e9cc61": { line: "#d6a93a", fill: "#fbe9a4" }, "#78bafa": { line: "#5b8fd6", fill: "#cfe0f7" },
};
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const fixed = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("-", ".");

export async function createNotebookPdf(blocks: PdfBlock[], title: string, manifest: FontSubset[], loadFont: (file: string) => Promise<Uint8Array>, lang = "ja", savedOn = new Date()) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title); pdf.setAuthor("Tech Phase Research"); pdf.setLanguage(lang === "ja" ? "ja-JP" : "en-US");
  const everyRun = (block: PdfBlock) => [block.runs, ...(block.cells ?? []), block.right ?? [], block.label ?? [], ...(block.items ?? []).flatMap(item => [item.label, item.value])];
  const fixedText = `TECH PHASE RESEARCH 0123456789 / □ ${CIRCLED} MEMO ${lang === "ja" ? "保存日" : "Saved"} . techphase.app`;
  const characters = new Set(Array.from(blocks.flatMap(everyRun).flatMap(r => r.map(x => x.text + (x.memo?.text ?? ""))).join("") + fixedText).map(c => c.codePointAt(0)!));
  const needed = manifest.filter(item => item.ranges.some(([start, end]) => [...characters].some(c => c >= start && c <= end)));
  const fonts = await Promise.all(needed.map(async item => pdf.embedFont(await loadFont(item.file), { subset: true })));
  const fontMap = new Map<number, PDFFont>();
  for (const font of fonts) for (const c of font.getCharacterSet()) if (characters.has(c)) fontMap.set(c, font);
  const fallback = fontMap.get(0x25a1) ?? fontMap.get(63);
  if (!fallback) throw new Error("PDF font unavailable");
  const latin = fontMap.get(84) ?? fallback;
  const circled = (index: number) => { const char = CIRCLED[index - 1]; return char && fontMap.has(char.codePointAt(0)!) ? char : String(index); };
  const memoText = (index: number) => `MEMO${circled(index)}`;
  type Glyph = { text: string; font: PDFFont; width: number; marks: PdfMark[]; href?: string; color?: string; memo?: PdfMemo; parts?: { text: string; font: PDFFont }[]; memoSize?: number };
  function lines(runs: PdfRun[], size: number, width: number): Glyph[][] {
    const result: Glyph[][] = []; let line: Glyph[] = []; let used = 0;
    const flush = () => { result.push(line); line = []; used = 0; };
    for (const run of runs) {
      if (run.memo) {
        const memoSize = size * .62, mark = circled(run.memo.index);
        const parts = [{ text: "MEMO", font: latin }, { text: mark, font: fontMap.get(mark.codePointAt(0)!) ?? latin }];
        const memoWidth = parts.reduce((sum, part) => sum + part.font.widthOfTextAtSize(part.text, memoSize), 0) + 2;
        if (used + memoWidth > width && line.length) flush();
        line.push({ text: "", font: latin, width: memoWidth, marks: [], memo: run.memo, parts, memoSize }); used += memoWidth;
        continue;
      }
      for (const char of run.text.replace(/\r/g, "").replace(/\t/g, "    ")) {
        if (char === "\n") { flush(); continue; }
        if (char.codePointAt(0)! < 32) continue;
        const font = fontMap.get(char.codePointAt(0)!) ?? fallback!;
        const text = fontMap.has(char.codePointAt(0)!) ? char : "□";
        const glyph = { text, font, width: font.widthOfTextAtSize(text, size), marks: run.marks ?? [], href: run.href, color: run.color };
        if (used + glyph.width > width && line.length) {
          // Prefer a word boundary for English; CJK can wrap between characters.
          const space = line.map(g => g.text).lastIndexOf(" ");
          if (space > line.length / 2 && /[A-Za-z0-9]/.test(char)) {
            const rest = line.splice(space + 1); line.pop(); flush(); line = rest; used = rest.reduce((n, g) => n + g.width, 0);
          } else if (/[、。，．！？：；）］｝」』】〉》…]/.test(char) || /[（［｛「『【〈《]/.test(line.at(-1)?.text ?? "")) {
            const last = line.pop()!; flush(); line = [last]; used = last.width;
          } else flush();
        }
        line.push(glyph); used += glyph.width;
      }
    }
    if (line.length) flush();
    return result;
  }
  const newSheet = () => { const sheet = pdf.addPage([...PAGE]); sheet.drawRectangle({ x: 0, y: 0, width: PAGE[0], height: PAGE[1], color: ink(PAPER) }); return sheet; };
  let page: PDFPage = newSheet(); const START = PAGE[1] - 62; let y = START;
  // Notes set in a box at the foot of the page that carries their marker.
  let pageMemos: { memo: PdfMemo; lines: Glyph[][]; height: number }[] = [];
  const memoFoot = () => pageMemos.reduce((sum, item) => sum + item.height + 6, 0);
  const memoBox = (memo: PdfMemo) => { const wrapped = lines([{ text: memo.text }], 10, PAGE[0] - MARGIN * 2 - 20); return { memo, lines: wrapped, height: 26 + wrapped.length * 15 }; };
  const floor = () => MARGIN + 14 + memoFoot();
  function finishPage() {
    let base = MARGIN + 14;
    for (const item of pageMemos) {
      page.drawRectangle({ x: MARGIN, y: base, width: PAGE[0] - MARGIN * 2, height: item.height, color: ink("#fdf6df"), borderColor: ink("#e3cf95"), borderWidth: .8 });
      drawSpaced(memoText(item.memo.index), MARGIN + 10, base + item.height - 14, 8, "#a07d2c", .12);
      let lineY = base + item.height - 30;
      for (const line of item.lines) { drawGlyphs(line, MARGIN + 10, lineY, 10, TEXT, false); lineY -= 15; }
      base += item.height + 6;
    }
    pageMemos = [];
  }
  const newPage = () => { finishPage(); page = newSheet(); y = START; };
  function drawSpaced(text: string, x: number, atY: number, size: number, color: string, spacing: number, target: PDFPage = page) {
    for (const char of text) {
      const font = fontMap.get(char.codePointAt(0)!) ?? latin;
      const shown = fontMap.has(char.codePointAt(0)!) ? char : " ";
      target.drawText(shown, { x, y: atY, size, font, color: ink(color) });
      x += font.widthOfTextAtSize(shown, size) + size * spacing;
    }
  }
  const spacedWidth = (text: string, size: number, spacing: number) => [...text].reduce((sum, char) => sum + (fontMap.get(char.codePointAt(0)!) ?? latin).widthOfTextAtSize(fontMap.has(char.codePointAt(0)!) ? char : " ", size) + size * spacing, 0);
  function drawGlyphs(line: Glyph[], startX: number, atY: number, size: number, color: string, withMarks = true) {
    let x = startX;
    const boxes = new Map<string, { x: number; width: number; color: string }>();
    for (const glyph of line) {
      if (glyph.memo) {
        let partX = x;
        for (const part of glyph.parts ?? []) { page.drawText(part.text, { x: partX, y: atY + size * .35, size: glyph.memoSize ?? size * .62, font: part.font, color: ink("#a07d2c") }); partX += part.font.widthOfTextAtSize(part.text, glyph.memoSize ?? size * .62); }
        x += glyph.width; continue;
      }
      if (withMarks) for (const mark of glyph.marks) {
        const print = PRINT_INK[mark.color], paint = ink(print?.line ?? mark.color);
        if (mark.kind === "highlight") page.drawRectangle({ x, y: atY - size * .2, width: glyph.width, height: size * 1.2, color: ink(print?.fill ?? mark.color), ...(print ? {} : { opacity: .28 }) });
        if (mark.kind === "underline" || mark.kind === "note") page.drawLine({ start: { x, y: atY - 2 }, end: { x: x + glyph.width, y: atY - 2 }, thickness: mark.kind === "underline" ? 1.1 : .8, color: paint, ...(mark.kind === "note" ? { dashArray: [1, 2] } : {}) });
        if (mark.kind === "box") { const old = boxes.get(mark.id); boxes.set(mark.id, { x: old?.x ?? x, width: (old?.width ?? 0) + glyph.width, color: print?.line ?? mark.color }); }
      }
      page.drawText(glyph.text, { x, y: atY, size, font: glyph.font, color: ink(glyph.href ? LINK : glyph.color ?? color) });
      if (glyph.href && /^https?:\/\//.test(glyph.href)) {
        const annotation = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, atY - 2, x + glyph.width, atY + size], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(glyph.href) } });
        page.node.addAnnot(pdf.context.register(annotation));
      }
      x += glyph.width;
    }
    for (const box of boxes.values()) page.drawRectangle({ x: box.x - 1, y: atY - size * .23, width: box.width + 2, height: size * 1.25, borderColor: ink(box.color), borderWidth: 1 });
  }
  /** Sets wrapped lines from the current place; a note marker pulls its box onto the page of its line. */
  function paragraph(runs: PdfRun[], size: number, leading: number, x: number, width: number, color = TEXT) {
    for (const line of lines(runs, size, width)) {
      const fresh = line.flatMap(glyph => glyph.memo ? [memoBox(glyph.memo)] : []);
      const extra = fresh.reduce((sum, item) => sum + item.height + 6, 0);
      if (y - leading < floor() + extra) { newPage(); }
      drawGlyphs(line, x, y, size, color); y -= leading;
      pageMemos.push(...fresh);
    }
  }
  const measure = (runs: PdfRun[], size: number, width: number) => lines(runs, size, width).length;

  for (const block of blocks) {
    const size = block.size ?? 12; const leading = size * 1.65;
    const indent = block.indent ?? 0; const width = PAGE[0] - MARGIN * 2 - indent;
    if (block.kind === "meta") {
      if (y < floor() + 30) newPage();
      const left = block.runs.map(run => run.text).join(""), right = (block.right ?? []).map(run => run.text).join("");
      drawSpaced(left, MARGIN, y, 7.5, QUIET, .3);
      if (right) drawSpaced(right, PAGE[0] - MARGIN - spacedWidth(right, 8, .02), y, 8, QUIET, .02);
      y -= 24; continue;
    }
    if (block.kind === "company") { paragraph(block.runs.map(run => ({ ...run, href: undefined, color: LINK })), 12, 12 * 1.5, MARGIN, width); y -= 4; continue; }
    if (block.kind === "title") { if (y < floor() + 19 * 1.55 * 2) newPage(); paragraph(block.runs, 19, 19 * 1.55, MARGIN, width); y -= 8; continue; }
    if (block.kind === "facts" && block.items?.length) {
      const columns = Math.min(3, block.items.length), columnWidth = width / columns;
      const rows = block.items.map(item => measure(item.value, 12.5, columnWidth - 10));
      const tall = Math.max(...rows);
      if (y < floor() + 14 + tall * 20 + 8) newPage();
      block.items.forEach((item, column) => {
        const x = MARGIN + column * columnWidth;
        for (const line of lines(item.label, 8, columnWidth - 10)) drawGlyphs(line, x, y, 8, QUIET, false);
        let lineY = y - 16;
        for (const line of lines(item.value, 12.5, columnWidth - 10)) { drawGlyphs(line, x, lineY, 12.5, TEXT, false); lineY -= 18; }
      });
      y -= 16 + tall * 18 + 10; continue;
    }
    if (block.kind === "change") {
      const inner = width - 22, body = measure(block.runs, 12.5, inner), boxHeight = 12 + 14 + body * 20 + 8;
      if (y - boxHeight < floor()) newPage();
      const top = y + 6, bottom = top - boxHeight;
      const bands = ["#e8f4ed", "#ebf6f0", "#eef7f2", "#f1f8f4", "#f4faf6", "#f6faf7", "#f8fbf9", "#f9fcfa"];
      bands.forEach((band, index) => page.drawRectangle({ x: MARGIN + (width * index) / bands.length, y: bottom, width: width / bands.length, height: boxHeight, color: ink(band) }));
      page.drawRectangle({ x: MARGIN, y: bottom, width: 3, height: boxHeight, color: ink("#4fb58d") });
      let lineY = top - 17;
      for (const line of lines(block.label ?? [], 9.5, inner)) { drawGlyphs(line, MARGIN + 14, lineY, 9.5, "#2f8f6a", false); lineY -= 14; }
      lineY -= 2;
      y = lineY;
      paragraph(block.runs, 12.5, 20, MARGIN + 14, inner);
      y = bottom - 24; continue;
    }
    if (block.cells?.length) {
      const cellWidth = width / block.cells.length;
      const cells = block.cells.map(cell => lines(cell, 10, cellWidth - 12));
      const count = Math.max(...cells.map(cell => cell.length));
      for (let row = 0; row < count; row++) {
        if (y < floor() + 10) newPage();
        cells.forEach((cell, i) => { page.drawRectangle({ x: MARGIN + i * cellWidth, y: y - 5, width: cellWidth, height: 18, borderColor: ink("#bfcbd1"), borderWidth: .4 }); drawGlyphs(cell[row] ?? [], MARGIN + i * cellWidth + 6, y, 10, TEXT); });
        y -= 18;
      }
      y -= 6; continue;
    }
    const wrapped = lines(block.runs, size, width);
    if (size > 12 && y < floor() + leading * 3) newPage();
    paragraph(block.runs, size, leading, MARGIN + indent, width);
    if (wrapped.length) y -= block.kind === "section" ? 4 : size > 12 ? 10 : 8;
  }
  finishPage();
  // The running head, the foot and the page number sit on every page.
  const total = pdf.getPageCount();
  const stamp = lang === "ja" ? `保存日 ${fixed(savedOn)}` : `Saved ${fixed(savedOn)}`;
  for (const [i, sheet] of pdf.getPages().entries()) {
    page = sheet;
    drawSpaced("TECH PHASE RESEARCH", MARGIN, PAGE[1] - 30, 8, GOLD_INK, .22, sheet);
    drawSpaced(stamp, PAGE[0] - MARGIN - spacedWidth(stamp, 8, .02), PAGE[1] - 30, 8, QUIET, .02, sheet);
    sheet.drawLine({ start: { x: MARGIN, y: PAGE[1] - 38 }, end: { x: PAGE[0] - MARGIN, y: PAGE[1] - 38 }, thickness: 1.5, color: ink(GOLD) });
    drawSpaced("techphase.app", MARGIN, 16, 8, QUIET, .02, sheet);
    const number = `${i + 1} / ${total}`;
    drawSpaced(number, PAGE[0] - MARGIN - spacedWidth(number, 8, .02), 16, 8, QUIET, .02, sheet);
  }
  // No JavaScript, print action or automatic viewer action is embedded.
  pdf.catalog.delete(PDFName.of("OpenAction"));
  return pdf.save();
}
