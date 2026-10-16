import { PDFDocument, PDFName, PDFString, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type PdfMark = { id: string; kind: string; color: string };
export type PdfRun = { text: string; marks?: PdfMark[]; href?: string };
export type PdfBlock = { runs: PdfRun[]; size?: number; indent?: number; cells?: PdfRun[][] };
export type FontSubset = { file: string; ranges: number[][] };
const PAGE = [420, 595] as const;
const MARGIN = 28;
const ink = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);

export async function createNotebookPdf(blocks: PdfBlock[], title: string, manifest: FontSubset[], loadFont: (file: string) => Promise<Uint8Array>, lang = "ja") {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title); pdf.setAuthor("Tech Phase Research"); pdf.setLanguage(lang === "ja" ? "ja-JP" : "en-US");
  const characters = new Set(Array.from(blocks.flatMap(b => [b.runs, ...(b.cells ?? [])]).flatMap(r => r.map(x => x.text)).join("") + "TECH PHASE RESEARCH 0123456789 / □").map(c => c.codePointAt(0)!));
  const needed = manifest.filter(item => item.ranges.some(([start, end]) => [...characters].some(c => c >= start && c <= end)));
  const fonts = await Promise.all(needed.map(async item => pdf.embedFont(await loadFont(item.file), { subset: true })));
  const fontMap = new Map<number, PDFFont>();
  for (const font of fonts) for (const c of font.getCharacterSet()) if (characters.has(c)) fontMap.set(c, font);
  const fallback = fontMap.get(0x25a1) ?? fontMap.get(63);
  if (!fallback) throw new Error("PDF font unavailable");
  type Glyph = { text: string; font: PDFFont; width: number; marks: PdfMark[]; href?: string };
  function lines(runs: PdfRun[], size: number, width: number): Glyph[][] {
    const result: Glyph[][] = []; let line: Glyph[] = []; let used = 0;
    const flush = () => { result.push(line); line = []; used = 0; };
    for (const run of runs) for (const char of run.text.replace(/\r/g, "").replace(/\t/g, "    ")) {
      if (char === "\n") { flush(); continue; }
      if (char.codePointAt(0)! < 32) continue;
      const font = fontMap.get(char.codePointAt(0)!) ?? fallback!;
      const text = fontMap.has(char.codePointAt(0)!) ? char : "□";
      const glyph = { text, font, width: font.widthOfTextAtSize(text, size), marks: run.marks ?? [], href: run.href };
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
    if (line.length) flush();
    return result;
  }
  let page = pdf.addPage([...PAGE]); let y = PAGE[1] - 54;
  const newPage = () => { page = pdf.addPage([...PAGE]); y = PAGE[1] - 54; };
  function drawLine(line: Glyph[], x: number, size: number) {
    const boxes = new Map<string, { x: number; width: number; color: string }>();
    for (const glyph of line) {
      for (const mark of glyph.marks) {
        const color = ink(mark.color);
        if (mark.kind === "highlight") page.drawRectangle({ x, y: y - size * .2, width: glyph.width, height: size * 1.2, color, opacity: .28 });
        if (mark.kind === "underline" || mark.kind === "note") page.drawLine({ start: { x, y: y - 2 }, end: { x: x + glyph.width, y: y - 2 }, thickness: .8, color, ...(mark.kind === "note" ? { dashArray: [1, 2] } : {}) });
        if (mark.kind === "box") { const old = boxes.get(mark.id); boxes.set(mark.id, { x: old?.x ?? x, width: (old?.width ?? 0) + glyph.width, color: mark.color }); }
      }
      page.drawText(glyph.text, { x, y, size, font: glyph.font, color: glyph.href ? rgb(.14, .35, .54) : rgb(.09, .14, .19) });
      if (glyph.href && /^https?:\/\//.test(glyph.href)) {
        const annotation = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y - 2, x + glyph.width, y + size], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(glyph.href) } });
        page.node.addAnnot(pdf.context.register(annotation));
      }
      x += glyph.width;
    }
    for (const box of boxes.values()) page.drawRectangle({ x: box.x - 1, y: y - size * .23, width: box.width + 2, height: size * 1.25, borderColor: ink(box.color), borderWidth: .8 });
  }
  for (const block of blocks) {
    const size = block.size ?? 12; const leading = size * 1.65;
    const indent = block.indent ?? 0; const width = PAGE[0] - MARGIN * 2 - indent;
    if (block.cells?.length) {
      const cellWidth = width / block.cells.length;
      const cells = block.cells.map(cell => lines(cell, 10, cellWidth - 12));
      const count = Math.max(...cells.map(cell => cell.length));
      for (let row = 0; row < count; row++) {
        if (y < MARGIN + 24) newPage();
        cells.forEach((cell, i) => { page.drawRectangle({ x: MARGIN + i * cellWidth, y: y - 5, width: cellWidth, height: 18, borderColor: rgb(.75,.8,.82), borderWidth: .4 }); drawLine(cell[row] ?? [], MARGIN + i * cellWidth + 6, 10); });
        y -= 18;
      }
      y -= 6; continue;
    }
    const wrapped = lines(block.runs, size, width);
    if (size > 12 && y < MARGIN + leading * 3) newPage();
    for (const line of wrapped) {
      if (y < MARGIN + leading) newPage();
      drawLine(line, MARGIN + indent, size); y -= leading;
    }
    if (wrapped.length) y -= size > 12 ? 10 : 8;
  }
  // A small running header and page number keep long articles navigable.
  const latin = fontMap.get(84)!;
  for (const [i, sheet] of pdf.getPages().entries()) {
    sheet.drawText("TECH PHASE RESEARCH", { x: MARGIN, y: PAGE[1] - 25, size: 8, font: latin, color: rgb(.35,.44,.48) });
    sheet.drawText(`${i + 1} / ${pdf.getPageCount()}`, { x: PAGE[0] - 60, y: 16, size: 8, font: fontMap.get(49)!, color: rgb(.35,.44,.48) });
  }
  // No JavaScript, print action or automatic viewer action is embedded.
  pdf.catalog.delete(PDFName.of("OpenAction"));
  return pdf.save();
}
