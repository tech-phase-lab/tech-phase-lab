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

test('the article head, the change box, note markers and the foot are set as the design asks', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const blocks = [
    { kind: 'meta', runs: [{ text: 'RESEARCH NOTE' }], right: [{ text: 'v1 · 公式発表' }] },
    { kind: 'company', runs: [{ text: 'Alphabet / Google(GOOGL)' }] },
    { kind: 'title', runs: [{ text: '最先端AIを公衆衛生に導入へ' }] },
    { kind: 'facts', runs: [], items: [{ label: [{ text: '発表日' }], value: [{ text: '2026年10月29日' }] }, { label: [{ text: '比較の基準' }], value: [{ text: 'この発表で確認した内容' }] }] },
    { kind: 'change', label: [{ text: '今回の変化' }], runs: [{ text: '連携を進める。' }, { text: '', memo: { index: 1, text: 'ここが買い増しの判断材料' } }] },
    { kind: 'section', size: 14, runs: [{ text: '01', color: '#8a95a1' }, { text: '  ' }, { text: '分析の前提となるデータ' }] },
  ];
  const bytes = await createNotebookPdf(blocks, 'Head', manifest, load, 'ja', new Date('2026-10-30T03:00:00Z'));
  const loading = getDocument({ data: new Uint8Array(bytes), useWasm: false, disableFontFace: true });
  try {
    const pdf = await loading.promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    for (const expected of ['TECH PHASE RESEARCH', '保存日', '2026.10.30', 'RESEARCH NOTE', '公式発表', '今回の変化', 'ここが買い増しの判断材料', 'techphase.app', '1 / 1']) assert.ok(text.includes(expected.replaceAll(' ', '')) || text.replaceAll(' ', '').includes(expected.replaceAll(' ', '')), expected);
    assert.match(text.replaceAll(' ', ''), /MEMO[①1]/);
    assert.match(text.replaceAll(' ', ''), /01分析の前提となるデータ/);
  } finally { await loading.destroy(); }
});

test('headings are set in bold when the bold subsets are given, and still print without them', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const boldBase = 'node_modules/@fontsource/noto-sans-jp/';
  const boldCss = await readFile(boldBase + '700.css', 'utf8');
  const boldManifest = [...boldCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => ({
    file: block.match(/url\(\.\/files\/([^)]*\.woff)\)/)[1],
    ranges: block.match(/unicode-range:\s*([^;]+)/)[1].split(',').map(value => { const [a,b] = value.trim().replace(/^U\+/, '').split('-'); return [parseInt(a,16), parseInt(b ?? a,16)]; }),
  }));
  const blocks = [
    { kind: 'title', runs: [{ text: '最先端AIを公衆衛生に導入へ' }] },
    { kind: 'change', label: [{ text: '今回の変化' }], runs: [{ text: '連携を進める。' }, { text: '', memo: { index: 1, text: '買い増しの判断材料' } }] },
    { kind: 'section', size: 14, runs: [{ text: '01', color: '#8a95a1' }, { text: '  ' }, { text: '分析の前提となるデータ' }] },
  ];
  const fontNames = async bytes => {
    const pdf = await PDFDocument.load(bytes);
    const names = new Set();
    for (const page of pdf.getPages()) { const fonts = page.node.Resources().lookup(PDFName.of('Font')); for (const key of fonts.keys()) names.add(fonts.lookup(key).get(PDFName.of('BaseFont')).toString()); }
    return names.size;
  };
  const plain = await createNotebookPdf(blocks, 'x', manifest, load, 'ja');
  const bold = await createNotebookPdf(blocks, 'x', manifest, load, 'ja', new Date(), { manifest: boldManifest, loadFont: load });
  assert.ok(await fontNames(bold) > await fontNames(plain), 'bold faces are embedded');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bold), useWasm: false, disableFontFace: true });
  try {
    const text = (await (await (await loading.promise).getPage(1)).getTextContent()).items.map(item => item.str).join('').replaceAll(' ', '');
    for (const expected of ['最先端AIを公衆衛生に導入へ', '今回の変化', '01分析の前提となるデータ', '買い増しの判断材料']) assert.ok(text.includes(expected), expected);
  } finally { await loading.destroy(); }
});
