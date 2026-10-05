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
