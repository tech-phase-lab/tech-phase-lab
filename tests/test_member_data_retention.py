import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import member_data_retention as retention  # noqa: E402
import web_push  # noqa: E402
import saved_research  # noqa: E402
import favorite_lists  # noqa: E402
import questions  # noqa: E402

ON = {'MEMBER_ERASURE_ENABLED': 'true', 'RESEARCH_RETENTION_PURGE_ENABLED': 'true'}
NOW = 1_800_000_000.0
MEMBER = 'user_departedMember1'
OTHER = 'user_stayingMember2'
OWNER = 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'
KEYS = {'savedResearch': 'a' * 64, 'favorites': 'b' * 64, 'question': 'c' * 64, 'deskReaction': 'd' * 64}
OTHER_KEYS = {'savedResearch': '1' * 64, 'favorites': '2' * 64, 'question': '3' * 64, 'deskReaction': '4' * 64}


def device(db, device_id, owner, active=1, since=NOW, question_owner=None):
    db.execute('INSERT INTO push_devices (id,subscription,tickers,language,since,active,owner_id,question_owner) VALUES(?,?,?,?,?,?,?,?)',
               (device_id, '{}', '[]', 'ja', since, active, owner, question_owner))
    db.execute('INSERT INTO push_deliveries (device_id,event_key,status,attempted_at) VALUES(?,?,?,?)', (device_id, 'e1', 'accepted', NOW))
    db.execute('INSERT INTO push_device_preferences VALUES(?,?,?,?,?)', (device_id, 1, 1, 1, '[]'))
    db.execute('INSERT INTO push_notices (id,device_id,kind,page,title,sent_at) VALUES(?,?,?,?,?,?)', (device_id[:32].ljust(32, '0'), device_id, 'test', '/', 't', NOW))


def fixture(folder):
    path = str(Path(folder) / 'monitor.sqlite')
    db = web_push.connect(path)
    db.execute('CREATE TABLE IF NOT EXISTS push_test_attempts (device_id TEXT PRIMARY KEY, attempted_at REAL NOT NULL)')
    device(db, 'dev-member', MEMBER)
    device(db, 'dev-member-question', None, question_owner=KEYS['question'])
    device(db, 'dev-other', OTHER)
    device(db, 'dev-owner', OWNER)
    db.commit()
    db.close()
    doc = {'lists': [{'id': 'default', 'name': 'x', 'tickers': ['MU']}], 'names': {}, 'alerts': []}
    for keys in (KEYS, OTHER_KEYS):
        with saved_research.connect(path) as s:
            saved_research.save(s, keys['savedResearch'], 0, {'saved': ['n1'], 'notebooks': {}})
        with favorite_lists.connect(path) as f:
            favorite_lists.save(f, keys['favorites'], 0, doc)
    q = questions.connect(path)
    for qid, owner, body in (('q-' + '0' * 32, KEYS['question'], 'my private question'), ('q-' + '1' * 32, OTHER_KEYS['question'], 'other question')):
        q.execute("INSERT INTO member_questions (id,owner_key,body,status,created_at,updated_at) VALUES(?,?,?,'pending','2026-11-01T00:00:00.000+00:00','2026-11-01T00:00:00.000+00:00')",
                  (qid, owner, body))
    q.execute('CREATE TABLE IF NOT EXISTS desk_reactions(post_id TEXT NOT NULL, owner_key TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(post_id,owner_key,emoji))')
    q.execute("INSERT INTO desk_reactions VALUES('post-0000000000000001',?, 'like')", (KEYS['deskReaction'],))
    q.execute("INSERT INTO desk_reactions VALUES('post-0000000000000001',?, 'fire')", (OTHER_KEYS['deskReaction'],))
    q.commit()
    q.close()
    return path


def count(db, sql, args=()):
    return db.execute(sql, args).fetchone()[0]


class MemberErasureTests(unittest.TestCase):
    def test_owner_ids_mirror_entitlements(self):
        source = (ROOT / 'lib/membership/entitlements.ts').read_text()
        ids = set(re.findall(r'export const (?:PRODUCTION_)?OWNER_ACCOUNT_ID = "(user_[A-Za-z0-9]+)"', source))
        self.assertEqual(len(ids), 2)
        self.assertEqual(ids, set(retention.OWNER_ACCOUNT_IDS))

    def test_disabled_by_default_changes_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = fixture(folder)
            db = sqlite3.connect(path)
            self.assertEqual(retention.erase_member(db, {'memberId': MEMBER, 'keys': KEYS}, NOW, env={}), {'status': 'disabled'})
            self.assertEqual(retention.purge_expired(db, NOW, env={'RESEARCH_RETENTION_PURGE_ENABLED': '1'}), {'status': 'disabled'})
            self.assertEqual(count(db, 'SELECT COUNT(*) FROM push_devices'), 4)
            self.assertEqual(count(db, 'SELECT COUNT(*) FROM member_saved_research'), 2)
            db.close()

    def test_owner_accounts_are_always_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = fixture(folder)
            db = sqlite3.connect(path)
            for owner in sorted(retention.OWNER_ACCOUNT_IDS):
                for env in ({}, ON):
                    with self.assertRaisesRegex(ValueError, 'owner-account'):
                        retention.erase_member(db, {'memberId': owner, 'keys': KEYS}, NOW, env=env)
            self.assertEqual(count(db, "SELECT COUNT(*) FROM push_devices WHERE owner_id=?", (OWNER,)), 1)
            # A queued owner id (should never exist) is never handed to the Postgres job either.
            retention.schema(db)
            db.execute('INSERT INTO member_erasure_requests(member_id, requested_at) VALUES(?,?)', (OWNER, NOW))
            db.commit()
            self.assertEqual(retention.pending_requests(db), [])
            db.close()

    def test_erases_only_the_departed_member(self):
        with tempfile.TemporaryDirectory() as folder:
            path = fixture(folder)
            db = sqlite3.connect(path)
            result = retention.erase_member(db, {'memberId': MEMBER, 'keys': KEYS}, NOW, env=ON)
            self.assertEqual(result['status'], 'erased')
            self.assertEqual((result['pushDevices'], result['savedResearch'], result['favoriteLists'], result['deskReactions'], result['questionsAnonymized']), (2, 1, 1, 1, 1))
            self.assertNotIn(MEMBER, json.dumps(result))
            self.assertEqual(sorted(r[0] for r in db.execute('SELECT id FROM push_devices')), ['dev-other', 'dev-owner'])
            for table in ('push_deliveries', 'push_device_preferences', 'push_notices'):
                self.assertEqual(sorted(r[0] for r in db.execute(f'SELECT device_id FROM {table}')), ['dev-other', 'dev-owner'])
            self.assertEqual([r[0] for r in db.execute('SELECT owner FROM member_saved_research')], [OTHER_KEYS['savedResearch']])
            self.assertEqual([r[0] for r in db.execute('SELECT owner FROM member_favorite_lists')], [OTHER_KEYS['favorites']])
            self.assertEqual([r[0] for r in db.execute('SELECT owner_key FROM desk_reactions')], [OTHER_KEYS['deskReaction']])
            row = db.execute("SELECT owner_key, body, body_en, deleted_at FROM member_questions WHERE id=?", ('q-' + '0' * 32,)).fetchone()
            self.assertNotEqual(row[0], KEYS['question'])
            self.assertEqual((row[1], row[2]), ('', ''))
            self.assertIsNotNone(row[3])
            self.assertEqual(db.execute("SELECT body FROM member_questions WHERE id=?", ('q-' + '1' * 32,)).fetchone()[0], 'other question')
            # The log has a random receipt and counts only.
            log = db.execute('SELECT receipt, counts FROM member_erasure_log').fetchall()
            self.assertEqual(len(log), 1)
            self.assertNotIn(MEMBER, json.dumps(log))
            # The Postgres steps are queued until both are acknowledged; then the member id is gone.
            self.assertEqual(retention.pending_requests(db), [{'memberId': MEMBER, 'pending': ['billing', 'resolute']}])
            self.assertFalse(retention.acknowledge(db, {'memberId': MEMBER, 'step': 'billing'}, NOW)['complete'])
            self.assertEqual(retention.pending_requests(db), [{'memberId': MEMBER, 'pending': ['resolute']}])
            self.assertTrue(retention.acknowledge(db, {'memberId': MEMBER, 'step': 'resolute'}, NOW)['complete'])
            self.assertEqual(count(db, 'SELECT COUNT(*) FROM member_erasure_requests'), 0)
            # Repeating the erasure is harmless.
            again = retention.erase_member(db, {'memberId': MEMBER, 'keys': KEYS}, NOW, env=ON)
            self.assertEqual(again['pushDevices'] + again['savedResearch'] + again['favoriteLists'], 0)
            db.close()

    def test_rejects_malformed_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            db = sqlite3.connect(fixture(folder))
            for bad in ({'memberId': 'user_x'}, {'memberId': 'nope', 'keys': KEYS}, {'memberId': MEMBER, 'keys': {**KEYS, 'question': 'x'}},
                        {'memberId': MEMBER, 'keys': {k: v for k, v in KEYS.items() if k != 'favorites'}}):
                with self.assertRaises(ValueError):
                    retention.erase_member(db, bad, NOW, env=ON)
            with self.assertRaisesRegex(ValueError, 'invalid-step'):
                retention.acknowledge(db, {'memberId': MEMBER, 'step': 'clerk'}, NOW)
            db.close()


class MonitorRouteTests(unittest.TestCase):
    def test_routes_require_token_flag_and_refuse_owner(self):
        import os
        import threading
        from types import SimpleNamespace
        from unittest.mock import patch
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        import service
        with tempfile.TemporaryDirectory() as folder:
            path = fixture(folder)
            server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
            server.app = SimpleNamespace(db_path=path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'

            def call(route, body=None, token='private-test-token'):
                return urlopen(Request(base + route, data=json.dumps(body).encode() if body is not None else None,
                                       headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}), timeout=3)

            def status(route, body=None, token='private-test-token'):
                try:
                    with call(route, body, token) as response:
                        return response.status, json.loads(response.read())
                except HTTPError as error:
                    return error.code, json.loads(error.read() or b'{}')
            try:
                request = {'memberId': MEMBER, 'keys': KEYS}
                with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'private-test-token', 'MEMBER_ERASURE_ENABLED': ''}):
                    self.assertEqual(status('/member/erase', request)[0], 503)
                    self.assertEqual(status('/member/erasure-requests')[0], 503)
                with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'private-test-token', 'MEMBER_ERASURE_ENABLED': 'true'}):
                    self.assertEqual(status('/member/erase', request, token='wrong')[0], 401)
                    code, body = status('/member/erase', {'memberId': OWNER, 'keys': KEYS})
                    self.assertEqual((code, body.get('error')), (409, 'owner-account'))
                    code, body = status('/member/erase', request)
                    self.assertEqual((code, body['status'], body['pushDevices']), (200, 'erased', 2))
                    code, body = status('/member/erasure-requests')
                    self.assertEqual(body['requests'], [{'memberId': MEMBER, 'pending': ['billing', 'resolute']}])
                    self.assertEqual(status('/member/erasure-requests/ack', {'memberId': MEMBER, 'step': 'billing'})[0], 200)
                    self.assertEqual(status('/member/erasure-requests/ack', {'memberId': MEMBER, 'step': 'nope'})[0], 400)
                db = sqlite3.connect(path)
                self.assertEqual(count(db, "SELECT COUNT(*) FROM push_devices WHERE owner_id=?", (OWNER,)), 1)
                db.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


class PurgeTests(unittest.TestCase):
    def test_purges_expired_rows_but_never_owner_devices(self):
        with tempfile.TemporaryDirectory() as folder:
            path = fixture(folder)
            db = sqlite3.connect(path)
            old = NOW - retention.INACTIVE_DEVICE_SECONDS - 10
            device(db, 'dev-lapsed', OTHER, active=0, since=old)
            device(db, 'dev-lapsed-owner', OWNER, active=0, since=old)
            device(db, 'dev-recently-off', OTHER, active=0, since=NOW - 86400)
            db.execute('INSERT INTO push_deliveries (device_id,event_key,status,attempted_at) VALUES(?,?,?,?)', ('gone', 'e', 'accepted', NOW))
            db.execute('INSERT INTO push_test_attempts VALUES(?,?)', ('dev-other', NOW - 2 * 86400))
            db.execute("UPDATE member_questions SET deleted_at='2026-01-01T00:00:00.000+00:00' WHERE id=?", ('q-' + '1' * 32,))
            db.commit()
            result = retention.purge_expired(db, NOW, env=ON)
            self.assertEqual(result['status'], 'purged')
            self.assertEqual(result['inactiveDevices'], 1)
            ids = {r[0] for r in db.execute('SELECT id FROM push_devices')}
            self.assertIn('dev-lapsed-owner', ids)
            self.assertIn('dev-recently-off', ids)
            self.assertNotIn('dev-lapsed', ids)
            self.assertEqual(count(db, "SELECT COUNT(*) FROM push_deliveries WHERE device_id IN ('gone','dev-lapsed')"), 0)
            self.assertEqual(count(db, 'SELECT COUNT(*) FROM push_test_attempts'), 0)
            self.assertEqual(db.execute("SELECT body FROM member_questions WHERE id=?", ('q-' + '1' * 32,)).fetchone()[0], '')
            self.assertEqual(db.execute("SELECT body FROM member_questions WHERE id=?", ('q-' + '0' * 32,)).fetchone()[0], 'my private question')
            db.close()


if __name__ == '__main__':
    unittest.main()
