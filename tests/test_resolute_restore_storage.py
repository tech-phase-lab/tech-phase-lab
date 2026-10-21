"""Restore must read authenticated history from the independent store only."""
import hashlib
import importlib.util
import io
import json
import os
import builtins
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('backup',
    Path(__file__).resolve().parents[1] / 'scripts/resolute/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class RestoreStorageTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            'BACKUP_ENDPOINT': 'https://dumps.example.invalid',
            'BACKUP_BUCKET': 'dumps',
            'BACKUP_ACCESS_KEY_ID': 'dump-access',
            'BACKUP_SECRET_ACCESS_KEY': 'dump-secret',
            'RESOLUTE_RESTORE_PROTECTION_ENDPOINT': 'https://history.example.invalid',
            'RESOLUTE_RESTORE_PROTECTION_BUCKET': 'history',
            'RESOLUTE_RESTORE_PROTECTION_REGION': 'auto',
            'RESOLUTE_RESTORE_PROTECTION_ACCESS_KEY_ID': 'history-access',
            'RESOLUTE_RESTORE_PROTECTION_SECRET_ACCESS_KEY': 'history-secret',
            'RESOLUTE_PROTECTION_KEY_HEX': '07' * 32,
            'RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256': 'a' * 64,
        }
        self.factory = Mock()

    def test_each_missing_independent_setting_stops_before_network(self):
        for name in self.env:
            if name.startswith('RESOLUTE_'):
                with self.subTest(name=name):
                    env = dict(self.env)
                    del env[name]
                    with self.assertRaises(RuntimeError):
                        backup.load_online_protection(env, self.factory, None)
        self.factory.assert_not_called()

    def test_dump_bucket_and_unsafe_endpoints_are_rejected(self):
        for endpoint in ('http://history.example.invalid',
                         'https://user:secret@history.example.invalid',
                         'https://history.example.invalid?token=secret',
                         'https://history.example.invalid/path',
                         'https://history.example.invalid#fragment'):
            with self.subTest(endpoint=endpoint):
                env = dict(self.env, RESOLUTE_RESTORE_PROTECTION_ENDPOINT=endpoint)
                with self.assertRaises(RuntimeError):
                    backup.load_online_protection(env, self.factory, None)
        env = dict(self.env, RESOLUTE_RESTORE_PROTECTION_ENDPOINT='https://DUMPS.example.invalid/',
                   RESOLUTE_RESTORE_PROTECTION_BUCKET='dumps')
        with self.assertRaises(RuntimeError):
            backup.load_online_protection(env, self.factory, None)
        self.factory.assert_not_called()

    def test_invalid_key_or_manifest_pin_stops_before_network(self):
        for name in ('RESOLUTE_PROTECTION_KEY_HEX', 'RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256'):
            for value in ('latest', '00', 'z' * 64):
                with self.subTest(name=name, value=value):
                    env = dict(self.env, **{name: value})
                    with self.assertRaises(RuntimeError):
                        backup.load_online_protection(env, self.factory, None)
        self.factory.assert_not_called()

    def test_real_authenticated_event_uses_independent_read_only_inventory_and_gets(self):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        event = dict(version=1, userId='user_fixture', revision=3,
                     kind='delete', at='2026-10-19T06:00:00.000Z')
        key = bytes.fromhex(self.env['RESOLUTE_PROTECTION_KEY_HEX'])
        name = backup.protection_events.object_key(event, key)
        nonce = bytes(range(12))  # Disposable deterministic test fixture only.
        encrypted = AESGCM(key).encrypt(nonce, json.dumps(event).encode(), name.encode())
        body = b'RPE1' + nonce + encrypted[-16:] + encrypted[:-16]
        manifest = json.dumps(dict(version=1, objects=[
            dict(key=name, sha256=hashlib.sha256(body).hexdigest())])).encode()
        pin = hashlib.sha256(manifest).hexdigest()
        self.env['RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256'] = pin
        files = {name: body, backup.protection_events.MANIFEST_PREFIX + pin + '.json': manifest}
        reads = []
        def get_object(**kwargs):
            self.assertEqual(kwargs['Bucket'], 'history')
            reads.append(kwargs['Key'])
            return {'Body': io.BytesIO(files[kwargs['Key']])}
        client = Mock(spec=['get_object', 'get_paginator'])
        client.get_object.side_effect = get_object
        client.get_paginator.return_value.paginate.return_value = [
            {'IsTruncated': False, 'Contents': [{'Key': name, 'Size': len(body), 'ETag': 'fixture'}]}]
        self.factory.return_value = client
        config = object()
        ledger = backup.load_online_protection(self.env, self.factory, config)
        self.assertEqual(ledger['deletions'][0]['revision'], 3)
        self.assertEqual(len(reads), 2)
        self.assertEqual(client.get_paginator.call_count, 2)
        self.factory.assert_called_once_with('s3', endpoint_url='https://history.example.invalid',
            aws_access_key_id='history-access', aws_secret_access_key='history-secret',
            region_name='auto', config=config)
        files[name] = body[:-1] + bytes([body[-1] ^ 1])
        with self.assertRaisesRegex(ValueError, 'checksum'):
            backup.load_online_protection(self.env, self.factory, config)

    def test_missing_history_never_falls_back_to_dump_client(self):
        self.factory.return_value.get_object.side_effect = FileNotFoundError()
        with self.assertRaises(FileNotFoundError):
            backup.load_online_protection(self.env, self.factory, None)
        self.assertEqual(self.factory.call_count, 1)


class RestoreEnvironmentTests(unittest.TestCase):
    def test_connection_variants_fail_before_imports_or_io(self):
        names = ('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGDATABASE',
                 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE',
                 'PGOPTIONS', 'PGSSLCERT', 'PGSSLKEY', 'DATABASE_URL',
                 'DATABASE_PRIVATE_URL', 'ENTITLEMENT_DB_URL',
                 'RESOLUTE_PLAN_DB_URL', 'RESOLUTE_NOTIFICATION_DB_URL',
                 'RESOLUTE_PROTECTION_DB_URL', 'SOURCE_DATABASE_URL',
                 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_FILE', 'POSTGRES_USER')
        for name in names:
            with self.subTest(name=name):
                env = {'RESOLUTE_BACKUP_MODE': 'restore', name: 'private-value'}
                with patch.dict(os.environ, env, clear=True), \
                     patch.object(builtins, '__import__') as imports, \
                     patch.object(backup.tempfile, 'TemporaryDirectory') as temporary, \
                     patch.object(backup, 'run') as run:
                    with self.assertRaisesRegex(RuntimeError, 'production connection') as caught:
                        backup.main()
                    imports.assert_not_called()
                    temporary.assert_not_called()
                    run.assert_not_called()
                self.assertNotIn('private-value', str(caught.exception))

    def test_postgres_image_metadata_and_independent_storage_are_allowed(self):
        backup.validate_restore_environment({
            'PG_MAJOR': '18', 'PG_VERSION': '18.0', 'PGDATA': '/var/lib/postgresql/data',
            'BACKUP_BUCKET': 'dumps', 'BACKUP_SECRET_ACCESS_KEY': 'fixture',
            'RESOLUTE_RESTORE_PROTECTION_SECRET_ACCESS_KEY': 'fixture',
            'RESOLUTE_PROTECTION_KEY_HEX': '07' * 32, 'DATABASE_URL': '',
        })

    def test_backup_keeps_its_required_source_connection(self):
        with patch.dict(os.environ, {'RESOLUTE_BACKUP_MODE': 'backup',
                                     'PGHOST': 'postgres.railway.internal'}, clear=True), \
             patch.object(backup, 'validate_restore_environment') as validate, \
             patch.object(builtins, '__import__', side_effect=ImportError('client sentinel')):
            with self.assertRaisesRegex(ImportError, 'client sentinel'):
                backup.main()
            validate.assert_not_called()
