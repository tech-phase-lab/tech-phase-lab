import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyIntroductions } from '../lib/research/company-introductions.ts';
import { validateCompanyIntroductions } from '../lib/research/company-introduction-schema.ts';
import { importCompanyIntroductions, mergeCompanyIntroductions } from '../scripts/research/import-company-introductions.mjs';

test('rejects incomplete translations, unsupported map edges, duplicate identities and impossible review dates', () => {
  for (const mutate of [
    item => { item.en.risks = ''; },
    item => { item.maps.relationships[0].sourceIndexes = [999]; },
    item => { item.maps.relationships[0].sourceIndexes = []; },
    item => { item.maps.relationships[0].role = 'competitor'; },
    item => { item.maps.relationships[0].ticker = item.tickers[0]; },
    item => { item.reviewedOn = '2026-02-30'; },
    item => { item.sources[0].url = 'javascript:alert(1)'; },
    item => { item.maps.competition[0].ticker = 'NVDA'; }, // industry is not an issuer
  ]) {
    const item = structuredClone(companyIntroductions[0]);
    mutate(item);
    assert.throws(() => validateCompanyIntroductions([item]));
  }
  assert.throws(() => validateCompanyIntroductions([companyIntroductions[0], companyIntroductions[0]]), /duplicate CIK/);
});

test('bulk upsert preserves untouched issuers and rejects older research', () => {
  const item = structuredClone(companyIntroductions[0]);
  item.ja.business = '更新された企業説明';
  const next = mergeCompanyIntroductions(companyIntroductions, [item]);
  assert.equal(next.length, companyIntroductions.length);
  assert.equal(next[0].ja.business, item.ja.business);
  assert.deepEqual(next.slice(1), companyIntroductions.slice(1));
  item.reviewedOn = '2020-01-01';
  assert.throws(() => mergeCompanyIntroductions(companyIntroductions, [item]), /Stale review/);
});

test('batch validation is read-only by default and failed input cannot partially overwrite the registry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-batch-'));
  try {
    const registryPath = join(dir, 'registry.json');
    const batchPath = join(dir, 'batch.json');
    const original = JSON.stringify(companyIntroductions);
    writeFileSync(registryPath, original);
    const item = structuredClone(companyIntroductions[0]);
    item.ja.business = '一括取込で更新する説明';
    writeFileSync(batchPath, JSON.stringify([item]));
    assert.equal(importCompanyIntroductions({batchPath, registryPath}).written, false);
    assert.equal(readFileSync(registryPath,'utf8'),original);
    assert.equal(importCompanyIntroductions({batchPath, registryPath,apply:true}).written, true);
    const saved = readFileSync(registryPath,'utf8');
    assert.equal(JSON.parse(saved)[0].ja.business,item.ja.business);
    writeFileSync(batchPath, JSON.stringify([item, {...item, cik: -1}]));
    assert.throws(()=>importCompanyIntroductions({batchPath,registryPath,apply:true}));
    assert.equal(readFileSync(registryPath,'utf8'),saved);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
