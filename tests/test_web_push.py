import base64
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
import signals

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
        self.env=patch.dict(os.environ,{'WEB_PUSH_ALLOW_PILOT':'true','WEB_PUSH_ENABLED':'true','WEB_PUSH_PRIVATE_KEY':'test',
            'WEB_PUSH_PUBLIC_KEY':'test','WEB_PUSH_SUBJECT':'mailto:test@example.com'});self.env.start()
    def tearDown(self):
        self.env.stop();self.db.close();self.tmp.cleanup()
    def register(self, now=None):
        push.register(self.db,{'subscription':subscription(),'tickers':['MU'],'language':'ja'}, {'MU','NBIS'},self.now-10 if now is None else now)
    def member_payload(self, owner='user_owner'):
        return {'memberId': owner, 'accessExpiresAt': self.now+60, 'subscription': subscription(), 'allTargets': True}

    def test_member_ownership_and_expiry(self):
        payload = self.member_payload()
        push.register_member(self.db, payload, {'MU'}, self.now-10)
        self.assertTrue(push.member_action(self.db, payload, 'status', now=self.now)['registered'])
        other = self.member_payload('user_other')
        self.assertFalse(push.member_action(self.db, other, 'status', now=self.now)['registered'])
        for action in ['remove', 'test']:
            with self.assertRaises(ValueError):
                push.member_action(self.db, other, action, now=self.now)
        with self.assertRaises(ValueError):
            push.register_member(self.db, other, {'MU'}, self.now)
        for expiry in [self.now, True, float('nan')]:
            with self.assertRaises(ValueError):
                push.register_member(self.db, {**payload, 'accessExpiresAt': expiry}, {'MU'}, self.now)
        push.revoke_member(self.db, payload)
        self.assertFalse(push.member_action(self.db, payload, 'status', now=self.now)['registered'])

    def test_member_delivery_rechecks_current_entitlement_and_preserves_dedup(self):
        push.register_member(self.db, self.member_payload(), {'MU'}, self.now-10)
        calls=[]
        transport=lambda *args: calls.append(args) or 201
        for expiry in [0, self.now-1, float('nan'), True]:
            result=push.deliver(self.db,[event()],transport,self.now,wall_now=lambda:self.now,entitlement=lambda owner:expiry)
            self.assertEqual(result['attempted'],0)
        self.assertEqual(calls,[])
        result=push.deliver(self.db,[event()],transport,self.now,wall_now=lambda:self.now,entitlement=lambda owner:self.now+60)
        self.assertEqual(result['accepted'],1)
        result=push.deliver(self.db,[event()],transport,self.now,wall_now=lambda:self.now,entitlement=lambda owner:self.fail('duplicate rechecked'))
        self.assertEqual(result['attempted'],0)
        self.assertEqual(len(calls),1)

    def test_member_test_delivery_rechecks_entitlement(self):
        payload=self.member_payload()
        push.register_member(self.db,payload,{'MU'},self.now-10)
        with patch.object(push,'member_expiry',return_value=0):
            with self.assertRaises(ValueError):
                push.member_action(self.db,payload,'test',lambda *_:self.fail('unauthorized'),self.now)
        with patch.object(push,'member_expiry',return_value=self.now+60):
            self.assertTrue(push.member_action(self.db,payload,'test',lambda *_:201,self.now)['accepted'])

    def test_device_status_checks_registration_and_keys(self):
        self.assertFalse(push.device_status(self.db, {'subscription': subscription()})['registered'])
        self.register()
        self.assertTrue(push.device_status(self.db, {'subscription': subscription()})['registered'])
        changed = subscription(); changed['keys']['auth'] = b64(b'b'*16)
        self.assertFalse(push.device_status(self.db, {'subscription': changed})['registered'])
        push.remove(self.db, {'subscription': subscription()})
        self.assertFalse(push.device_status(self.db, {'subscription': subscription()})['registered'])

    def test_test_notification_requires_registration_and_limits_retries(self):
        payload = {'subscription': subscription()}
        with self.assertRaises(ValueError):
            push.test_notification(self.db, payload, lambda *_: self.fail('unregistered'), self.now)
        self.register(); calls=[]
        transport=lambda sub, message: calls.append(message) or 201
        self.assertTrue(push.test_notification(self.db, payload, transport, self.now)['accepted'])
        self.assertEqual(calls[0]['url'], '/research/notifications')
        self.assertEqual(push.test_notification(self.db, payload, transport, self.now+1)['retryAfter'], 60)
        self.assertEqual(len(calls), 1)
        self.assertFalse(push.test_notification(self.db, payload, lambda *_: 0, self.now+61)['accepted'])
        self.assertEqual(push.test_notification(self.db, payload, transport, self.now+62)['retryAfter'], 60)
        self.assertTrue(push.test_notification(self.db, payload, lambda *_: 410, self.now+122)['expired'])
        self.assertFalse(push.device_status(self.db, payload)['registered'])

    def test_test_failure_reports_safe_diagnostics(self):
        self.register()
        payload = {'subscription': subscription()}
        output = StringIO()
        with redirect_stdout(output):
            rejected = push.test_notification(self.db, payload, lambda *_: 401, self.now)
            def broken(*_):
                raise TypeError('secret endpoint and key material')
            failed = push.test_notification(self.db, payload, broken, self.now + 61)
        self.assertEqual((rejected['providerStatus'], rejected['failureKind']), (401, None))
        self.assertEqual((failed['providerStatus'], failed['failureKind']), (0, 'TypeError'))
        self.assertNotIn('secret endpoint', output.getvalue())
        self.assertNotIn(subscription()['endpoint'], output.getvalue())

    def test_vapid_subject_uses_origin_for_contact_url_with_path(self):
        self.assertEqual(push.vapid_subject('https://example.com/research/notifications?x=1'),
                         'https://example.com')
        self.assertEqual(push.vapid_subject('mailto:admin@example.com'), 'mailto:admin@example.com')
        for value in ['http://example.com/path', 'https://admin@example.com/path', 'invalid']:
            with self.assertRaises(ValueError):
                push.vapid_subject(value)

    def test_saved_targets_deliver_once_per_language_across_replay_and_restart(self):
        signals.schema(self.db)
        for lang, host in [('ja', 'fcm.googleapis.com'), ('en', 'web.push.apple.com')]:
            push.register_member(self.db, {
                'memberId': 'user_' + lang, 'accessExpiresAt': self.now + 3600,
                'subscription': subscription(host), 'allTargets': True, 'language': lang,
            }, {'MU'}, self.now - 30)
        reference = datetime.fromtimestamp(self.now, timezone.utc)
        for index, source in enumerate(['x-tipranks', 'x-thefly']):
            self.db.execute('''INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,
              matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)''', (
                source, f'https://x.com/example/status/{index + 1}', str(index), '',
                'MU price target raised to $120 from $100 at BofA', '["MU"]', '{}', 'new',
                datetime.fromtimestamp(self.now - 20, timezone.utc).isoformat(),
                datetime.fromtimestamp(self.now - 10 + index, timezone.utc).isoformat(), '', ''))
        self.db.commit()
        items = signals.public_price_targets(self.db, now=reference)['items']
        self.assertEqual(len(items), 1)
        sent = []
        transport = lambda _, message: sent.append(message) or 201
        result = push.deliver(self.db, items, transport, self.now,
                              wall_now=lambda: self.now, entitlement=lambda _: self.now + 3600)
        self.assertEqual(result['accepted'], 2)
        self.assertEqual({message['title'] for message in sent},
                         {'MU · 目標株価の変更', 'MU · Price target update'})
        self.assertTrue(all('100' in message['body'] and '120' in message['body'] for message in sent))
        self.db.close(); self.db = push.connect(Path(self.tmp.name) / 'push.sqlite')
        replay = signals.public_price_targets(self.db, now=reference)['items']
        result = push.deliver(self.db, replay, transport, self.now + 1,
                              wall_now=lambda: self.now + 1, entitlement=lambda _: self.now + 3600)
        self.assertEqual(result['attempted'], 0)
        self.assertEqual(len(sent), 2)

    def test_filters_and_deduplicates_across_sources_and_restart(self):
        self.register(); calls=[]
        send=lambda sub,payload: calls.append(payload) or 201
        self.assertEqual(push.deliver(self.db,[event('NBIS'),event(),event(source='second')],send,self.now)['accepted'],1)
        self.db.close();self.db=push.connect(Path(self.tmp.name)/'push.sqlite')
        push.deliver(self.db,[event()],send,self.now)
        self.assertEqual(len(calls),1)

    def test_invalid_events_are_skipped_without_stopping_later_delivery(self):
        self.register(); calls=[]
        invalid = [
            None,
            {**event(), 'publishedAt':'2026-09-26T14:00:00'},
            {**event(), 'publishedAt':'0001-01-01T00:00:00+14:00'},
            {**event(), 'observedAt':'9999-12-31T23:59:59-14:00'},
            {**event(), 'observedAt':None},
            {**event(), 'previous':float('nan')},
            {**event(), 'latest':float('inf')},
            {**event(), 'firm':''},
            {**event(), 'ticker':'../MU'},
        ]
        result = push.deliver(
            self.db, [*invalid, event()], lambda _, payload: calls.append(payload) or 201,
            self.now)
        self.assertEqual(result['attempted'], 1)
        self.assertEqual(result['accepted'], 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['title'], 'MU · 目標株価の変更')
    def test_recently_observed_old_publication_does_not_push(self):
        self.register()
        stale = {**event(), "publishedAt": "2026-09-25T14:00:00+00:00"}
        self.assertEqual(push.deliver(self.db, [stale], lambda *_: self.fail("stale publication"), self.now)["attempted"], 0)

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
