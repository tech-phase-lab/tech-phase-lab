import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const source = path.resolve('node_modules/@fontsource/noto-sans-jp');
const target = path.resolve('public/research-pdf-fonts');
await mkdir(target, { recursive: true });
const css = await readFile(path.join(source, '400.css'), 'utf8');
const manifest = [];
for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
  const file = block[1].match(/url\(\.\/files\/([^)]*\.woff)\)/)?.[1];
  const range = block[1].match(/unicode-range:\s*([^;]+)/)?.[1];
  if (!file || !range) throw new Error('Invalid PDF font metadata');
  await copyFile(path.join(source, 'files', file), path.join(target, file));
  manifest.push({ file, ranges: range.split(',').map(value => { const [a, b] = value.trim().replace(/^U\+/, '').split('-'); return [parseInt(a, 16), parseInt(b ?? a, 16)]; }) });
}
await copyFile(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest));
console.log(`Prepared ${manifest.length} local PDF font subsets`);

const viewer = path.resolve('public/research-pdf-viewer');
await mkdir(viewer, { recursive: true });
const { version } = JSON.parse(await readFile('node_modules/pdfjs-dist/package.json', 'utf8'));
await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', path.join(viewer, `pdf.worker-${version}.min.mjs`));
await copyFile('node_modules/pdfjs-dist/LICENSE', path.join(viewer, 'LICENSE'));
