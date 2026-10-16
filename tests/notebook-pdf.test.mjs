import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createNotebookPdf } from '../lib/research/notebook-pdf.ts';
const base = 'node_modules/@fontsource/noto-sans-jp/';
const css = await readFile(base + '400.css', 'utf8');
const manifest = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => ({
  file: block.match(/url\(\.\/files\/([^)]*\.woff)\)/)[1],
  ranges: block.match(/unicode-range:\s*([^;]+)/)[1].split(',').map(value => { const [a,b] = value.trim().replace(/^U\+/, '').split('-'); return [parseInt(a,16), parseInt(b ?? a,16)]; }),
}));
const load = file => readFile(base + 'files/' + file);
test('Japanese notes and overlapping marks produce a real multipage PDF without print actions', async () => {
  const marks = [{id:'u',kind:'underline',color:'#ed7272'}, {id:'h',kind:'highlight',color:'#f5d361'}, {id:'b',kind:'box',color:'#7eb9f7'}];
  const blocks = [
    {runs:[{text:'NVIDIA 決算を読み返す、自分だけのノート。'}],size:19},
    ...Array.from({length:30}, () => ({runs:[{text:'日本語の本文。Revenue increased 30.8%. ',marks},{text:'次の四半期を確認します。'}]})),
    {runs:[],cells:[[{text:'売上高'}],[{text:'600〜630億ドル'}]]},
    {runs:[{text:'自分のメモ\n利益率と設備投資を見直す。'}]},
  ];
  const bytes = await createNotebookPdf(blocks, '日本語PDF', manifest, load);
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  assert.equal(pdf.getTitle(), '日本語PDF');
  assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false);
  assert.equal(pdf.catalog.has(PDFName.of('AA')), false);
  for (const page of pdf.getPages()) assert.ok(page.node.Resources());
});
test('English PDF includes clickable source links and rejects missing fonts', async () => {
  const blocks = [{runs:[{text:'Read the source',href:'https://example.com/source'}]}];
  const bytes = await createNotebookPdf(blocks, 'Research', manifest, load, 'en');
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPage(0).node.Annots().size() > 0);
  assert.equal(pdf.catalog.get(PDFName.of('Lang')).decodeText(), 'en-US');
  await assert.rejects(createNotebookPdf(blocks, 'Research', manifest, async () => {throw new Error('unavailable');}), /unavailable/);
});

test('the preview reader renders the same Japanese PDF and pagination that will be saved', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const bytes = await createNotebookPdf([{ runs: [{ text: '保存前に確認する日本語のメモ。' }] }], 'Preview', manifest, load);
  const loading = getDocument({ data: new Uint8Array(bytes), useWasm: false, disableFontFace: true });
  try {
    const preview = await loading.promise;
    const saved = await PDFDocument.load(bytes);
    assert.equal(preview.numPages, saved.getPageCount());
    const page = await preview.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join('');
    assert.match(text, /保存前に確認する日本語のメモ/);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    assert.ok(canvas.toBuffer('image/png').length > 1000);
  } finally { await loading.destroy(); }
});
