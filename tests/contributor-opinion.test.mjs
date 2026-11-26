import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wireStories, isNotNews, contributorOpinion } from '../lib/research/wire-stories.ts';
import { flashRows } from '../lib/research/flash-rows.ts';
import { CONTRIBUTOR_OPINION_EN } from '../lib/research/contributor-opinion.ts';

// Owner, Nov 26: the NBIS row 「ネビウスの設備投資は誤解されていたので買いだ」 (Seeking Alpha contributor article, Google News, 04:57 UTC).
export const OPINIONS = [
  "Nebius' CapEx Was Misread, So I'm Buying (NASDAQ:NBIS)",
  "Nebius' CapEx Is Misunderstood: Buy",
  'Micron: The Memory Supercycle Has Legs: Strong Buy',
  'Oracle: Debt Is Piling Up: Sell',
  'Intel: Turnaround Takes Time: Hold (NASDAQ:INTC)',
  'CoreWeave: The Market Is Wrong: Strong Sell - Seeking Alpha',
  'Sandisk: This Is Not Over (Rating Upgrade)',
  'Palantir: Priced For Perfection (Rating Downgrade)',
  'AMD: Upgrading To Strong Buy',
  'Why I Sold All My Nvidia Shares',
  'Micron: Pounding The Buy Table (Double Upgrade)',
  "Nebius: Why I'm Extremely Bullish After The Crash (NASDAQ:NBIS)",
  "Nebius: A Meltdown I've Been Waiting For - Multi-Year AI Boom (Rating Upgrade) (NBIS)",
  "Broadcom Stock Hasn't Traded This Low Since July 2025. I Think It's a Buy.",
  'Micron Is A Strong Buy: Recent Market Action Is A Total Disconnect From Fundamentals (MU)',
];
// Brokerage rating and target changes, and other news, stay.
export const KEPT = [
  'Morgan Stanley upgrades Nebius to Buy, raises price target to $150',
  'Nebius initiated at Buy by Citi with $140 target',
  'Rosenblatt on Nebius: Buy',
  'Analyst reiterates Strong Buy on Nebius Group',
  'Freedom Capital Markets’ $314 Target Says Nebius’s Selloff Went Too Far',
  'Nebius Group drops 11% amid broad technology selloff (NBIS:NASDAQ)',
  'Nvidia: Sell-off deepens as export curbs widen',
  'SoftBank sold its entire Nvidia stake for $5.8 billion',
  'Nebius signs $17.4 billion GPU capacity deal with Microsoft',
  'Micron raises fiscal Q1 guidance on HBM demand',
  'Freedom Capital Markets maintains Nebius Group at Buy, keeps price target at $314',
  'Broadcom Inc. : Bernstein keeps its Buy rating',
  'Oppenheimer Maintains Marvell Technology(MRVL.US) With Buy Rating, Cuts Target Price to $325',
  'S&P considers Nvidia credit downgrade over governance and ‘key man’ risks',
];

test('contributor rating calls are not news; brokerage actions and news are kept (owner, Nov 26)', () => {
  assert.deepEqual(OPINIONS.filter(title => !isNotNews(title)), []);
  assert.deepEqual(KEPT.filter(title => contributorOpinion(title)), []);
});

test('the NBIS opinion piece leaves both 銘柄手帳 and 速報 (one flash-rows read feeds both), and nothing else does', () => {
  const at = '2026-11-26T04:57:02Z';
  const row = (id, titleEn, titleJa) => ({ id, titleEn, titleJa, publisher: 'Seeking Alpha', origin: 'third-party', url: `https://example.com/${id}`, publishedAt: at, source: 'gnews' });
  const wire = { NBIS: [row('op', "Nebius' CapEx Was Misread, So I'm Buying", 'ネビウスの設備投資は誤解されていたので買いだ'),
    row('ms', 'Morgan Stanley upgrades Nebius to Buy, raises price target to $150', 'モルガン・スタンレー、ネビウスを買いに格上げ、目標株価を150ドルに引き上げ')] };
  for (const lang of ['ja', 'en']) {
    assert.deepEqual(wireStories(wire, lang).map(story => story.id).length, 1, lang);
    const titles = flashRows(null, wire, lang).map(r => r.title);
    assert.equal(titles.length, 1, lang);
    assert.ok(!titles.some(title => /誤解|Misread/.test(title)), lang);
  }
});

test('the pattern is the one scripts/research/company_wire.py uses before translation', () => {
  const python = readFileSync(new URL('../scripts/research/company_wire.py', import.meta.url), 'utf8');
  const block = /CONTRIBUTOR_OPINION_EN = \(\n([\s\S]*?)\n\)/.exec(python)[1];
  const joined = [...block.matchAll(/^\s*r"(.*)"$/gm)].map(match => match[1]).join('');
  assert.equal(joined, CONTRIBUTOR_OPINION_EN.source);
});
