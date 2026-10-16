import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { extractNotebookPdfPage } from '../lib/research/notebook-pdf-page.ts';

test('single-page export copies the requested page and leaves the complete PDF intact', async () => {
  const source = await PDFDocument.create();
  source.setTitle('Research');
  for (let number = 1; number <= 3; number++) {
    const page = source.addPage([420, 595]);
    page.drawText(`Distinct page ${number}`);
  }
  const bytes = await source.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const number of [1, 2, 3]) {
    const extracted = await extractNotebookPdfPage(bytes.buffer, number);
    const result = await PDFDocument.load(extracted);
    assert.equal(result.getPageCount(), 1);
    assert.equal(result.getTitle(), 'Research');
    assert.deepEqual(result.getPage(0).getSize(), {width:420,height:595});
    assert.equal(result.catalog.has(PDFName.of('OpenAction')), false);
    const task = getDocument({data:new Uint8Array(extracted),useWasm:false});
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const text = (await page.getTextContent()).items.map(item => item.str).join('');
      assert.equal(text, `Distinct page ${number}`);
    } finally { await task.destroy(); }
  }
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  for (const invalid of [0, -1, 4, 1.5, NaN]) await assert.rejects(extractNotebookPdfPage(bytes.buffer, invalid), RangeError);
});
