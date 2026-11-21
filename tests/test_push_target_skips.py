"""Nov 20 (owner): "some price-target notices arrive and some don't; the latest MRVL one did not". MRVL (Stifel 370 -> 280) was posted
at 23:22 Japan time, inside the default おやすみモード (23-7 JST), so no device was sent it, and nothing in the log said so: skips were
logged for earnings flashes only. Nov 20 (owner): おやすみモード never holds a notice back any more; the MRVL change is sent at once,
silently and marked 「おやすみモード」. Synthetic subscriptions; no network delivery, no endpoint or key in any output."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
from test_web_push import subscription

PRODUCTION_OWNER = push.DEMO_OWNER_ACCOUNT_IDS[1]


def mrvl(published='2026-11-20T14:22:19+00:00', observed='2026-11-20T14:26:44.124000+00:00'):
    return {'ticker': 'MRVL', 'firm': 'Stifel', 'previous': 370, 'latest': 280, 'publishedAt': published, 'observedAt': observed}


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


class TargetSkipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'p.sqlite')
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'f', 'WEB_PUSH_PUBLIC_KEY': 'f',
                                           'WEB_PUSH_SUBJECT': 'mailto:f@example.test'})
        self.env.start()
        push.TARGET_SKIPS.clear(); push.TARGET_CHANGE_SKIPS.clear(); push._LOGGED_SKIPS.clear()
        push._COUNTED_TARGET_SKIPS.clear(); push._COUNTED_TARGET_DEVICE_SKIPS.clear()
        self.now = stamp('2026-11-20T14:26:55+00:00')
        push.register_member(self.db, {'memberId': PRODUCTION_OWNER, 'subscription': subscription('web.push.apple.com'),
                                       'accessExpiresAt': self.now + 3600, 'allTargets': True, 'language': 'ja'}, {'MRVL'}, stamp('2026-11-18T13:55:41+00:00'))

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def deliver(self, items, now=None):
        now = self.now if now is None else now
        sent, out = [], io.StringIO()
        with contextlib.redirect_stdout(out):
            result = push.deliver(self.db, items, lambda sub, payload: sent.append(payload) or 201, now, wall_now=lambda: now,
                                  entitlement=lambda owner: now + 3600)
        return result, sent, [json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]

    def test_the_mrvl_change_at_23_22_japan_time_is_sent_at_once_silently_and_marked(self):
        result, sent, lines = self.deliver([mrvl()])
        self.assertEqual((result['attempted'], result['accepted'], result['quiet']), (1, 1, 1))
        self.assertEqual(sent, [{'title': 'おやすみモード・MRVL · 目標株価の変更', 'body': 'Stifel: $370 → $280', 'tag': sent[0]['tag'],
                                 'url': '/research/price-targets', 'silent': True}])
        # Quiet is no longer a skip reason: a count on the result line instead.
        self.assertEqual([line for line in lines if line['event'] == 'push-target-skip'], [])
        self.assertEqual(result['priceTargetSkipsSinceStart'], {})
        results = [line for line in lines if line['event'] == 'push-target-result']
        self.assertEqual([(r['ticker'], r['sent'], r['accepted'], r['quiet']) for r in results], [('MRVL', 1, 1, 1)])
        self.assertGreaterEqual(result['quietSendsSinceStart'], 1)
        # The next poll does not send it again.
        _, again, _ = self.deliver([mrvl()], self.now + 5)
        self.assertEqual(again, [])

    def test_the_same_change_in_the_daytime_is_unchanged_without_the_mark_or_silent(self):
        day = mrvl(published='2026-11-20T03:22:19+00:00', observed='2026-11-20T03:26:44+00:00')  # 12:22 Japan time
        result, sent, _ = self.deliver([day], stamp('2026-11-20T03:26:55+00:00'))
        self.assertEqual((result['attempted'], result['quiet']), (1, 0))
        self.assertEqual(sent, [{'title': 'MRVL · 目標株価の変更', 'body': 'Stifel: $370 → $280', 'tag': sent[0]['tag'],
                                 'url': '/research/price-targets'}])

    def test_a_change_from_the_night_sent_after_7_is_an_ordinary_notice(self):
        # Nov 20 (HQ): the send time alone decides. Posted 06:55 Japan time, sent 07:05: no mark, not silent.
        dawn = mrvl(published='2026-11-20T21:55:00+00:00', observed='2026-11-20T22:04:30+00:00')
        result, sent, _ = self.deliver([dawn], stamp('2026-11-20T22:05:00+00:00'))
        self.assertEqual((result['attempted'], result['quiet']), (1, 0))
        self.assertEqual((sent[0]['title'], 'silent' in sent[0]), ('MRVL · 目標株価の変更', False))

    def test_an_earnings_flash_in_quiet_hours_is_sent_silently_and_marked(self):
        flash = {'kind': 'earnings', 'ticker': 'MRVL', 'period': 'Q3', 'titleJa': 'MRVL Q3決算：売上高が予想を上回る',
                 'titleEn': 'MRVL Q3 earnings beat', 'publishedAt': '2026-11-20T14:22:00+00:00', 'observedAt': '2026-11-20T14:26:44+00:00'}
        result, sent, lines = self.deliver([flash])
        self.assertEqual((result['attempted'], result['quiet']), (1, 1))
        self.assertEqual((sent[0]['title'], sent[0]['body'], sent[0]['url'], sent[0]['silent']),
                         ('おやすみモード・MRVL · 決算速報', 'MRVL Q3決算：売上高が予想を上回る', '/research/news', True))
        self.assertEqual([line['quiet'] for line in lines if line['event'] == 'push-result'], [1])

    def test_the_device_settings_decide_when_a_notice_is_quiet(self):
        # Hours off: the night change arrives as usual.
        self.db.execute('UPDATE push_devices SET quiet_on=0'); self.db.commit()
        _, sent, _ = self.deliver([mrvl()])
        self.assertEqual((sent[0]['title'], 'silent' in sent[0]), ('MRVL · 目標株価の変更', False))
        # Own hours (12-14 Japan time): 12:22 is quiet, 23:22 is not.
        self.db.execute('DELETE FROM push_deliveries')
        self.db.execute('UPDATE push_devices SET quiet_on=1, quiet_start=12, quiet_end=14'); self.db.commit()
        _, night, _ = self.deliver([mrvl()])
        self.assertNotIn('silent', night[0])
        noon = mrvl(published='2026-11-21T03:22:19+00:00', observed='2026-11-21T03:26:44+00:00')  # the next day, 12:22 Japan time
        _, day, _ = self.deliver([noon], stamp('2026-11-21T03:26:55+00:00'))
        self.assertEqual((day[0]['title'], day[0]['silent']), ('おやすみモード・MRVL · 目標株価の変更', True))

    def test_an_english_device_is_marked_quiet_mode_in_its_own_hours(self):
        self.db.execute("UPDATE push_devices SET language='en', quiet_zone='America/New_York'"); self.db.commit()
        late = mrvl(published='2026-11-21T04:22:19+00:00', observed='2026-11-21T04:26:44+00:00')  # 23:22 ET
        _, sent, _ = self.deliver([late], stamp('2026-11-21T04:26:55+00:00'))
        self.assertEqual((sent[0]['title'], sent[0]['body'], sent[0]['silent']), ('Quiet mode · MRVL · Price target update', 'Stifel: $370 → $280', True))

    def test_other_notices_in_quiet_hours_are_sent_silently_too(self):
        self.db.execute('UPDATE push_devices SET weekly_issue=1'); self.db.commit()
        sent = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = push.deliver_weekly_issues(self.db, [{'id': 'w-9', 'number': 9, 'publishedAt': '2026-11-20T14:20:00+00:00'}],
                                                transport=lambda sub, payload: sent.append(payload) or 201, now=self.now,
                                                wall_now=lambda: self.now, entitlement=lambda owner: self.now + 3600)
        self.assertEqual(result['attempted'], 1)
        self.assertEqual((sent[0]['title'], sent[0]['body'], sent[0]['url'], sent[0]['silent']),
                         ('おやすみモード・週刊 Tech Phase PRO', '第9号が公開されました', '/research/weekly', True))

    def test_the_backlog_is_counted_once_per_change_and_reason_however_many_polls(self):
        # Nov 20: /health showed 86,592 'published-not-fresh' minutes after a deploy, because every poll counted the backlog again.
        self.register_second_device()
        old = [mrvl(published=f'2026-11-1{day}T12:00:00+00:00', observed=f'2026-11-1{day}T12:01:00+00:00') for day in range(5)]
        for poll in range(20):
            result, sent, _ = self.deliver(old, self.now + poll * 5)
        self.assertEqual(sent, [])
        self.assertEqual(result['priceTargetSkipsSinceStart'], {'published-not-fresh': 5})
        self.assertEqual(push.TARGET_SKIPS, {'published-not-fresh': 5})
        # Per change, the result line's count is the number of devices (two), not devices x polls.
        self.assertEqual({counts['published-not-fresh'] for counts in push.TARGET_CHANGE_SKIPS.values()}, {2})
        # A new reason for the same change is counted once more.
        self.db.execute('UPDATE push_devices SET tickers=?', ('["AAPL"]',)); self.db.commit()
        for poll in range(3):
            self.deliver([mrvl()], self.now + poll)
        self.assertEqual(push.TARGET_SKIPS, {'published-not-fresh': 5, 'ticker-not-watched': 1})

    def register_second_device(self):
        push.register_member(self.db, {'memberId': PRODUCTION_OWNER, 'subscription': subscription('fcm.googleapis.com'),
                                       'accessExpiresAt': self.now + 3600, 'allTargets': True, 'language': 'ja'}, {'MRVL'}, stamp('2026-11-18T13:55:41+00:00'))

    def test_the_owner_receives_a_price_target_change_outside_the_quiet_hours_with_one_result_line(self):
        # AMZN Oppenheimer, Nov 20 22:21 JST: sent to the owner's phone in production.
        amzn = {'ticker': 'AMZN', 'firm': 'Oppenheimer', 'previous': 285, 'latest': 310,
                'publishedAt': '2026-11-20T13:21:04+00:00', 'observedAt': '2026-11-20T13:25:45.679000+00:00'}
        now = stamp('2026-11-20T13:25:57+00:00')
        result, sent, lines = self.deliver([amzn], now)
        self.assertEqual((result['attempted'], result['accepted']), (1, 1))
        self.assertEqual(sent[0]['url'], '/research/price-targets')
        results = [line for line in lines if line['event'] == 'push-target-result']
        self.assertEqual(len(results), 1)
        self.assertEqual((results[0]['ticker'], results[0]['firm'], results[0]['sent'], results[0]['accepted']), ('AMZN', 'Oppenheimer', 1, 1))
        output = json.dumps(lines)
        self.assertNotIn('endpoint', output); self.assertNotIn('push/test', output); self.assertNotIn(PRODUCTION_OWNER, output)

    def test_the_owner_with_quiet_hours_off_receives_the_mrvl_change(self):
        self.db.execute('UPDATE push_devices SET quiet_on=0'); self.db.commit()
        result, sent, _ = self.deliver([mrvl()])
        self.assertEqual((result['attempted'], len(sent)), (1, 1))
        self.assertIn('MRVL', sent[0]['title'] + sent[0]['body'])

    def test_a_change_found_more_than_15_minutes_after_it_was_posted_is_logged_as_detected_late(self):
        self.db.execute('UPDATE push_devices SET quiet_on=0'); self.db.commit()
        late = mrvl(published='2026-11-20T14:05:00+00:00')
        result, sent, lines = self.deliver([late])
        self.assertEqual((result['attempted'], sent), (0, []))
        self.assertEqual([line['reason'] for line in lines if line['event'] == 'push-target-skip'], ['detected-late'])
        # The backlog (observed long ago) is passed over silently on every poll, as before.
        push._LOGGED_SKIPS.clear()
        _, _, quiet = self.deliver([mrvl(published='2026-11-19T12:00:00+00:00', observed='2026-11-19T12:01:00+00:00')])
        self.assertEqual([line for line in quiet if line['event'] == 'push-target-skip'], [])

    def test_earnings_skip_counters_are_unchanged_by_price_target_skips(self):
        push.SKIPS.clear()
        self.deliver([mrvl()])
        self.assertEqual(push.SKIPS, {})


if __name__ == '__main__':
    unittest.main()
