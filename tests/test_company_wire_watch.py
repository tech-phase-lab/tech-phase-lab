"""Owner, Nov 15: a translation stall must never silently empty the Japanese home news."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402
import incident_delivery  # noqa: E402
import monitor  # noqa: E402

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}
INTAKE = {**ENV, 'STOCK_NEWS_ENABLED': 'true', 'STOCK_NEWS_API_KEY': 'x' * 20, 'STOCK_NEWS_STREAMS': 'tech,market'}
MIN = 60


def answer(payload, key):
    items = json.loads(payload['input'])
    out = [{'id': i['id'], 'titleJa': '日本語の見出し', 'shortJa': '短い見出し', 'kind': 'news'} for i in items]
    return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'items': out}, ensure_ascii=False)}]}]}


def broken(payload, key):
    raise TimeoutError('slow')


class TranslationWatchTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.start = datetime(2026, 11, 15, 3, 0, tzinfo=timezone.utc).timestamp()
        monitor.connect(self.path).close()
        self.n = 0

    def tearDown(self):
        self.dir.cleanup()

    def arrive(self, at, count=1, ticker='AAPL'):
        """New Stock News stories, each a distinct story, seen at ``at``."""
        rows = []
        for _ in range(count):
            self.n += 1
            words = ' '.join(f'w{self.n}x{k}' for k in range(6))
            rows.append({'ticker': ticker, 'source': 'stocknews', 'title': f'Apple story {words}', 'publisher': 'Reuters',
                         'url': f'https://news.example/{self.n}', 'published': datetime.fromtimestamp(at, timezone.utc)})
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'Apple', seen_at=datetime.fromtimestamp(at, timezone.utc))

    def sync(self, at, env=ENV, started=None):
        with monitor.connect(self.path) as db:
            return company_wire.sync_incident(db, at, env, self.start if started is None else started)

    def incident(self, key):
        with monitor.connect(self.path) as db:
            row = db.execute('SELECT status,last_error_code FROM operational_incidents WHERE incident_key=?', (key,)).fetchone()
            sent = db.execute('SELECT COUNT(*) FROM incident_notification_outbox WHERE incident_key=?', (key,)).fetchone()[0]
        return (tuple(row) if row else None), sent

    def health(self, at, env=ENV):
        with monitor.connect(self.path) as db:
            return company_wire.translation_health(db, at, env)

    def test_health_block_reports_counts_ages_budget_and_results_without_headlines_or_secrets(self):
        self.arrive(self.start)
        self.arrive(self.start + 25 * MIN)
        company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + 26 * MIN)
        self.arrive(self.start + 27 * MIN)
        import stock_news
        with stock_news.connect(self.path) as db, db:
            stock_news.put_state(db, 'last_success:tech', '2026-11-15T03:20:00.000+00:00')
        state = self.health(self.start + 30 * MIN, INTAKE)
        self.assertEqual(state['pending'], {'count': 1, 'oldestMinutes': 3})
        self.assertEqual(state['waitingRetry'], 2)
        self.assertEqual((state['calls24h'], state['dailyLimit'], state['budgetReached']), (1, 6000, False))
        self.assertEqual(state['lastResult'], 'model-TimeoutError')
        self.assertIsNone(state['lastSuccessAt'])
        self.assertEqual(state['stockNewsIntake'], {'enabled': True, 'streams': {'tech': {'lastSuccessAt': '2026-11-15T03:20:00.000+00:00'}}})
        company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 31 * MIN)
        state = self.health(self.start + 31 * MIN, INTAKE)
        self.assertEqual(state['lastResult'], 'done')
        self.assertTrue(state['lastSuccessAt'].startswith('2026-11-15T03:31'))
        self.assertIsNone(state['failingSince'])
        text = json.dumps(state)
        self.assertNotIn('Apple story', text)
        self.assertNotIn('k' * 30, text)
        self.assertNotIn('x' * 20, text)

    def test_the_default_budget_is_6000_calls_and_a_typo_never_stops_translation(self):
        self.assertEqual(company_wire.daily_limit({}), 6000)
        self.assertEqual(company_wire.daily_limit({'COMPANY_WIRE_TRANSLATION_DAILY_LIMIT': 'abc'}), 6000)
        self.assertEqual(company_wire.daily_limit({'COMPANY_WIRE_TRANSLATION_DAILY_LIMIT': ' 800 '}), 800)

    def test_a_trickle_waits_20_seconds_and_only_a_full_batch_hurries_back(self):
        self.arrive(self.start, 2)
        self.assertEqual(company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 1), ('done', 20))
        self.arrive(self.start + 60, company_wire.TRANSLATION_BATCH + 5)
        self.assertEqual(company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 61), ('done', 3))
        self.assertEqual(company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 64), ('done', 20))
        self.assertEqual(company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 84), ('idle', 20))

    def test_budget_reached_is_one_critical_alert_that_resolves_when_calls_leave_the_window(self):
        env = {**ENV, 'COMPANY_WIRE_TRANSLATION_DAILY_LIMIT': '2'}
        for k in range(3):
            self.arrive(self.start + k * MIN)
            company_wire.run_once(self.path, transport=answer, env=env, now_ts=self.start + k * MIN + 1)
        self.assertEqual(self.sync(self.start + 3 * MIN, env), ['company-wire-translation-budget:2'])
        self.sync(self.start + 4 * MIN, env)
        self.assertEqual(self.incident('company-wire:translation-budget'), (('open', 'company-wire-translation-budget:2'), 1))
        self.assertEqual(self.sync(self.start + 86400 + 2 * MIN, env), [])
        self.assertEqual(self.incident('company-wire:translation-budget'), (('resolved', 'company-wire-translation-budget:2'), 2))

    def test_failures_for_15_minutes_alert_once_and_a_translated_batch_resolves(self):
        for k in range(0, 17, 2):
            self.arrive(self.start + k * MIN)
            company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + k * MIN + 1)
            company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + k * MIN + 30)  # idle between arrivals
        self.assertEqual(self.sync(self.start + 10 * MIN), [])
        self.assertEqual(self.sync(self.start + 17 * MIN), ['company-wire-translation-failing:model-TimeoutError'])
        self.sync(self.start + 18 * MIN)
        self.assertEqual(self.incident('company-wire:translation-failing')[1], 1)  # never repeated while open
        self.arrive(self.start + 19 * MIN)
        company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 19 * MIN + 1)
        self.assertEqual(self.sync(self.start + 20 * MIN), [])
        self.assertEqual(self.incident('company-wire:translation-failing'), (('resolved', 'company-wire-translation-failing:model-TimeoutError'), 2))

    def test_one_old_failure_followed_by_quiet_hours_is_not_an_alert(self):
        self.arrive(self.start)
        company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + 1)
        self.arrive(self.start + 3 * 3600)
        company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + 3 * 3600 + 1)
        self.assertEqual(self.sync(self.start + 3 * 3600 + 2 * MIN), [])

    def test_a_stall_alerts_after_30_minutes_with_old_rows_and_new_arrivals_then_resolves(self):
        env = {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'false'}  # translation switched off: nothing is translated
        for k in range(0, 61, 5):
            self.arrive(self.start + k * MIN)
            company_wire.run_once(self.path, transport=answer, env=env, now_ts=self.start + k * MIN + 1)
            self.sync(self.start + k * MIN + 2, env)
        # The first story is 20 minutes old at 0:20; the stall has lasted 30 minutes at 0:50.
        self.assertEqual(self.incident('company-wire:translation-stalled'), (('open', 'company-wire-translation-stalled:disabled'), 1))
        with monitor.connect(self.path) as db:
            opened = db.execute("SELECT at FROM incident_events WHERE incident_key='company-wire:translation-stalled'").fetchone()[0]
        self.assertTrue(opened.startswith('2026-11-15T03:50'))
        company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 61 * MIN)
        company_wire.run_once(self.path, transport=answer, env=ENV, now_ts=self.start + 61 * MIN + 3)
        self.assertEqual(self.sync(self.start + 62 * MIN, ENV), [])
        self.assertEqual(self.incident('company-wire:translation-stalled')[0][0], 'resolved')

    def test_no_stall_alert_when_no_new_stories_arrive(self):
        env = {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'false'}
        self.arrive(self.start)
        for k in range(0, 121, 10):
            self.sync(self.start + k * MIN, env)
        self.assertEqual(self.incident('company-wire:translation-stalled'), (None, 0))

    def test_a_restart_never_alerts_for_rows_or_failures_from_before_it(self):
        env = {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'false'}
        for k in range(0, 121, 10):  # two hours of untranslated stories and failures before the restart, never checked
            self.arrive(self.start + k * MIN)
            company_wire.run_once(self.path, transport=broken, env=ENV, now_ts=self.start + k * MIN + 1)
        restart = self.start + 121 * MIN
        self.arrive(restart)
        self.assertEqual(self.sync(restart + MIN, env, started=restart), [])
        self.assertEqual(self.sync(restart + 10 * MIN, env, started=restart), [])
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM operational_incidents').fetchone()[0], 0)

    def test_stock_news_intake_without_a_tech_success_for_30_minutes_alerts_and_resolves(self):
        import stock_news
        with stock_news.connect(self.path) as db, db:
            stock_news.put_state(db, 'last_success:tech', datetime.fromtimestamp(self.start - 5 * 3600, timezone.utc).isoformat())
        self.assertEqual(self.sync(self.start + MIN, INTAKE), [])  # old success before the restart: no alert yet
        self.assertEqual(self.sync(self.start + 29 * MIN, INTAKE), [])
        self.assertEqual(self.sync(self.start + 31 * MIN, INTAKE), ['stock-news-intake-stale:tech'])
        self.sync(self.start + 40 * MIN, INTAKE)
        self.assertEqual(self.incident('stock-news:intake-tech'), (('open', 'stock-news-intake-stale:tech'), 1))
        with stock_news.connect(self.path) as db, db:
            stock_news.put_state(db, 'last_success:tech', datetime.fromtimestamp(self.start + 41 * MIN, timezone.utc).isoformat())
        self.assertEqual(self.sync(self.start + 42 * MIN, INTAKE), [])
        self.assertEqual(self.incident('stock-news:intake-tech')[0][0], 'resolved')
        self.assertEqual(self.sync(self.start + 5 * 3600, ENV), [])  # intake switched off: no alert

    def test_phone_texts_are_short_japanese_and_name_the_cause(self):
        def claim(key, category, code, transition='opened'):
            return {'key': key, 'category': category, 'errorCode': code, 'transition': transition}
        budget = incident_delivery.push_message(claim('company-wire:translation-budget', 'company-wire', 'company-wire-translation-budget:6000'))
        self.assertEqual(budget['title'], '🚨 日本語ニュースの翻訳が1日の上限に達しました')
        self.assertIn('6000回', budget['body'])
        failing = incident_delivery.push_message(claim('company-wire:translation-failing', 'company-wire', 'company-wire-translation-failing:model-TimeoutError'))
        self.assertEqual(failing['title'], '🚨 日本語ニュースの翻訳が15分失敗し続けています')
        self.assertIn('model-TimeoutError', failing['body'])
        stalled = incident_delivery.push_message(claim('company-wire:translation-stalled', 'company-wire', 'company-wire-translation-stalled:disabled'))
        self.assertIn('翻訳が無効', stalled['body'])
        intake = incident_delivery.push_message(claim('stock-news:intake-tech', 'stock-news', 'stock-news-intake-stale:tech'))
        self.assertEqual(intake['title'], '🚨 Stock News API の取り込みが30分止まっています')
        done = incident_delivery.push_message(claim('company-wire:translation-stalled', 'company-wire', None, 'resolved'))
        self.assertEqual(done['title'], '✅ 日本語ニュースの翻訳が復旧しました')
        self.assertEqual(incident_delivery.push_message(claim('stock-news:intake-tech', 'stock-news', None, 'resolved'))['title'],
                         '✅ Stock News API の取り込みが復旧しました')


if __name__ == '__main__':
    unittest.main()
