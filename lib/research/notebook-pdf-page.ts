import { PDFDocument } from "pdf-lib";

/** Copy one original PDF page, preserving text, annotations and page geometry. */
export async function extractNotebookPdfPage(bytes: ArrayBuffer, pageNumber: number): Promise<Uint8Array<ArrayBuffer>> {
  const source = await PDFDocument.load(bytes);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > source.getPageCount()) throw new RangeError("Invalid PDF page");
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(source, [pageNumber - 1]);
  output.addPage(page);
  const title = source.getTitle();
  if (title) output.setTitle(title);
  return new Uint8Array(await output.save());
}
