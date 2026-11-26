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
  // Owner, Nov 26: customer showcases built on the company's own product.
  'Indie filmmakers in India bring big-screen stories to life with Google Flow', 'How Wayfair uses Gemini to cut search costs',
  'Retailers build shopping agents with Gemini', 'Heart of the Matter: How a Major Children’s Hospital Uses Open Source NVIDIA AI for Cardiac Care',
  'In partnership with Amazon, Duracell Brings Holiday Magic to Chicago with Power Playland on the Pier',
];
// Launches, partnerships with a named company, expansions, results, regulation and analyst calls.
const KEPT = [
  'Introducing Gemini 4 Neon', 'Meet the new Pixel 11', 'Google launches Gemini 4 Neon: 5 ways to try it',
  'Golden State Warriors and Google expand partnership, naming Gemini the official AI assistant partner',
  'Nvidia to expand King\'s Cross hub in London', 'Nvidia builds Taiwan AI supercomputer with Foxconn', 'Microsoft and OpenAI sign new agreement',
  'Alphabet reports third-quarter revenue of $102 billion', 'Google agrees to buy Wiz for $32 billion', 'Google raises capex guidance to $93 billion',
  'US tightens export controls on Nvidia H20 chips to China', 'Bernstein raises Alphabet price target to $340',
];

test('company-blog marketing and customer showcases are not news; launches, partnerships and expansions are (owner, Nov 26)', () => {
  for (const title of SHOWCASES) assert.equal(isNotNews(title), true, title);
  for (const title of KEPT) assert.equal(isNotNews(title), false, title);
  assert.equal(isNotNews('ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう', SHOWCASES[0]), true);
  assert.equal(isNotNews('ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう', 'Gemini 4 Neon'), true);
  assert.equal(isNotNews('Google Flowでインドの独立系映画製作者が大画面の物語を実現', SHOWCASES[11]), true);
  for (const title of ['エヌビディア、ロンドンのキングスクロス拠点を拡大へ',
    'ゴールデンステート・ウォリアーズと提携し、Geminiを公式AIアシスタントパートナーに拡大']) assert.equal(isNotNews(title, 'x'), false, title);
  // A stored company-wire row is hidden on read.
  const row = (id, titleEn, titleJa) => ({ id, titleEn, titleJa, publisher: 'P', origin: 'third-party', url: `https://example.com/${id}`, publishedAt: '2026-11-26T03:00:00Z' });
  const wire = { GOOGL: [row('neon', SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう'), row('flow', SHOWCASES[11], 'Google Flowでインドの独立系映画製作者が大画面の物語を実現'), row('warriors', KEPT[3], 'ゴールデンステート・ウォリアーズと提携し、Geminiを公式AIアシスタントパートナーに拡大')] };
  assert.deepEqual(wireStories(wire, 'ja', new Set(['GOOGL'])).map(story => story.id), ['warriors']);
});

test('an official company-blog showcase is hidden on read, by its English or its Japanese title (owner, Nov 26)', () => {
  const official = (title, translationJa) => ({ id: '1', title, translationJa, tickers: ['GOOGL'], publisher: 'Google', url: 'https://blog.google/x/', observedAt: '2026-11-26T03:00:00Z', publishedAt: '2026-11-26T02:00:00Z' });
  assert.equal(officialNotNews(official(SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), true);
  assert.equal(officialNotNews(official('Gemini 4 Neon builders', 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), true);
  assert.equal(informativeOfficial(official(SHOWCASES[0], 'ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう')), false);
  assert.equal(officialNotNews(official('Introducing Gemini 4 Neon', 'Gemini 4 Neon を発表')), false);
  assert.equal(officialNotNews(official(KEPT[3], 'ゴールデンステート・ウォリアーズと提携し、Geminiを公式AIアシスタントパートナーに拡大')), false);
  assert.equal(officialNotNews(official(SHOWCASES[11], 'Google Flowでインドの独立系映画製作者が大画面の物語を実現')), true);
});

test('the showcase pattern matches scripts/research/company_wire.py', () => {
  const python = readFileSync(new URL('../scripts/research/company_wire.py', import.meta.url), 'utf8');
  const block = python.match(/MARKETING_SHOWCASE_EN = \(\n([\s\S]*?)\n\)/)[1];
  assert.equal([...block.matchAll(/r"([^"]*)"/g)].map(match => match[1]).join(''), MARKETING_SHOWCASE_EN.source.replaceAll('\\/', '/'));
});

// Owner, Nov 26 (「こういう関係のない記事はまだまだたくさんある」): headlines from the served feed that are not news about a company.
const AUDIT_DROPS = [
  'FormFactor Announces Participation at Upcoming Conferences', 'Dropbox to Present at the 2026 UBS Global Technology and AI Conference',
  'Cellebrite Announces Participation in the UBS Global Technology and AI Conference', 'Autodesk to present at upcoming investor conferences',
  'Cango Inc. to Report Third Quarter 2026 Financial Results on November 30, 2026, Eastern Time',
  'DSC Holdings Ltd. to Report Third Quarter 2026 Unaudited Financial Results on Thursday, December 3, 2026',
  'Hydreight Technologies Announces Timing of Q3 2026 Financial Results and Earnings Call', 'Uniserve Announces Grant of Incentive Stock Options',
  'Options Now Available on ANUU, ANDD & ANSS: Leverage Shares by Themes 2X Long, 2X Short and 1X Short Anthropic (ANT) ETFs',
  'CDW Canada Named 2026 Cisco Partner of the Year for Cloud & AI and SMB',
  'Anthropic Rebounds From 10% Drop as Markets Stage Dramatic Recovery | Closing Bell',
  'Freedom Gold Corp. Announces Extension and Amendment of FT Offering and Extension of Unit Offering',
  'A Man in Denver Has Been Throwing Eggs at Waymo Vehicles', "Former Tesla engineer says AI will create more 'fake jobs' — not mass unemployment",
  'Remedy says Microsoft decides whether Quantum Break gets a sequel', 'Nvidia, Micron and Oracle Shares Fall as AI Sell-Off Continues; Key Reasons Behind the Decline',
  'Where the market may be mispricing risk most: AI boom, volatility, high-yield bonds', "Mulvaney: Trump ‘Reading the Room Wrong' on Huang",
  "Holtz-Eakin: 50bps Hike Would Send ‘Important Message'",
];
const AUDIT_KEEPS = [
  'Amazon to launch Amazon Autos in UK in early 2027 in first expansion beyond US', 'GDS Holdings Limited Reports Third Quarter 2026 Results',
  'Schrödinger Acquires ENPICOM to Establish End-to-End Computational Platform for Biologics Discovery', 'EU postpones discussion to approve Tesla\'s self-driving tech',
  'Nutanix Stock Gets Body-Slammed on Surprise CEO Exit. Why Some Analysts Aren\'t Sweating It.', 'Palantir wins $480 million Army contract award',
  "S&P Global places Nvidia rating on 'CreditWatch Negative' on rising management and governance risks", 'South Korea raises rates to highest in two years, as inflation remains above target',
  "Exclusive: Nvidia in talks to supply ‘Rubin' chips to Saudi venture", 'Nvidia to report fourth-quarter results', 'Nasdaq 100 Bounces Off Tech-Driven Lows',
  'iQIYI Announces Receipt of Minimum Bid Price Notice from Nasdaq', 'Kioxia and NVIDIA Collaborate to Expand Effective High-Bandwidth Memory Capacity with SSDs',
  'IQM Quantum Computers Partners with QAI, a South Korean Quantum-AI company to Deploy a Quantum Computer', 'Nvidia unveils Rubin Ultra at GTC conference',
];

test('the audited not-news rows are left out and the audited news is kept (owner, Nov 26)', () => {
  for (const title of AUDIT_DROPS) assert.equal(isNotNews(title), true, title);
  for (const title of AUDIT_KEEPS) assert.equal(isNotNews(title), false, title);
});

test('a headline filed under a company it does not name, naming another roster company, is left out of that company (owner, Nov 26)', async () => {
  const { offSubject } = await import('../lib/research/company-subjects.ts');
  assert.equal(offSubject('GOOGL', "Nvidia to expand King's Cross hub in London", 'gnews'), true);
  assert.equal(offSubject('NVDA', "Nvidia to expand King's Cross hub in London", 'gnews'), false);
  assert.equal(offSubject('GOOGL', 'Golden State Warriors expand Gemini partnership', 'gnews'), false);
  assert.equal(offSubject('GOOGL', 'Anthropic signs deal for one million TPUs', 'gnews'), false);
  assert.equal(offSubject('AVGO', "TSMC CoWoS Fully Booked as Orders Overflow; ASE and Amkor's Demand to Surge", 'gnews'), true);
  assert.equal(offSubject('NVDA', 'Michael Burry Says He’s Shorting The Market’s ‘Generals’ As Apple Flashes A Warning', 'yahoo'), true);
  assert.equal(offSubject('MU', 'Nvidia, Micron and Oracle Shares Fall as AI Sell-Off Continues', 'gnews'), false);
  assert.equal(offSubject('GOOGL', 'Fed holds rates steady', 'gnews'), false); // names no company: not judged
  assert.equal(offSubject('KXHCF', 'Kioxia and NVIDIA Collaborate', 'gnews'), false); // a ticker outside the roster is not judged
  // The Stock News API files a story under the companies it is about; its rows (and rows of unknown source) are not judged.
  assert.equal(offSubject('GOOGL', "Nvidia to expand King's Cross hub in London", 'stocknews'), false);
  assert.equal(offSubject('GOOGL', "Nvidia to expand King's Cross hub in London"), false);
  const row = (id, titleEn, titleJa) => ({ id, titleEn, titleJa, publisher: 'P', origin: 'third-party', url: `https://example.com/${id}`, publishedAt: '2026-11-26T03:00:00Z', source: 'gnews' });
  const kings = row('kx', "Nvidia to expand King's Cross hub in London", 'エヌビディア、ロンドンのキングスクロス拠点を拡大へ');
  assert.deepEqual(wireStories({ GOOGL: [kings], NVDA: [kings] }, 'ja', new Set(['GOOGL', 'NVDA'])).map(story => story.tickers), [['NVDA']]);
  assert.deepEqual(wireStories({ GOOGL: [kings] }, 'ja', new Set(['GOOGL'])), []);
});

test('the roster names are one file, read by scripts/research/company_wire.py and copied into the monitor image', () => {
  const python = readFileSync(new URL('../scripts/research/company_wire.py', import.meta.url), 'utf8');
  assert.match(python, /lib\/research\/company-subjects\.json/);
  assert.match(readFileSync(new URL('../Dockerfile.research-monitor', import.meta.url), 'utf8'), /COPY lib\/research\/company-subjects\.json lib\/research\/company-subjects\.json/);
});
