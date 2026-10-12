import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAlertMail, renderNextMorningMail, formatDate } from './mail-templates.ts';
import type { AlertEvent } from './alert-judge.ts';

const ev = (over: Partial<AlertEvent>): AlertEvent => ({
  kind: 'line_reached', symbol: 'AAA', date: '2027-01-20', close: 80, referencePrice: 100,
  dropPct: 20, newLines: [10, 20], ...over,
});
const urls = { planUrl: 'https://x.test/resolute', unsubscribeUrl: 'https://x.test/u/abc' };
const FORBIDDEN_JA = /必ず|確実|買ってください|売ってください|買い時|売り時|おすすめ|戻ります|べきです/;
const FORBIDDEN_EN = /\b(guarantee|guaranteed|you should (buy|sell)|buy now|sell now|will rebound|can't lose)\b/i;

test('下落ライン: 日英とも全銘柄・計画リンク・配信停止・免責を含む', () => {
  const items = [ev({}), ev({ symbol: 'BBB', close: 88.5, dropPct: 11.5, newLines: [10] })];
  for (const locale of ['ja', 'en'] as const) {
    const m = renderAlertMail({ locale, date: '2027-01-20', items, ...urls });
    assert.match(m.text, /AAA/); assert.match(m.text, /BBB/);
    assert.match(m.text, /\$80\.00/); assert.match(m.text, /\$88\.50/);
    assert.ok(m.text.includes(urls.planUrl)); assert.ok(m.text.includes(urls.unsubscribeUrl));
    assert.match(m.text, locale === 'ja' ? /投資助言ではありません/ : /not investment advice/);
  }
});

test('急騰のみ: 件名と本文が下落と別になる', () => {
  const s = ev({ kind: 'surge_cap', dropPct: undefined, newLines: undefined, risePct: 52.3, close: 152.3 });
  const ja = renderAlertMail({ locale: 'ja', date: 'd', items: [s], ...urls });
  const en = renderAlertMail({ locale: 'en', date: 'd', items: [s], ...urls });
  assert.match(ja.subject, /上昇の目安/); assert.match(ja.text, /\+52\.3%/);
  assert.match(en.subject, /upside marker/); assert.match(en.text, /up 52\.3%/);
});

test('文面: 禁止表現がない。主語は「あなたの計画では」', () => {
  for (const kind of ['line_reached', 'surge_cap'] as const) {
    const items = [ev({ kind, risePct: 50 })];
    const ja = renderAlertMail({ locale: 'ja', date: 'd', items, ...urls });
    const en = renderAlertMail({ locale: 'en', date: 'd', items, ...urls });
    assert.doesNotMatch(ja.subject + ja.text, FORBIDDEN_JA);
    assert.doesNotMatch(en.subject + en.text, FORBIDDEN_EN);
    assert.match(ja.text, /あなたの計画では/);
    assert.match(en.text, /In your plan/);
  }
});

test('翌朝メール: 3つのリンクと配信停止。1回きりの案内を含む。禁止表現なし', () => {
  const input = { doneUrl: 'https://x.test/a', skippedUrl: 'https://x.test/b', unsureUrl: 'https://x.test/c', ...urls };
  for (const locale of ['ja', 'en'] as const) {
    const m = renderNextMorningMail({ locale, ...input });
    for (const u of ['/a', '/b', '/c']) assert.ok(m.text.includes(`https://x.test${u}`));
    assert.ok(m.text.includes(urls.unsubscribeUrl));
    assert.doesNotMatch(m.subject + m.text, locale === 'ja' ? FORBIDDEN_JA : FORBIDDEN_EN);
  }
});

test('混在: 下落と急騰が同じメールにあれば、両方の説明と件名になる', () => {
  const items = [ev({}), ev({ kind: 'surge_cap', symbol: 'ZZZ', risePct: 50, close: 150, newLines: undefined, dropPct: undefined })];
  const ja = renderAlertMail({ locale: 'ja', date: '2027-01-20', items, ...urls });
  const en = renderAlertMail({ locale: 'en', date: '2027-01-20', items, ...urls });
  assert.match(ja.subject, /ラインと上昇の目安/); assert.match(ja.text, /下落のライン/); assert.match(ja.text, /上昇の目安は/);
  assert.match(en.subject, /line and an upside marker/); assert.match(en.text, /a line like this/); assert.match(en.text, /upside marker is your cue/);
});

test('入力: 空の通知はエラー。割合が欠けた通知もエラー(undefinedを文面に出さない)', () => {
  assert.throws(() => renderAlertMail({ locale: 'ja', date: 'd', items: [], ...urls }), RangeError);
  assert.throws(() => renderAlertMail({ locale: 'en', date: 'd', items: [ev({ dropPct: undefined })], ...urls }), RangeError);
});

test('日付: 日本語は「1月20日」、英語は「Jan 20」。形式が違えばそのまま', () => {
  assert.equal(formatDate('2027-01-20', 'ja'), '1月20日');
  assert.equal(formatDate('2027-01-20', 'en'), 'Jan 20');
  assert.equal(formatDate('abc', 'en'), 'abc');
  assert.equal(formatDate('2027-13-01', 'en'), '2027-13-01');
});

test('文面に undefined / NaN が出ない', () => {
  for (const locale of ['ja', 'en'] as const) {
    const m = renderAlertMail({ locale, date: '2027-01-20', items: [ev({})], ...urls });
    assert.doesNotMatch(m.subject + m.text, /undefined|NaN|--\d/);
  }
});
