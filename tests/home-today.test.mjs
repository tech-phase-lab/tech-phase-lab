import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { countTodayEvents, countTodayNews, countTodayTargets } from '../lib/research/home-today.ts';
import { calendarEvents, selectCalendarEvents } from '../lib/research/calendar.ts';

// 11:00 JST on Oct 14, which is 22:00 ET on Oct 13.
const now = Date.parse('2026-10-14T02:00:00Z');

test('today events are counted by the calendar screen\'s own selector, in its opening zone', () => {
  const jst = selectCalendarEvents(calendarEvents, 'all', '2026-10-14', now, 'Asia/Tokyo');
  assert.deepEqual(jst.map(event => event.id).sort(), ['asml-q3-2026-call', 'asml-q3-2026-release', 'cpi-2026-10-14']);
  assert.equal(countTodayEvents(now, 'ja'), 3);
  // The English calendar opens in U.S. Eastern time, where it is still Oct 13.
  assert.equal(countTodayEvents(now, 'en'), selectCalendarEvents(calendarEvents, 'all', '2026-10-13', now, 'America/New_York').length);
});

test('today news counts what is listed with a publication date of today in Japan time', () => {
  const feed = (...at) => ({ ok: true, enabled: true, items: at.map((publishedAt, id) => ({ id: String(id), publishedAt })), officialUpdates: [], marketUpdates: [] });
  assert.equal(countTodayNews(null, 'ja', now), null);
  assert.equal(countTodayNews(feed(), 'ja', now), 0);
  // 14:59Z on Oct 13 is 23:59 JST Oct 13; 15:00Z is 00:00 JST Oct 14.
  assert.equal(countTodayNews(feed('2026-10-13T14:59:00Z', '2026-10-13T15:00:00Z', '2026-10-14T01:00:00Z'), 'ja', now), 2);
});

test('today target changes follow the zone the cards show, and a failed read is not a zero', () => {
  const item = publishedAt => ({ id: 1, publishedAt, ticker: 'MU', firm: 'X', previous: 1, latest: 2 });
  assert.equal(countTodayTargets(null, 'ja', now), null);
  assert.equal(countTodayTargets([item('2026-10-13T14:00:00Z'), item('2026-10-14T01:00:00Z')], 'ja', now), 1);
  assert.equal(countTodayTargets([item('2026-10-14T01:00:00Z')], 'en', now), 1);
  assert.equal(countTodayTargets([], 'ja', now), 0);
});

test('the TODAY row is for PRO and the owner, shows dashes for unreadable counts, and links to the right places', async () => {
  const source = await readFile(new URL('../app/research/home-today.tsx', import.meta.url), 'utf8');
  assert.match(source, /plan !== "pro" && !owner\) return null/);
  assert.match(source, /count === null \? "–"/);
  assert.match(source, /scrollToSection\("home-news"\)/);
  assert.match(source, /href="\/research\/calendar"/);
  assert.match(source, /scrollToSection\("home-price-targets"\)/);
  for (const text of ['新着ニュース', '今日の予定', '目標株価更新', 'New news', 'Today’s events', 'Target price changes']) assert.ok(source.includes(text), text);
  const css = await readFile(new URL('../app/research/home-today.module.css', import.meta.url), 'utf8');
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /#1f2a3b/);
  assert.match(css, /#5dffb4/);
  assert.doesNotMatch(css, /animation/);
  const dashboard = await readFile(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8');
  assert.ok(dashboard.indexOf('<HomeTools') < dashboard.indexOf('<HomeToday') && dashboard.indexOf('<HomeToday') < dashboard.indexOf('<NewsFeed'));
});
