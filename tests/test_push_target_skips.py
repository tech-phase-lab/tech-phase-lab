"""Nov 20 (owner): "some price-target notices arrive and some don't; the latest MRVL one did not". MRVL (Stifel 370 -> 280) was posted
at 23:22 Japan time, inside the default おやすみモード (23-7 JST), so no device was sent it, and nothing in the log said so: skips were
logged for earnings flashes only. Synthetic subscriptions; no network delivery, no endpoint or key in any output."""
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

    def test_the_mrvl_change_at_23_22_japan_time_is_held_by_the_default_quiet_hours_and_the_log_says_so(self):
        result, sent, lines = self.deliver([mrvl()])
        self.assertEqual((result['attempted'], sent), (0, []))
        skips = [line for line in lines if line['event'] == 'push-target-skip']
        self.assertEqual(skips, [{'event': 'push-target-skip', 'reason': 'quiet-hours', 'ticker': 'MRVL', 'firm': 'Stifel',
                                  'latest': 280.0, 'publishedAt': '2026-11-20T14:22:19+00:00'}])
        self.assertEqual(result['priceTargetSkipsSinceStart'], {'quiet-hours': 1})
        # The next poll counts again but does not log the same change twice.
        _, _, again = self.deliver([mrvl()], self.now + 5)
        self.assertEqual([line for line in again if line['event'] == 'push-target-skip'], [])
        self.assertEqual(push.TARGET_SKIPS, {'quiet-hours': 2})

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
