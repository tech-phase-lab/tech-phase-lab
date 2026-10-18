import test from 'node:test';
import assert from 'node:assert/strict';
import { wireStories, isNotNews } from '../lib/research/wire-stories.ts';

const item = (id, titleEn, titleJa, publishedAt, origin = 'third-party') => ({ id, titleEn, titleJa, publisher: 'P', origin, url: `https://example.com/${id}`, publishedAt });
const WATCHED = new Set(['MU', 'SNDK', 'NVDA', 'CRWV']);

test('one story named by several companies is one row listing them all (owner, Oct 17)', () => {
  const wire = {
    MU: [item('a', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:33:00Z')],
    SNDK: [item('b', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:33:00Z')],
    NVDA: [item('c', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:50:00Z')],
  };
  const stories = wireStories(wire, 'ja', WATCHED);
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].tickers, ['MU', 'NVDA', 'SNDK']);
  assert.equal(stories[0].at, '2026-10-17T05:33:00.000Z', 'the earliest posting time');
});

test('a reworded copy of the same story merges, and the company wire text wins', () => {
  const wire = {
    CRWV: [item('x', 'CoreWeave stock faces test of debt financing', 'コアウィーブ株は債務調達の試練に直面', '2026-10-17T05:18:00Z', 'wire')],
    NVDA: [item('y', 'CoreWeave stock faces a test of its debt financing', 'コアウィーブ株は負債調達の試練に直面', '2026-10-17T05:18:00Z')],
  };
  const [story, ...rest] = wireStories(wire, 'ja', WATCHED);
  assert.equal(rest.length, 0);
  assert.equal(story.title, 'コアウィーブ株は債務調達の試練に直面');
  assert.deepEqual(story.tickers, ['CRWV', 'NVDA']);
});

test('different stories, other days and unwatched companies stay apart', () => {
  const wire = {
    MU: [item('1', 'Micron raises its quarterly dividend', '配当を引き上げ', '2026-10-17T01:00:00Z'), item('2', 'Micron opens a new plant in Japan', '日本に新工場', '2026-10-17T02:00:00Z'),
         item('3', 'Micron raises its quarterly dividend', '配当を引き上げ', '2026-10-15T01:00:00Z')],
    ZZZ: [item('4', 'Unwatched company news', '対象外', '2026-10-17T03:00:00Z')],
  };
  const stories = wireStories(wire, 'ja', WATCHED);
  assert.deepEqual(stories.map(story => story.id), ['2', '1', '3']);
});

test('headlines that are not news about the company are left out', () => {
  for (const title of ['$NVIDIA (NVDA.US)$$SK hynix (SKHY.US)$ 私のお気に入りの恐竜はどこ？', 'Invesco QQQ Trust (QQQ) Sells NVIDIA and Apple on Oct. 14',
    '2 Tech Stocks to Buy Now and Hold for a Decade', 'Better AI Stock: SpaceX vs. Nvidia', "Don't miss these memory stocks", 'Lobbying Update: $110,000 of NVIDIA lobbying was just disclosed',
    'If the stock market crashes, history shows these 3 ETFs are the smartest buys',
    'If you only have $1,000 to invest, buy this one ETF and hold for 20 years',
    'Disney to pay 66 Character.AI employees $60M a year - Alphabet (NASDAQ:GOOGL)',
    'もし株式市場の暴落が来るなら、歴史が示すこれら3つのETFが最も賢い買いだ',
    'マイクロンとサンディスクを逃した？このメモリ株を見逃さないようにしよう。']) assert.equal(isNotNews(title), true, title);
  for (const title of ['Germany to unveil Nvidia AI agreement next week', 'StoneX maintains Buy rating on Microsoft, $600 price target', 'Micron raises its dividend']) assert.equal(isNotNews(title), false, title);
});

test('teaser headlines with no answer are left out', () => {
  for (const title of ['35 analysts cover SpaceX. Here\'s why their price targets have little to do with rockets', 'This is why Nvidia stock moved', 'The reason why memory prices keep rising',
    '35人のアナリストがスペースXをカバー。彼らの目標株価がロケットとはほとんど関係ない理由']) assert.equal(isNotNews(title), true, title);
});

test('Japanese headlines drop the comma after a bracket and keep a name with its ticker together', async () => {
  const { tidyJapanese } = await import('../lib/research/ja-text.ts');
  const out = tidyJapanese('アルファベット（GOOGL）、2028年までにトロントでロボタクシーサービスを計画');
  assert.ok(!out.includes('）、'));
  assert.equal(out.replaceAll('⁠', ''), 'アルファベット（GOOGL）2028年までにトロントでロボタクシーサービスを計画');
  assert.ok(out.startsWith('ア⁠ル'));
  assert.equal(tidyJapanese(out), out);
  assert.equal(tidyJapanese('Alphabet (GOOGL), plans robotaxis'), 'Alphabet (GOOGL), plans robotaxis');
});
