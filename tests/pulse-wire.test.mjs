import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

test('the top strip also carries watched-company headlines, newest first, in the shown language only', () => {
  const now = Date.parse('2026-10-15T07:00:00Z');
  const wire = {
    TSM: [{ id: 'a', titleJa: 'TSMC、需要が供給能力を大幅に上回っていると発表', titleEn: 'TSMC says demand far exceeds supply', url: 'https://example.com/a', publisher: 'Yahoo Finance', publishedAt: '2026-10-15T06:02:00Z' }],
    ZZZZ: [{ id: 'b', titleJa: '対象外の銘柄', titleEn: 'Unwatched', url: 'https://example.com/b', publisher: 'Yahoo Finance', publishedAt: '2026-10-15T06:30:00Z' }],
    NVDA: [{ id: 'c', titleJa: '', titleEn: 'English only', url: 'https://example.com/c', publisher: 'Yahoo Finance', publishedAt: '2026-10-15T06:40:00Z' }],
  };
  const ja = newsPulseItems({ ok: true, enabled: true, items: [] }, 'ja', now, wire);
  assert.deepEqual(ja.map(item => item.id), ['wire-a']);
  assert.equal(ja[0].ticker, 'TSM');
  const en = newsPulseItems({ ok: true, enabled: true, items: [] }, 'en', now, wire);
  assert.deepEqual(en.map(item => item.id).sort(), ['wire-a', 'wire-c']);
});
