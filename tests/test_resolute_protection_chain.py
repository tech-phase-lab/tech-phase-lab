"""Append-only verification of the independent protection store (weekly restore)."""
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/resolute' / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


p = module('protection', 'protection.py')
e = module('protection_events', 'protection_events.py')
backup = module('backup_for_chain_tests', 'backup.py')
KEY = bytes([7]) * 32
CUTOFF = dt.datetime(2026, 11, 15, 0, 0, tzinfo=dt.timezone.utc)


class Store:
    """Strict S3 double: complete pages, closed streams, conditional writes."""
    def __init__(self):
        self.files = {}
        self.truncate = False
        self.on_list = None
        self.lists = 0
        self.puts = []

    def get_paginator(self, op):
        return self

    def paginate(self, **kw):
        self.lists += 1
        if self.on_list:
            self.on_list(self, kw['Prefix'])
        values = [{'Key': k, 'Size': len(v), 'ETag': hashlib.md5(v).hexdigest()}
                  for k, v in sorted(self.files.items()) if k.startswith(kw['Prefix'])]
        if self.truncate and kw['Prefix'] == e.PREFIX:
            return [{'Contents': values[:1], 'IsTruncated': True}]
        return [{'Contents': values[:1], 'IsTruncated': True, 'NextContinuationToken': 'next'},
                {'Contents': values[1:], 'IsTruncated': False}]

    def get_object(self, **kw):
        return {'Body': io.BytesIO(self.files[kw['Key']])}

    def put_object(self, **kw):
        self.puts.append(kw['Key'])
        if kw['Key'] in self.files:
            raise AssertionError('overwrite attempted')
        self.files[kw['Key']] = kw['Body']


def event(user, revision, kind, at):
    return {'version': 1, 'userId': user, 'revision': revision, 'kind': kind, 'at': at}


def encrypt(value, nonce_byte=1):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    name = e.object_key(value, KEY)
    nonce = bytes([nonce_byte]) * 12  # Disposable deterministic fixture only.
    sealed = AESGCM(KEY).encrypt(nonce, json.dumps(value, separators=(',', ':')).encode(), name.encode())
    return name, b'RPE1' + nonce + sealed[-16:] + sealed[:-16]


def row(value):
    return {k: value[k] for k in ('userId', 'revision', 'kind', 'at')}


SYNTHETIC = [event('user_acceptance' + 'a' * 32, 1, 'delete', '2026-10-20T14:48:39.059Z'),
             event('user_acceptance' + 'a' * 32, 2, 'alerts_off', '2026-10-20T14:48:39.059Z'),
             event('user_acceptance' + 'a' * 32, 3, 'morning_off', '2026-10-20T14:48:39.059Z')]
MEMBER = [event('user_member1', 2, 'delete', '2026-11-13T06:33:00.000Z'),
          event('user_member1', 2, 'alerts_off', '2026-11-13T06:33:01.000Z')]
LATE = event('user_member2', 4, 'morning_off', '2026-11-15T23:59:00.000Z')


class ChainTests(unittest.TestCase):
    def setUp(self):
        self.s3 = Store()
        for value in SYNTHETIC:
            name, body = encrypt(value)
            self.s3.files[name] = body
        # The original 10-20 anchor: synthetic events with no source DB rows.
        self.pin = e.seal_manifest(self.s3, 'b', KEY, p)
        self.s3.lists = 0
        self.s3.puts = []
        self.db = []

    def add(self, value, *, db=True):
        name, body = encrypt(value)
        self.s3.files[name] = body
        if db:
            self.db.append(row(value))
        return name

    def verify(self, **kw):
        return e.verify_append_only(self.s3, 'b', KEY, self.pin, p,
                                    db_events=kw.get('db', self.db), backup_cutoff=CUTOFF)

    def assertReason(self, reason, **kw):
        with self.assertRaises(e.InventoryError) as caught:
            self.verify(**kw)
        self.assertEqual(caught.exception.reason, reason)

    def test_unchanged_anchor_inventory_passes(self):
        result = self.verify()
        self.assertEqual(len(result['objects']), 3)
        self.assertEqual((result['added'], result['linked'], result['height']), (0, 0, 0))
        self.assertEqual(len(result['ledger']['deletions']), 1)
        self.assertIsNone(e.extend_chain(self.s3, 'b', self.pin, result, mode='restore',
                                         sealed_at='2026-11-16T00:03:00.000Z'))
        self.assertEqual(self.s3.puts, [])

    def test_added_valid_events_with_database_rows_pass(self):
        for value in MEMBER:
            self.add(value)
        result = self.verify()
        self.assertEqual((len(result['objects']), result['added'], result['newer_than_backup']), (5, 2, 0))
        self.assertEqual(len(result['ledger']['suppressions']), 3)

    def test_event_newer_than_backup_passes_without_row(self):
        self.add(LATE, db=False)
        self.assertEqual(self.verify()['newer_than_backup'], 1)

    def test_deleted_object_fails(self):
        name = self.add(MEMBER[0])
        self.assertEqual(self.verify()['added'], 1)
        del self.s3.files[sorted(n for n in self.s3.files if n.startswith(e.PREFIX) and n != name)[0]]
        self.assertReason('inventory-missing-object')

    def test_modified_object_fails(self):
        name = sorted(n for n in self.s3.files if n.startswith(e.PREFIX))[0]
        original = self.s3.files[name]
        # A re-encrypted (still authentic) replacement is a rewrite, not an append.
        value = next(v for v in SYNTHETIC if e.object_key(v, KEY) == name)
        self.s3.files[name] = encrypt(value, nonce_byte=9)[1]
        self.assertNotEqual(self.s3.files[name], original)
        self.assertReason('inventory-modified-object')

    def test_unauthenticated_additional_object_fails(self):
        name, body = encrypt(MEMBER[0])
        self.s3.files[e.PREFIX + 'f' * 64 + '.bin'] = body
        self.assertReason('inventory-unknown-event')
        del self.s3.files[e.PREFIX + 'f' * 64 + '.bin']
        self.s3.files[name] = body[:-1] + bytes([body[-1] ^ 1])
        self.assertReason('inventory-unknown-event')

    def test_event_without_database_row_fails(self):
        self.add(MEMBER[0], db=False)
        self.assertReason('inventory-db-mismatch')

    def test_database_row_without_event_fails(self):
        self.db.append(row(MEMBER[1]))
        self.assertReason('inventory-db-mismatch')

    def test_conflicting_or_malformed_database_history_fails(self):
        self.add(MEMBER[0])
        self.db[0] = dict(self.db[0], at='2026-11-13T06:33:00.001Z')
        self.assertReason('inventory-db-mismatch')
        for history in (None, [{'userId': 'user_x'}], [row(MEMBER[0])] * 2):
            with self.subTest(history=history):
                self.assertReason('inventory-db-mismatch', db=history)

    def test_incomplete_listing_fails(self):
        self.s3.truncate = True
        self.assertReason('listing-incomplete')

    def test_object_changing_or_disappearing_during_read_fails(self):
        name = self.add(MEMBER[0])
        def mutate(store, prefix):
            if prefix == e.PREFIX and store.lists == 3:
                store.files[name] = store.files[name] + b'x'
        self.s3.on_list = mutate
        self.assertReason('inventory-changed')
        self.s3.lists = 0
        self.s3.files[name] = encrypt(MEMBER[0])[1]
        def remove(store, prefix):
            if prefix == e.PREFIX and store.lists == 3:
                del store.files[name]
        self.s3.on_list = remove
        self.assertReason('inventory-missing-object')

    def test_new_object_during_read_is_left_for_next_run(self):
        def append(store, prefix):
            if prefix == e.PREFIX and store.lists == 3:
                name, body = encrypt(LATE)
                store.files[name] = body
        self.s3.on_list = append
        self.assertEqual(len(self.verify()['objects']), 3)

    def extend(self, at='2026-11-16T00:03:00.000Z'):
        result = self.verify()
        return e.extend_chain(self.s3, 'b', self.pin, result, mode='restore', sealed_at=at)

    def test_chain_grows_and_protects_appended_events(self):
        late = self.add(LATE, db=False)
        first = self.extend()
        self.assertRegex(first, '^[0-9a-f]{64}$')
        raw = self.s3.files[e.CHAIN_PREFIX + first + '.json']
        self.assertEqual(hashlib.sha256(raw).hexdigest(), first)
        manifest = json.loads(raw)
        self.assertEqual((manifest['previous'], manifest['height'], manifest['anchor']), (self.pin, 1, self.pin))
        self.assertEqual(raw, e.canonical(manifest))
        # Next week the late event's row exists in the newer backup.
        self.db.append(row(LATE))
        self.add(MEMBER[0])
        second = self.extend('2026-11-23T00:03:00.000Z')
        self.assertEqual(json.loads(self.s3.files[e.CHAIN_PREFIX + second + '.json'])['previous'], first)
        result = self.verify()
        self.assertEqual((result['tip'], result['height'], result['linked'], result['added']), (second, 2, 2, 0))
        self.assertIsNone(self.extend('2026-11-30T00:03:00.000Z'))
        # Losing an event that only a chained manifest (not the anchor) recorded fails,
        # even if its DB row were also gone.
        del self.s3.files[late]
        self.db = [r for r in self.db if r != row(LATE)]
        self.assertReason('inventory-missing-object')

    def test_chain_tampering_fails(self):
        self.add(MEMBER[0])
        first = self.extend()
        name = e.CHAIN_PREFIX + first + '.json'
        original = self.s3.files[name]
        manifest = json.loads(original)
        cases = {
            'rewritten in place': original.replace(b'"restore"', b'"maintenance"'),
            'truncated': original[:-1],
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self.s3.files[name] = body
                self.assertReason('chain-invalid')
        self.s3.files[name] = original
        forged = {
            'object removed': dict(manifest, objects=manifest['objects'][1:], previous=first, height=2),
            'unknown predecessor': dict(manifest, previous='e' * 64, height=2),
            'height skipped': dict(manifest, previous=first, height=3),
            'height one without anchor link': dict(manifest, previous=first, height=1),
            'unsorted objects': dict(manifest, objects=list(reversed(manifest['objects'])), previous=first, height=2),
            'checksum altered': dict(manifest, previous=first, height=2, objects=[
                dict(manifest['objects'][0], sha256='0' * 64)] + manifest['objects'][1:]),
            'unknown field': dict(manifest, previous=first, height=2, note='x'),
        }
        for label, value in forged.items():
            with self.subTest(label=label):
                body = e.canonical(value)
                key = e.CHAIN_PREFIX + hashlib.sha256(body).hexdigest() + '.json'
                self.s3.files[key] = body
                self.assertReason('chain-invalid')
                del self.s3.files[key]
        self.assertEqual(self.verify()['tip'], first)
        # Anchor substitution is detected by the pin.
        anchor = e.MANIFEST_PREFIX + self.pin + '.json'
        self.s3.files[anchor] = self.s3.files[anchor].replace(b'"version":1', b'"version":1 ')
        self.assertReason('chain-anchor-invalid')

    def test_manifest_for_another_anchor_is_ignored_and_fork_still_protects(self):
        other = dict(version=2, anchor='d' * 64, previous='d' * 64, height=1, mode='maintenance',
                     sealedAt='2026-11-16T00:00:00.000Z', objects=[])
        body = e.canonical(other)
        self.s3.files[e.CHAIN_PREFIX + hashlib.sha256(body).hexdigest() + '.json'] = body
        name = self.add(MEMBER[0])
        first = self.extend()
        # A sibling (fork) that also links to the anchor is verified too.
        fork = dict(json.loads(self.s3.files[e.CHAIN_PREFIX + first + '.json']), sealedAt='2026-11-16T00:04:00.000Z')
        body = e.canonical(fork)
        self.s3.files[e.CHAIN_PREFIX + hashlib.sha256(body).hexdigest() + '.json'] = body
        self.assertEqual(self.verify()['linked'], 2)
        del self.s3.files[name]
        self.db = []
        self.assertReason('inventory-missing-object')

    def test_existing_identical_manifest_is_accepted_but_different_bytes_fail(self):
        self.add(MEMBER[0])
        result = self.verify()
        digest, body = e.chain_manifest(self.pin, result['tip'], 1, result['objects'], 'restore',
                                        '2026-11-16T00:03:00.000Z')
        class Conflict(Exception):
            response = {'ResponseMetadata': {'HTTPStatusCode': 412}}
        def conflict(**kw):
            raise Conflict()
        self.s3.files[e.CHAIN_PREFIX + digest + '.json'] = body
        self.s3.put_object = conflict
        self.assertEqual(e.extend_chain(self.s3, 'b', self.pin, result, mode='restore',
                                        sealed_at='2026-11-16T00:03:00.000Z'), digest)
        self.s3.files[e.CHAIN_PREFIX + digest + '.json'] = body + b' '
        with self.assertRaises(e.InventoryError) as caught:
            e.extend_chain(self.s3, 'b', self.pin, result, mode='restore', sealed_at='2026-11-16T00:03:00.000Z')
        self.assertEqual(caught.exception.reason, 'chain-write-failed')
        def denied(**kw):
            raise PermissionError('AccessDenied')
        self.s3.put_object = denied
        with self.assertRaises(e.InventoryError) as caught:
            e.extend_chain(self.s3, 'b', self.pin, result, mode='restore', sealed_at='2026-11-16T00:04:00.000Z')
        self.assertEqual(caught.exception.reason, 'chain-write-failed')

    def test_backup_restore_path_extends_only_when_opted_in(self):
        self.add(MEMBER[0])
        env = {'RESOLUTE_RESTORE_PROTECTION_ENDPOINT': 'https://history.example.invalid',
               'RESOLUTE_RESTORE_PROTECTION_BUCKET': 'b', 'RESOLUTE_RESTORE_PROTECTION_REGION': 'auto',
               'RESOLUTE_RESTORE_PROTECTION_ACCESS_KEY_ID': 'id',
               'RESOLUTE_RESTORE_PROTECTION_SECRET_ACCESS_KEY': 'secret',
               'RESOLUTE_PROTECTION_KEY_HEX': KEY.hex(),
               'RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256': self.pin}
        factory = lambda *a, **kw: self.s3
        cutoff = backup.backup_point_cutoff('20261116T000000000000Z')
        state = {}
        ledger = backup.load_online_protection(env, factory, None, db_events=self.db,
                                               backup_cutoff=cutoff, state=state)
        self.assertEqual(len(ledger['deletions']), 2)
        self.assertNotIn('extend', state)
        self.assertEqual(state['chain']['added_since_tip'], 1)
        env['RESOLUTE_PROTECTION_CHAIN_WRITE'] = 'true'
        state = {}
        backup.load_online_protection(env, factory, None, db_events=self.db, backup_cutoff=cutoff, state=state)
        self.assertEqual(self.s3.puts, [])
        state['extend']()
        self.assertTrue(state['chain']['extended'])
        self.assertEqual(self.s3.puts, [e.CHAIN_PREFIX + state['chain']['manifest_sha256'] + '.json'])


class ReasonCodeTests(unittest.TestCase):
    def run_failure(self, error):
        with patch.dict(os.environ, {'RESOLUTE_BACKUP_MODE': 'restore'}, clear=True), \
             patch.object(backup, 'heartbeat'), \
             patch.object(backup, 'main', side_effect=error), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            with self.assertRaises(SystemExit):
                backup.entrypoint()
        return json.loads(output.getvalue())

    def test_fixed_reason_codes_are_emitted_without_details(self):
        for reason in sorted(backup.protection_events.REASONS):
            with self.subTest(reason=reason):
                error = backup.protection_events.InventoryError(reason, 'user_private secret detail')
                self.assertEqual(self.run_failure(error),
                                 {'event': 'RESOLUTE_JOB_FAILED', 'error_type': 'InventoryError', 'reason': reason})
        self.assertEqual(self.run_failure(backup.ProtectionConfigError('private'))['reason'], 'protection-config')

    def test_unknown_reason_attribute_is_never_printed(self):
        error = RuntimeError('private')
        error.reason = 'user_private'
        self.assertEqual(self.run_failure(error), {'event': 'RESOLUTE_JOB_FAILED', 'error_type': 'RuntimeError'})
        with self.assertRaises(AssertionError):
            backup.protection_events.InventoryError('user_private', 'x')


class BundleBuilderTests(unittest.TestCase):
    def test_build_is_deterministic_and_check_detects_drift(self):
        import tempfile
        builder = module('build_protected_bundle', 'build-protected-bundle.py')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first = builder.build(ROOT / 'scripts/resolute', root / 'a')
            second = builder.build(ROOT / 'scripts/resolute', root / 'b')
            self.assertEqual(first, second)
            self.assertEqual((root / 'a/payload.b64').read_bytes(), (root / 'b/payload.b64').read_bytes())
            body = (root / 'a/modules.json').read_bytes()
            self.assertEqual(first['modules_sha256'], hashlib.sha256(body).hexdigest())
            self.assertEqual(sorted(json.loads(body)), list(builder.MODULES))
            self.assertTrue(builder.check(root / 'a/payload.b64', ROOT / 'scripts/resolute')['matches_source'])
            source = root / 'source'
            source.mkdir()
            for name in builder.MODULES:
                (source / name).write_text((ROOT / 'scripts/resolute' / name).read_text() + ('#\n' if name == 'protection.py' else ''))
            with self.assertRaisesRegex(ValueError, 'protection.py'):
                builder.check(root / 'a/payload.b64', source)
            extra = builder.payload(json.dumps(dict(json.loads(body), **{'other.py': ''})).encode())
            with self.assertRaisesRegex(ValueError, 'exactly'):
                builder.decode(extra)


if __name__ == '__main__':
    unittest.main()
