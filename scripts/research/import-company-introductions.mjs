import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCompanyIntroductions } from '../../lib/research/company-introduction-schema.ts';

export function mergeCompanyIntroductions(current, batch) {
  validateCompanyIntroductions(current);
  validateCompanyIntroductions(batch);
  const byCik = new Map(current.map(item => [item.cik, item]));
  for (const item of batch) {
    const previous = byCik.get(item.cik);
    if (previous && item.reviewedOn < previous.reviewedOn) throw new Error(`Stale review for CIK ${item.cik}`);
    byCik.set(item.cik, item);
  }
  const merged = [...byCik.values()];
  validateCompanyIntroductions(merged);
  return merged;
}

export function importCompanyIntroductions({ batchPath, registryPath, apply = false }) {
  const current = JSON.parse(readFileSync(registryPath, 'utf8'));
  const batch = JSON.parse(readFileSync(batchPath, 'utf8'));
  const merged = mergeCompanyIntroductions(current, batch);
  if (apply) {
    const temporary = `${registryPath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, { flag: 'wx' });
      renameSync(temporary, registryPath);
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return { batch: batch.length, issuers: merged.length, tickers: merged.reduce((sum, item) => sum + item.tickers.length, 0), written: apply };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (!args[0] || args.some((arg, index) => index > 0 && arg !== '--apply')) {
    console.error('Usage: node --experimental-strip-types scripts/research/import-company-introductions.mjs batch.json [--apply]');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(importCompanyIntroductions({
        batchPath: args[0],
        registryPath: fileURLToPath(new URL('../../lib/research/company-introductions.data.json', import.meta.url)),
        apply: args.includes('--apply'),
      })));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
