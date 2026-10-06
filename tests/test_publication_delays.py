import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import headline_translation as translation
import monitor
import pipeline_status
import service
import test_headline_translation as fixtures
from test_headline_translation import ENV, NOW, SOURCE


class RetryScheduleTests(unittest.TestCase):
    def test_rejected_copy_retries_in_minutes_not_hours(self):
        self.assertEqual([translation.retry_delay(n, 'changed-direction') for n in range(1, 7)],
                         [15, 120, 1800, 3600, 7200, 14400])
        self.assertEqual(translation.retry_delay(20, 'unsupported-number'), 21600)

    def test_provider_outage_is_capped_at_thirty_minutes(self):
        self.assertEqual([translation.retry_delay(n, 'provider-timeout') for n in (1, 2, 3, 9)], [60, 120, 240, 1800])
        self.assertEqual(translation.retry_delay(3, 'provider-http-503'), 240)

    def test_rate_limits_are_short_waits_with_parallel_workers(self):
        self.assertEqual([translation.retry_delay(n, 'provider-rate-limit') for n in (1, 2, 3, 9)], [60, 120, 240, 1800])

    def test_auth_and_legacy_callers_keep_the_slow_schedule(self):
        for kind in ('provider-auth', 'provider-http-401', None):
            self.assertEqual([translation.retry_delay(n, kind) for n in (1, 2, 3, 4)], [60, 120, 3600, 7200])


class InterruptedJobTests(unittest.TestCase):
    def test_restart_releases_only_jobs_left_running(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'db.sqlite'
            with translation.connect(path) as db:
                for url, state, next_at in (('a', 'running', NOW + 300), ('b', 'retry', NOW + 3600), ('c', 'done', NOW + 300)):
                    db.execute("INSERT INTO signal_headline_translation_jobs(source_id,url,sha,attempts,next_at,lease,state) "
                               "VALUES('s',?,'x',1,?,?,?)", (url, next_at, url, state))
            self.assertEqual(service.release_interrupted_jobs(path, now=NOW), 1)
            with translation.connect(path) as db:
                rows = dict(db.execute('SELECT url,next_at FROM signal_headline_translation_jobs').fetchall())
            self.assertEqual(rows, {'a': NOW, 'b': NOW + 3600, 'c': NOW + 300})

    def test_relaxed_checks_retry_their_rejections_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'db.sqlite'
            with translation.connect(path) as db:
                for url, kind in (('a', 'changed-negation'), ('b', 'changed-names'), ('c', 'changed-numbers')):
                    db.execute("INSERT INTO signal_headline_translation_jobs(source_id,url,sha,attempts,next_at,lease,state,failure_kind) "
                               "VALUES('s',?,'x',3,?,?,'retry',?)", (url, NOW + 21600, url, kind))
            self.assertEqual(service.release_relaxed_rejections(path, now=NOW), 2)
            self.assertEqual(service.release_relaxed_rejections(path, now=NOW), 0)
            with translation.connect(path) as db:
                rows = dict(db.execute('SELECT url,next_at FROM signal_headline_translation_jobs').fetchall())
            self.assertEqual(rows, {'a': NOW, 'b': NOW, 'c': NOW + 21600})


class NewsCacheTests(unittest.TestCase):
    def test_concurrent_visitors_share_one_computation(self):
        app = service.AutomaticMonitor.__new__(service.AutomaticMonitor)
        app.news_cache_seconds, app.news_cache_lock, app.news_cache = 2, threading.Lock(), {}
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        app.db_path = Path(tmp.name) / 'db.sqlite'
        app.db_path.write_bytes(b'v1')
        calls = []

        def compute(original_preview=False):
            calls.append(original_preview)
            time.sleep(0.05)
            # The feed computation and workers commit writes meanwhile; waiting
            # requests must still share this result instead of recomputing.
            app.db_path.write_bytes(b'v' * (len(calls) + 2))
            return {'ok': True, 'n': len(calls)}
        app.compute_public_news = compute
        results = []
        barrier = threading.Barrier(8)

        def visitor():
            barrier.wait()  # All page requests arrive together.
            results.append(app.public_news())
        threads = [threading.Thread(target=visitor) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(calls, [False])
        self.assertEqual({result['n'] for result in results}, {1})
        app.public_news(original_preview=True)
        self.assertEqual(calls, [False, True])
        # The push detector may reuse a slightly older result.
        app.public_news(max_age=60)
        self.assertEqual(calls, [False, True])
        # A committed write (for example a withdrawal) is visible on the next request.
        app.db_path.write_bytes(b'v2 withdrawn')
        app.public_news()
        self.assertEqual(calls, [False, True, False])
        app.news_cache_seconds = 0
        app.public_news()
        self.assertEqual(len(calls), 4)


class PipelineStageTests(unittest.TestCase):
    setUp = fixtures.HeadlineTranslationTests.setUp

    def stage(self, now):
        with translation.connect(self.path) as db:
            [article] = pipeline_status.headline_articles(db, now=now, sources=[SOURCE])
        return article

    def test_article_moves_from_waiting_to_failed_to_published_with_timing(self):
        self.assertEqual(self.stage(NOW)['stage'], 'waiting')

        def reversed_copy(payload, key):
            return {'status': 'completed', 'output_text': json.dumps({'titleJa': 'ネビウスが新しいAI基盤の提供を否定'})}
        self.assertEqual(translation.run_once(self.path, reversed_copy, ENV, now=NOW, sources=[SOURCE]), 'retry')
        failed = self.stage(NOW + 1)
        self.assertEqual((failed['stage'], failed['failureKind'], failed['attempts']), ('failed', 'changed-negation', 1))
        self.assertIsNotNone(failed['nextRetryAt'])

        seen = []

        def corrected(payload, key):
            seen.append(json.loads(payload['input']))
            return {'status': 'completed', 'output_text': json.dumps({'titleJa': 'ネビウスが新しいAI基盤を発表'}, ensure_ascii=False)}
        with patch('builtins.print') as printed:
            self.assertEqual(translation.run_once(self.path, corrected, ENV, now=NOW + 15, sources=[SOURCE]), 'done')
        # The retry was due after 15 s and told the model why the first copy failed.
        self.assertEqual(seen[0]['previousRejection'], 'changed-negation')
        published = self.stage(NOW + 16)
        self.assertEqual(published['stage'], 'published')
        # Fixture clocks are in 2027 while publication uses the real clock, so only
        # the field's presence is checked here; elapsed_ms is covered separately.
        self.assertIn('acquiredToPublishedMs', published)
        self.assertEqual(pipeline_status.elapsed_ms('2027-01-01T00:15:10+00:00', '2027-01-01T00:15:40.5+00:00'), 30500)
        line = json.loads(printed.call_args.args[0])
        self.assertEqual((line['event'], line['lane'], line['id'], line['attempts']),
                         ('news-published', 'headline', str(self.event_id), 2))
        self.assertEqual(line['sourceToAcquiredMs'], 10000)
        self.assertNotIn('nebius.com', printed.call_args.args[0])
        summary = pipeline_status.summary([published])
        self.assertEqual(summary['headline']['stages']['published'], 1)



if __name__ == '__main__':
    unittest.main()


class ParallelTranslationTests(unittest.TestCase):
    setUp = fixtures.HeadlineTranslationTests.setUp

    def test_concurrent_workers_take_different_articles_once_each(self):
        with translation.connect(self.path) as db:
            db.execute('''INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,matches_json,
              event_kind,published_at,observed_at,excerpt,diff,truncated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)''', (
                SOURCE['id'], 'https://nebius.com/blog/second', 'sha-b', '', 'Nebius opens a new data center',
                '["NBIS"]', '{}', 'new', '2027-01-01T00:15:00+00:00', '2027-01-01T00:15:20+00:00', '', ''))
        env = {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '10'}
        titles, lock, both_running = [], threading.Lock(), threading.Barrier(2, timeout=5)
        copy = {'Nebius announces a new AI platform': 'ネビウスが新しいAI基盤を発表',
                'Nebius opens a new data center': 'ネビウスが新しいデータセンターを開設'}

        def transport(payload, key):
            title = json.loads(payload['input'])['title']
            with lock:
                titles.append(title)
            both_running.wait()  # Both model calls are in flight at the same time.
            return {'status': 'completed', 'output_text': json.dumps({'titleJa': copy[title]}, ensure_ascii=False)}
        results = []
        workers = [threading.Thread(target=lambda: results.append(
            translation.run_once(self.path, transport, env, now=NOW, sources=[SOURCE]))) for _ in range(2)]
        with patch('builtins.print'):
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join()
        self.assertEqual(sorted(results), ['done', 'done'])
        self.assertEqual(sorted(titles), sorted(copy))
        with translation.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_headline_translation_calls').fetchone()[0], 2)
