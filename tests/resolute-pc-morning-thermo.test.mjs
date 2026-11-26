// RESOLUTE PC versions of ④ 翌朝のひとこと and ⑤ 相場の温度計, and 「いま」 in 4つの位置 on the phone too (owner, Nov 25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { marketPosition } from '../lib/resolute/market-position.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('4つの位置: trend from the 200-day average, temperature from the gauge score', () => {
  assert.equal(marketPosition({ score: 64, deviationPercent: 7.9 }), 1); // 上向き × 熱い
  assert.equal(marketPosition({ score: 30, deviationPercent: 2 }), 0); // 上向き × 冷えている
  assert.equal(marketPosition({ score: 20, deviationPercent: -4 }), 2); // 下向き × 冷えている
  assert.equal(marketPosition({ score: 70, deviationPercent: -0.1 }), 3); // 下向き × 熱い
  // Boundaries: exactly on the average counts as 上向き; a score of 50 counts as 熱い.
  assert.equal(marketPosition({ score: 50, deviationPercent: 0 }), 1);
  assert.equal(marketPosition({ score: 49.9, deviationPercent: 0 }), 0);
  for (const bad of [null, undefined, { score: NaN, deviationPercent: 1 }, { score: 50, deviationPercent: Infinity }]) assert.equal(marketPosition(bad), null);
});

const reading = (index, score, deviationPercent) => ({ status: 'ready', version: 'daily-close-v1', index, asOf: '2026-11-24', referenceFrom: '2016-11-24', observations: 2512, score, band: Math.min(4, Math.floor(score / 20)), drawdownPercent: -3.8, deviationPercent, drawdownPercentile: 58, deviationPercentile: 70 });
const snapshot = () => ({ asOf: '2026-11-24', nas100: reading('nas100', 64, 7.9), sox: reading('sox', 30, -2.5), vix: { status: 'ready', asOf: '2026-11-24', level: 18.6, percentile: 57 } });

test('相場の温度計: the phone glows the selected index\'s position; PC shows both meters, the pairs and 「いま」', async () => {
  const require = createRequire(import.meta.url), { renderToStaticMarkup } = require('react-dom/server');
  const dir = await mkdtemp(join(process.cwd(), '.gauge-pc-render-'));
  const state = globalThis.__gaugePC = { values: [], cursor: 0, review: null, desktop: false, useState(initial) { const i = this.cursor++; if (!(i in this.values)) this.values[i] = initial; return [this.values[i], v => { this.values[i] = v; }]; } };
  try {
    const outfile = join(dir, 'screen.cjs');
    await build({ entryPoints: ['app/resolute/thermometer/screen.tsx'], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' }, plugins: [{ name: 'isolated-gauge', setup(b) {
      b.onLoad({ filter: /thermometer\/screen\.tsx$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('import { useState } from "react";', 'const useState = initial => globalThis.__gaugePC.useState(initial);'), loader: 'tsx' }));
      b.onResolve({ filter: /^\.\.\/(tool-shell|review-context|flow-navigation|use-desktop)$/ }, args => ({ path: args.path, namespace: 'gauge-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'gauge-stub' }, () => ({ contents: 'export default function Stub(){return null};export const useReview=()=>globalThis.__gaugePC.review;export const useDesktop=()=>globalThis.__gaugePC.desktop;', loader: 'js' }));
    } }] });
    const { MarketGauge } = require(outfile);
    const render = (locale, s) => { state.cursor = 0; return renderToStaticMarkup(MarketGauge({ locale, snapshot: s })); };
    for (const locale of ['ja', 'en']) {
      const now = locale === 'ja' ? 'いま' : 'Now';
      // Phone: TP大型株100 (64, +7.9%) is 上向き × 熱い.
      state.desktop = false; state.values = [];
      let html = render(locale, snapshot());
      assert.equal((html.match(/data-now="true"/g) || []).length, 1);
      assert.match(html, new RegExp(`data-now="true" aria-label="${locale === 'ja' ? '上向き × 熱い' : 'Rising × Hot'} · ${now}"`));
      // Mobile 11 order: meter, TP恐怖指数, 4つの位置, then the two disclosures.
      const order = [locale === 'ja' ? '>TP恐怖指数</h2>' : '>TP Fear Index</h2>', 'id="market-positions-heading"', locale === 'ja' ? '計算方法の概要' : 'How it is calculated', locale === 'ja' ? '>くわしく<' : '>Details<'].map(x => html.indexOf(x));
      assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), order.join());
      assert.ok(html.includes(locale === 'ja' ? 'トレンドと相場の温度の組み合わせです。いまの位置が光ります。' : 'How the trend and the market temperature combine. The current position glows.'));
      assert.ok(html.includes(`>${now}</span>`));
      // The phone keeps its tabs and one meter.
      assert.equal((html.match(/<svg/g) || []).length, 1);
      // PC: both meters at once, the stats under each, TP恐怖指数 beside 4つの位置, the disclosures side by side.
      state.desktop = true; state.values = [];
      html = render(locale, snapshot());
      assert.equal((html.match(/<svg/g) || []).length, 2);
      assert.doesNotMatch(html, /aria-pressed="true">TP/); // no index tabs on PC
      for (const value of ['-3.8%', '+7.9%', '-2.5%']) assert.ok(html.includes(value), value);
      assert.equal((html.match(locale === 'ja' ? /252営業日高値から/g : /From the 252-session closing high/g) || []).length, 2);
      assert.ok(html.includes(locale === 'ja' ? '>TP恐怖指数</h2>' : '>TP Fear Index</h2>'));
      assert.ok(html.includes('>18.6%</p>'));
      assert.ok(html.includes(locale === 'ja' ? 'トレンドと相場の温度の組み合わせです。いまの位置が光ります。' : 'How the trend and the market temperature combine. The current position glows.'));
      assert.equal((html.match(/data-now="true"/g) || []).length, 1);
      assert.match(html, new RegExp(`data-now="true" aria-current="true"><h3>${locale === 'ja' ? '上向き × 熱い' : 'Rising × Hot'}<span[^>]*>${now}</span></h3>`));
      for (const detail of locale === 'ja' ? ['上昇が続いていますが、相場の価格は最近の水準より低い状態です。', '下落が続いていますが、相場の価格は最近の水準より高い状態です。'] : ['The market is trending upward, but prices are below recent levels.']) assert.ok(html.includes(detail), detail);
      assert.ok(html.includes(locale === 'ja' ? '計算方法の概要' : 'How it is calculated'));
      assert.doesNotMatch(html, /市場の警戒度|Market caution|過去10年内の位置|…/);
      // No reading: no cell glows.
      state.values = [];
      html = render(locale, { ...snapshot(), nas100: { status: 'unavailable', reason: 'not-configured' } });
      assert.doesNotMatch(html, /data-now="true"/);
      // Owner preview sample: the sample reading glows, never real numbers.
      state.review = { scenario: 'sample' }; state.values = [];
      html = render(locale, snapshot());
      assert.equal((html.match(/data-now="true"/g) || []).length, 1);
      assert.doesNotMatch(html, /\+7\.9%|18\.6%/);
      state.review = null;
    }
  } finally { delete globalThis.__gaugePC; await rm(dir, { recursive: true, force: true }); }
});

test('翌朝のひとこと: PC side by side with save beside ⑤; phone GOOD MORNING first, 受け取り方 below', () => {
  const screen = read('../app/resolute/notifications-screen.tsx');
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  const block = screen.slice(screen.indexOf(' if(isMorning) {'), screen.indexOf('// ③ 終値アラート (PC and phone).'));
  assert.ok(block.length > 100);
  for (const words of ['受け取り方', '翌朝のひとことを', '届く時間', '届け先', '届く通知の例', 'GOOD MORNING', 'この通知は、昨日のお知らせについて1回だけ届きます。']) assert.ok(block.includes(words), words);
  // PC: 受け取り方 left, GOOD MORNING right. Phone (mobile 10): GOOD MORNING first, 受け取り方 below.
  assert.match(block, /desktop\?<div className=\{pc\.morningPair\}>\{howYouGetIt\}\{goodMorning\}<\/div>:<>\{goodMorning\}\{howYouGetIt\}<\/>/);
  assert.match(block, /<FlowNavigation step=\{4\} locale=\{locale\} wide extra=\{saveButton\(/);
  assert.match(block, /\{timeButtons\}/);
  assert.match(block, /\{planDialogElement\}/);
  const css = read('../app/resolute/pc.module.css');
  assert.match(css, /\.morningPair \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 24px; align-items: stretch; \}/);
  // ③ keeps its own layouts (PC and phone) after ④'s block; the plan dialog belongs to ④ only.
  assert.match(screen, /\/\/ ③ 終値アラート \(PC and phone\)\./);
  assert.equal((screen.match(/\{planDialogElement\}/g) || []).length, 1);
});
