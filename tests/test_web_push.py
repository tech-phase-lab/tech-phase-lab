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
        self.register();push.deliver(self.db,[event()],lambda *_:410,self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0],0)
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
