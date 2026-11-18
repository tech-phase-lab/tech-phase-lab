import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { capitalRows } from '../lib/research/capital-map.ts';
import { capitalPortfolioName, capitalProfiles } from '../lib/research/capital-map-profiles.ts';

const load = name => JSON.parse(readFileSync(new URL(`../lib/research/${name}.json`, import.meta.url), 'utf8'));
const portfolios = [load('capital-map-disclosures'), load('capital-map-corporate'), load('capital-map-additional-corporate'), load('capital-map-additional-managers')].flat();
const managers = portfolios.filter(p => p.kind === 'manager');
const corporates = portfolios.filter(p => p.kind === 'corporate');
const profileOf = p => capitalProfiles[p.id.split('-')[0]];

test('every fund manager has a Japanese and English firm name, person, role and description', () => {
  assert.equal(managers.length, 13);
  for (const p of managers) {
    const profile = profileOf(p);
    assert.ok(profile, p.id);
    const [ja, en] = profile.name ?? [];
    assert.equal(en, p.name, `${p.id}: English name stays the filed name`);
    assert.ok(ja && ja !== en && /[゠-ヿ]/.test(ja), `${p.id}: katakana name`);
    for (const pair of [profile.person, profile.role, profile.description]) {
      assert.equal(pair.length, 2, p.id);
      assert.ok(pair.every(value => typeof value === 'string' && value.trim()), p.id);
    }
    assert.match(profile.source, /^https:\/\//, p.id);
    assert.match(profile.descriptionSource, /^https:\/\//, p.id);
  }
});

test('manager and company descriptions are short factual descriptions, not disclaimers or slogans', () => {
  const disclaimer = /売買|示すもの|ではありません|開示保有|13F|個人資産全体|not the founder|not a complete|not solely|not total|aggregate|disclosed holdings|reportable/i;
  const opinion = /おすすめ|買い時|売り時|注目|有望|優れ|強み|リターン|好成績|best|outperform|recommend|should buy/i;
  for (const p of [...managers, ...corporates]) {
    const [ja, en] = profileOf(p).description;
    assert.match(profileOf(p).descriptionSource ?? '', /^https:\/\//, p.id);
    assert.doesNotMatch(`${ja} ${en}`, disclaimer, p.id);
    assert.doesNotMatch(`${ja} ${en}`, opinion, p.id);
    assert.ok((ja.match(/。/g) ?? []).length <= 2 && ja.endsWith('。'), `${p.id}: 1–2 Japanese sentences`);
    assert.ok((en.replace(/\b(U\.S|St|J\.P)\./g, '').match(/\.(\s|$)/g) ?? []).length <= 2 && en.endsWith('.'), `${p.id}: 1–2 English sentences`);
    // Each describes the firm itself by founding and base, like Berkshire's.
    // Thiel Macro's founding year is not stated in its SEC filings or other public references.
    if (p.id !== 'thiel-13f') {
      assert.match(ja, /(18|19|20)\d\d年/, `${p.id}: founding year`);
      assert.match(en, /\b(18|19|20)\d\d\b/, `${p.id}: founding year`);
    }
    assert.ok(/本社|拠点|米|ニューヨーク|ロンドン/.test(ja), `${p.id}: base`);
  }
  // Person rows are consistent: a named person, never the firm repeated as the "person".
  for (const p of managers) assert.notEqual(profileOf(p).person[1], p.name, p.id);
  const source = readFileSync(new URL('../lib/research/capital-map-profiles.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /創業者個人の売買|個人資産全体を示すものではありません|13F提出運用会社|関連運用会社/);
});

test('Japanese mode shows the katakana name; English mode keeps the filed name', () => {
  assert.equal(capitalPortfolioName('soros-13f', 'Soros Fund Management', 'ja'), 'ソロス・ファンド・マネジメント');
  assert.equal(capitalPortfolioName('berkshire-13f', 'Berkshire Hathaway', 'ja'), 'バークシャー・ハサウェイ');
  for (const p of managers) assert.equal(capitalPortfolioName(p.id, p.name, 'en'), p.name);
  // Companies stay English in both languages.
  for (const p of corporates) assert.equal(capitalPortfolioName(p.id, p.name, 'ja'), p.name);
  const screen = readFileSync(new URL('../app/research/capital-map/screen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /<option key=\{item\.id\} value=\{item\.id\}>\{portfolioLabel\(item\)\}<\/option>/);
  assert.match(screen, /className=\{styles\.selectSubtitle\} lang="en">\{selectedSubtitle\}/);
});

test('every company has a profile with a person, role and description', () => {
  assert.equal(corporates.length, 14);
  for (const p of corporates) {
    const profile = profileOf(p);
    assert.ok(profile, p.id);
    for (const pair of [profile.person, profile.role, profile.description]) assert.ok(pair.every(value => value.trim()), p.id);
    // Company names stay English: no katakana firm name.
    assert.equal(profile.name, undefined, p.id);
  }
  // The old one-line slogans are gone.
  assert.doesNotMatch(profileOf(corporates[0]).description[0], /^GPUを軸に/);
});

test('added corporate 13F reports reconcile full SEC totals for both quarters', () => {
  const data = load('capital-map-additional-corporate');
  assert.deepEqual(data.map(p => p.id), ['amd-13f', 'uber-13f', 'walmart-13f', 'jnj-13f', 'pfizer-13f', 'merck-13f', 'regeneron-13f', 'gilead-13f', 'ge-13f']);
  assert.deepEqual(data.map(p => p.current.source.totalValue), [1311750821, 4505994682, 735998250, 798650757, 170365906, 526407169, 177219142, 1648747919, 368854317]);
  for (const p of data) {
    assert.equal(p.kind, 'corporate');
    for (const [period, date] of [['current', '2026-06-30'], ['previous', '2026-03-31']]) {
      const snapshot = p[period];
      assert.equal(snapshot.asOf, date);
      assert.equal(snapshot.complete, true);
      assert.equal(snapshot.holdings.reduce((sum, h) => sum + h.value, 0), snapshot.source.totalValue);
      assert.ok(snapshot.source.entryCount >= snapshot.holdings.length);
      assert.equal(new Set(snapshot.holdings.map(h => `${h.securityId}:${h.instrument}`)).size, snapshot.holdings.length);
      assert.match(snapshot.source.sha256, /^[a-f0-9]{64}$/);
      assert.match(snapshot.source.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\//);
      assert.equal(Number(snapshot.source.url.split('/')[6]), Number(p.current.source.url.split('/')[6]));
    }
    assert.ok(p.previous.publishedOn < p.current.publishedOn, p.id);
    assert.ok(Math.abs(capitalRows(p.current, p.previous).reduce((sum, h) => sum + h.weight, 0) - 100) < 1e-8);
  }
  const uber = data.find(p => p.id === 'uber-13f');
  assert.equal(uber.current.holdings.find(h => h.ticker === 'RIVN').securityId, '76954A103');
});
