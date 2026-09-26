import base64
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push

def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

def subscription(host='fcm.googleapis.com'):
    return {'endpoint': f'https://{host}/push/test', 'keys': {'p256dh': b64(b'\x04' + b'k'*64), 'auth': b64(b'a'*16)}}

def event(ticker='MU', source='first'):
    return {'ticker':ticker,'firm':'BofA','previous':100,'latest':120,'publishedAt':'2026-09-26T14:00:00+00:00',
            'observedAt':'2026-09-26T14:00:01+00:00','source':source}

class PushTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=push.connect(Path(self.tmp.name)/'push.sqlite')
        self.now=datetime(2026,9,26,14,0,2,tzinfo=timezone.utc).timestamp()
        self.env=patch.dict(os.environ,{'WEB_PUSH_ENABLED':'true','WEB_PUSH_PRIVATE_KEY':'test',
            'WEB_PUSH_PUBLIC_KEY':'test','WEB_PUSH_SUBJECT':'mailto:test@example.com'});self.env.start()
    def tearDown(self):
        self.env.stop();self.db.close();self.tmp.cleanup()
    def register(self, now=None):
        push.register(self.db,{'subscription':subscription(),'tickers':['MU'],'language':'ja'}, {'MU','NBIS'},self.now-10 if now is None else now)
    def test_filters_and_deduplicates_across_sources_and_restart(self):
        self.register(); calls=[]
        send=lambda sub,payload: calls.append(payload) or 201
        self.assertEqual(push.deliver(self.db,[event('NBIS'),event(),event(source='second')],send,self.now)['accepted'],1)
        self.db.close();self.db=push.connect(Path(self.tmp.name)/'push.sqlite')
        push.deliver(self.db,[event()],send,self.now)
        self.assertEqual(len(calls),1)
    def test_registration_never_backfills(self):
        self.register(self.now)
        self.assertEqual(push.deliver(self.db,[event()],lambda *_: self.fail('old event'),self.now)['attempted'],0)
    def test_ambiguous_delivery_is_not_retried(self):
        self.register()
        self.assertEqual(push.deliver(self.db,[event()],lambda *_: 0,self.now)['uncertain'],1)
        push.deliver(self.db,[event()],lambda *_: self.fail('duplicate'),self.now)
    def test_expired_subscription_removed(self):
        self.register();push.deliver(
            self.db,[event()],lambda *_:410,self.now,wall_now=lambda:self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0],0)
        status=push.public_status(self.db,self.now)
        self.assertEqual(status['activeDevices'],0)
        self.assertEqual(status['expired24Hours'],1)
    def test_disabled_never_sends(self):
        self.register()
        with patch.dict(os.environ,{'WEB_PUSH_ENABLED':'false'}):
            self.assertEqual(push.deliver(self.db,[event()],lambda *_:self.fail('network'),self.now)['status'],'disabled')
    def test_rejects_arbitrary_host_and_malformed_keys(self):
        for host in ['localhost','127.0.0.1','fcm.googleapis.com.attacker.example']:
            with self.assertRaises(ValueError):push.validate_subscription(subscription(host))
        sub=subscription();sub['keys']['auth']='a'
        with self.assertRaises(ValueError):push.validate_subscription(sub)
    def test_remove_forgets_device_and_ledger(self):
        self.register();push.deliver(self.db,[event()],lambda *_:201,self.now)
        push.remove(self.db,{'subscription':subscription()})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_deliveries').fetchone()[0],0)
    def test_limit_and_ticker_validation(self):
        with self.assertRaises(ValueError):push.register(self.db,{'subscription':subscription(),'tickers':['BAD']},{'MU'})

    def test_all_targets_includes_new_tickers_without_reregistering(self):
        push.register(self.db, {'subscription':subscription(),'allTargets':True}, {'MU'}, self.now-10)
        self.assertEqual(push.deliver(self.db,[event('AAPL'),event('TSLA')],lambda *_:201,self.now)['accepted'],2)
        self.assertEqual(push.deliver(self.db,[event('AAPL')],lambda *_:self.fail('duplicate'),self.now)['attempted'],0)

    def test_public_status_is_persistent_and_contains_no_subscription_details(self):
        self.register()
        monotonic = iter([10.0, 10.25])
        result=push.deliver(self.db,[event()],lambda *_:201,self.now,
            lambda:next(monotonic),lambda:self.now)
        self.assertEqual(result['activeDevices'],1)
        self.assertEqual(result['attempted24Hours'],1)
        self.assertEqual(result['accepted24Hours'],1)
        self.assertEqual(result['uncertain24Hours'],0)
        self.assertEqual(result['detectionToAttemptSamples24Hours'],1)
        self.assertEqual(result['detectionToAttemptAverageMs24Hours'],1000)
        self.assertEqual(result['detectionToAttemptMaxMs24Hours'],1000)
        self.assertEqual(result['providerResponseSamples24Hours'],1)
        self.assertEqual(result['providerResponseAverageMs24Hours'],250)
        self.assertEqual(result['providerResponseMaxMs24Hours'],250)
        self.assertEqual(result['detectionToOutcomeSamples24Hours'],1)
        self.assertEqual(result['detectionToOutcomeAverageMs24Hours'],1250)
        self.assertEqual(result['detectionToOutcomeMaxMs24Hours'],1250)
        self.assertIsNotNone(result['lastAttemptAt'])
        self.assertNotIn('endpoint', result)
        self.assertNotIn('subscription', result)

    def test_latency_excludes_missing_future_and_over_seven_day_observations(self):
        with self.db:
            rows = [
                ('missing', self.now - 3, None),
                ('future', self.now - 2, self.now),
                ('old', self.now - 1, self.now - push.DELIVERY_RETENTION_SECONDS - 2),
            ]
            self.db.executemany('''INSERT INTO push_deliveries
                (device_id,event_key,status,attempted_at,observed_at)
                VALUES('device',?,'accepted',?,?)''', rows)
        status = push.public_status(self.db, self.now)
        self.assertEqual(status['attempted24Hours'], 3)
        self.assertEqual(status['detectionToAttemptSamples24Hours'], 0)
        self.assertIsNone(status['detectionToAttemptAverageMs24Hours'])
        self.assertIsNone(status['detectionToAttemptMaxMs24Hours'])

    def test_public_status_excludes_future_attempt_rows(self):
        with self.db:
            self.db.execute('''INSERT INTO push_deliveries
                (device_id,event_key,status,attempted_at,observed_at,provider_duration_ms)
                VALUES('device','future','accepted',?,?,100)''',
                (self.now + 1, self.now))
        status = push.public_status(self.db, self.now)
        self.assertEqual(status['attempted24Hours'], 0)
        self.assertEqual(status['detectionToAttemptSamples24Hours'], 0)
        self.assertEqual(status['providerResponseSamples24Hours'], 0)
        self.assertEqual(status['detectionToOutcomeSamples24Hours'], 0)
        self.assertIsNone(status['lastAttemptAt'])

    def test_invalid_provider_duration_is_not_reported_or_added_to_total(self):
        self.register()
        monotonic = iter([10.0, 70.001])
        result = push.deliver(
            self.db, [event()], lambda *_: 201, self.now,
            lambda: next(monotonic), lambda: self.now)
        self.assertEqual(result['attempted24Hours'], 1)
        self.assertEqual(result['detectionToAttemptSamples24Hours'], 1)
        self.assertEqual(result['providerResponseSamples24Hours'], 0)
        self.assertEqual(result['detectionToOutcomeSamples24Hours'], 0)
        self.assertIsNone(result['providerResponseAverageMs24Hours'])
        self.assertIsNone(result['detectionToOutcomeAverageMs24Hours'])

    def test_each_device_records_its_actual_attempt_start(self):
        self.register()
        second = subscription('web.push.apple.com')
        second['endpoint'] = 'https://web.push.apple.com/push/second'
        push.register(self.db, {'subscription':second,'tickers':['MU'],'language':'en'},
            {'MU'}, self.now - 10)
        wall = iter([self.now, self.now + 2])
        monotonic = iter([10.0, 10.1, 20.0, 20.1])
        result = push.deliver(self.db, [event()], lambda *_: 201, self.now,
            lambda: next(monotonic), lambda: next(wall))
        self.assertEqual(result['attempted'], 2)
        self.assertEqual(result['detectionToAttemptSamples24Hours'], 2)
        self.assertEqual(result['detectionToAttemptAverageMs24Hours'], 2000)
        self.assertEqual(result['detectionToAttemptMaxMs24Hours'], 3000)
        attempts = [row[0] for row in self.db.execute(
            'SELECT attempted_at FROM push_deliveries ORDER BY attempted_at')]
        self.assertEqual(attempts, [self.now, self.now + 2])

    def test_existing_delivery_ledger_migrates_without_inventing_latency(self):
        self.db.close()
        path = Path(self.tmp.name)/'legacy.sqlite'
        legacy = __import__('sqlite3').connect(path)
        legacy.execute('''CREATE TABLE push_deliveries (
            device_id TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT NOT NULL,
            attempted_at REAL NOT NULL, PRIMARY KEY(device_id,event_key))''')
        legacy.execute("INSERT INTO push_deliveries VALUES('device','event','accepted',?)", (self.now,))
        legacy.commit(); legacy.close()
        self.db = push.connect(path)
        status = push.public_status(self.db, self.now)
        self.assertEqual(status['attempted24Hours'], 1)
        self.assertEqual(status['detectionToAttemptSamples24Hours'], 0)
        self.assertIsNone(status['detectionToAttemptAverageMs24Hours'])
        self.assertEqual(status['providerResponseSamples24Hours'], 0)
        self.assertEqual(status['detectionToOutcomeSamples24Hours'], 0)
