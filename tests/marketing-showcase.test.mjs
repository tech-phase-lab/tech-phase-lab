import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isNotNews as officialNotNews, informativeOfficial } from '../lib/research/news-presentation.ts';
import { isNotNews, wireStories } from '../lib/research/wire-stories.ts';
import { MARKETING_SHOWCASE_EN } from '../lib/research/marketing-showcase.ts';

// Owner, Nov 26: 速報 showed the GOOGL row 「ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう」 (a Google blog post).
const SHOWCASES = [
  'See what 5 builders are making with Gemini 4 Neon', 'See how developers are building agents with Gemini 4 Neon',
  '5 ways to use Gemini in Google Docs', 'Three new ways to get creative with Google Photos this holiday', 'Tips for holiday shopping with AI Mode',
  'How small businesses are using Gemini to grow', 'How these creators use YouTube Shorts', 'Meet the students building the future of AI',
  'Behind the scenes of the Pixel camera', 'Customer spotlight: Wayfair scales search with Vertex AI', 'Developer spotlight: an indie studio and Gemini',
];
// Launches, partnerships with a named company, expansions, results and the neighbouring GOOGL rows (kept until the owner decides).
const KEPT = [
  'Introducing Gemini 4 Neon', 'Meet the new Pixel 11', 'Google launches Gemini 4 Neon: 5 ways to try it',
  'Golden State Warriors and Google expand partnership, naming Gemini the official AI assistant partner',
  'Nvidia to expand King\'s Cross hub in London', 'Indie filmmakers in India bring big-screen stories to life with Google Flow',
  'Alphabet reports third-quarter revenue of $102 billion', 'Google agrees to buy Wiz for $32 billion', 'Google raises capex guidance to $93 billion',
  'US tightens export controls on Nvidia H20 chips to China', 'Bernstein raises Alphabet price target to $340',
];

test('company-blog marketing and customer showcases are not news; launches, partnerships and expansions are (owner, Nov 26)', () => {
  for (const title of SHOWCASES) assert.equal(isNotNews(title), true, title);
  for (const title of KEPT) assert.equal(isNotNews(title), false, title);
  assert.equal(isNotNews('ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう', SHOWCASES[0]), true);
  assert.equal(isNotNews('ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう', 'Gemini 4 Neon'), true);
  for (const title of ['Google Flowでインドの独立系映画製作者が大画面の物語を実現', 'エヌビディア、ロンドンのキングスクロス拠点を拡大へ',
    'ゴールデンステート・ウォリアーズと提携し、Geminiを公式AIアシスタントパートナーに拡大']) assert.equal(isNotNews(title, 'x'), false, title);
  // A stored company-wire row is hidden on read.
  const row = (id, titleEn, titleJa) => ({ id, titleEn, titleJa, publisher: 'P', origin: 'third-party', url: `https://example.com/${id}`, publishedAt: '2026-11-26T03:00:00Z' });
  const wire = { GOOGL: [row('neon', SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう'), row('flow', KEPT[5], 'Google Flowでインドの独立系映画製作者が大画面の物語を実現')] };
  assert.deepEqual(wireStories(wire, 'ja', new Set(['GOOGL'])).map(story => story.id), ['flow']);
});

test('an official company-blog showcase is hidden on read, by its English or its Japanese title (owner, Nov 26)', () => {
  const official = (title, translationJa) => ({ id: '1', title, translationJa, tickers: ['GOOGL'], publisher: 'Google', url: 'https://blog.google/x/', observedAt: '2026-11-26T03:00:00Z', publishedAt: '2026-11-26T02:00:00Z' });
  assert.equal(officialNotNews(official(SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), true);
  assert.equal(officialNotNews(official('Gemini 4 Neon builders', 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), true);
  assert.equal(informativeOfficial(official(SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), false);
  assert.equal(officialNotNews(official('Introducing Gemini 4 Neon', 'Gemini 4 Neon を発表')), false);
  assert.equal(officialNotNews(official(KEPT[3], 'ゴールデンステート・ウォリアーズと提携し、Geminiを公式AIアシスタントパートナーに拡大')), false);
  assert.equal(officialNotNews(official(KEPT[5], 'Google Flowでインドの独立系映画製作者が大画面の物語を実現')), false);
});

test('the showcase pattern matches scripts/research/company_wire.py', () => {
  const python = readFileSync(new URL('../scripts/research/company_wire.py', import.meta.url), 'utf8');
  const block = python.match(/MARKETING_SHOWCASE_EN = \(\n([\s\S]*?)\n\)/)[1];
  assert.equal([...block.matchAll(/r"([^"]*)"/g)].map(match => match[1]).join(''), MARKETING_SHOWCASE_EN.source.replaceAll('\\/', '/'));
});
