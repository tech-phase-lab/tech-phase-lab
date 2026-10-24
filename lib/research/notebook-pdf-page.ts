import { PDFDocument } from "pdf-lib";

/** Copy selected original pages in document order, retaining text and page geometry. */
export async function extractNotebookPdfPages(bytes: ArrayBuffer, pageNumbers: readonly number[]): Promise<Uint8Array<ArrayBuffer>> {
  const source = await PDFDocument.load(bytes);
  if (!pageNumbers.length || pageNumbers.some(number => !Number.isInteger(number) || number < 1 || number > source.getPageCount())) throw new RangeError("Invalid PDF pages");
  const numbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, numbers.map(number => number - 1));
  for (const page of pages) output.addPage(page);
  const title = source.getTitle();
  if (title) output.setTitle(title);
  return new Uint8Array(await output.save());
}
