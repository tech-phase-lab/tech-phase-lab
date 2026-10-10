import test from 'node:test';
import assert from 'node:assert/strict';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';

const item = { id: '1', title: 'Nvidia raises full-year guidance', url: 'https://nvidianews.nvidia.com/news/example',
  publisher: 'NVIDIA', tickers: ['NVDA'], observedAt: '2026-10-05T12:00:00Z', bodyEn: 'NVIDIA raised its outlook.' };

test('Japanese view shows the original, marked, while the translation is pending or held', () => {
  const display = officialNewsDisplay(item, 'ja');
  assert.equal(display.title, 'Nvidia raises full-year guidance');
  assert.equal(display.pendingTranslation, true);
  assert.match(display.label, /翻訳準備中（原文）$/);
  assert.match(display.body ?? '', /NVIDIA raised its outlook/);
});

test('a validated translation replaces the original and the mark disappears', () => {
  const display = officialNewsDisplay({ ...item, translationJa: 'エヌビディア、通期見通しを引き上げ', bodyJa: 'エヌビディアは見通しを引き上げた。' }, 'ja');
  assert.equal(display.title, 'エヌビディア、通期見通しを引き上げ');
  assert.equal(display.pendingTranslation, false);
  assert.doesNotMatch(display.label, /翻訳準備中/);
  assert.equal(officialNewsDisplay(item, 'en').pendingTranslation, false);
});

import { marketNewsDetail } from '../lib/research/market-news-detail.ts';

test('X market summary detail opens behind ＋ only with valid bilingual text', () => {
  const base = { detailPolicy: 'source-summary-v1', titleJa: '日本10年債利回り上昇', titleEn: 'Japan 10-year yield rises',
    bodyJa: 'Barchartによると、日本の10年物国債利回りは1.85%に上昇した。', bodyEn: 'Barchart reported the yield rose to 1.85%.' };
  assert.equal(marketNewsDetail(base).bodyJa, base.bodyJa);
  assert.deepEqual(marketNewsDetail({ ...base, bodyJa: 'English only text here' }), {});
  assert.deepEqual(marketNewsDetail({ ...base, bodyEn: '<script>x</script> long enough' }), {});
  assert.deepEqual(marketNewsDetail({ ...base, bodyEn: base.titleEn }), {});
});

import { publicNewsPayload } from '../lib/research/general-news.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

const placeholder = { id: '7', title: 'NVIDIA $NVDA agrees to acquire Run:ai.', translationJa: 'NVDA：買収に関する報道',
  url: 'https://x.com/tipranks/status/123', publisher: 'X · TipRanks', tickers: ['NVDA'],
  observedAt: '2026-10-09T14:00:00Z', publishedAt: '2026-10-09T13:59:00Z', pendingResearch: 1 };

test('a source-only placeholder shows the fixed Japanese label, the English post in English, and stays out of the strip', () => {
  const feed = publicNewsPayload({ ok: true, enabled: true, items: [], officialUpdates: [placeholder] });
  const [item] = feed.officialUpdates;
  assert.equal(item.pendingResearch, 1);
  assert.equal(officialNewsDisplay(item, 'ja').title, 'NVDA：買収に関する報道');
  assert.equal(officialNewsDisplay(item, 'ja').pendingTranslation, false);
  assert.equal(officialNewsDisplay(item, 'en').title, 'NVIDIA $NVDA agrees to acquire Run:ai.');
  assert.equal(newsPulseItems(feed, 'ja').length, 0);
  assert.equal(newsPulseItems(feed, 'en').length, 0);
});

test('a placeholder marker cannot carry a body or come from another account', () => {
  for (const bad of [{ ...placeholder, bodyJa: '本文' }, { ...placeholder, url: 'https://x.com/trendspider/status/1' },
    { ...placeholder, generalSource: 1 }]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: true, items: [], officialUpdates: [bad] }), undefined, JSON.stringify(bad));
  }
});
