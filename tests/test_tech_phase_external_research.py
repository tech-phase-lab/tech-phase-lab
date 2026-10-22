import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('external_research', ROOT / 'scripts/tech-phase/external_research_backup.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Store:
    def __init__(self, corrupt=False):
        self.objects = {}
        self.corrupt = corrupt

    def put_object(self, Bucket, Key, Body, IfNoneMatch):
        if Key in self.objects or IfNoneMatch != '*':
            raise ValueError('overwrite forbidden')
        self.objects[Key] = Body.read() if hasattr(Body, 'read') else Body

    def get_object(self, Bucket, Key):
        return {'Body': io.BytesIO(b'bad' if self.corrupt else self.objects[Key])}


class ExternalResearchTests(unittest.TestCase):
    def source(self, path):
        db = sqlite3.connect(path)
        db.execute('PRAGMA journal_mode=WAL')
        for table in module.persistence.REQUIRED_TABLES:
            db.execute(f'CREATE TABLE {table} (id INTEGER)')
        db.execute('CREATE TABLE member_saved_research (owner TEXT, document TEXT)')
        db.execute("INSERT INTO member_saved_research VALUES ('fixture', 'private notes')")
        db.commit()
        self.addCleanup(db.close)
        return db

    def test_real_crypto_wal_snapshot_and_isolated_restore(self):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'live.sqlite'
            db = self.source(source)
            store = Store()
            key = bytes(range(32))
            report = module.backup(source, store, 'external', key)
            cipher = store.objects[report['key']]
            self.assertNotIn(b'private notes', cipher)
            plain = AESGCM(key).decrypt(cipher[:12], cipher[12:], report['key'].encode())
            restored = root / 'read.sqlite'
            restored.write_bytes(plain)
            with sqlite3.connect(restored) as read:
                self.assertEqual(read.execute('SELECT document FROM member_saved_research').fetchone()[0], 'private notes')
            archive = root / 'backup.aesgcm'
            archive.write_bytes(cipher)
            manifest = json.loads(store.objects[report['key'] + '.json'])
            self.assertFalse(module.verify_restore(archive, manifest, key)['promotion'])
            with self.assertRaises(Exception):
                module.verify_restore(archive, manifest, b'x' * 32)
            manifest['key'] = manifest['aad'] = report['key'].replace('v1/', 'v1/dumps/../')
            with self.assertRaises(ValueError):
                module.verify_restore(archive, manifest, key)
            self.assertEqual(db.execute('SELECT count(*) FROM member_saved_research').fetchone()[0], 1)
            self.assertFalse(report['restore_verified'])
            self.assertEqual(len(store.objects), 2)

    def test_corrupt_readback_never_publishes_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = Store(corrupt=True)
            with self.assertRaises(ValueError):
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(len(store.objects), 1)

    def test_missing_or_incomplete_database_never_uploads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            store = Store()
            with self.assertRaises(ValueError):
                module.backup(path, store, 'external', b'x' * 32)
            self.assertFalse(path.exists())
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE unrelated (id INTEGER)')
            with self.assertRaises(ValueError):
                module.backup(path, store, 'external', b'x' * 32)
            self.assertFalse(store.objects)

    def test_configuration_fails_closed(self):
        for env in ({}, {'TECH_PHASE_EXTERNAL_BACKUP_ENABLED': 'true'}):
            with self.assertRaises(ValueError):
                module.configuration(env)

    def test_tampering_even_with_updated_checksum_fails_authentication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = Store()
            report = module.backup(path, store, 'external', b'x' * 32)
            cipher = bytearray(store.objects[report['key']])
            cipher[20] ^= 1
            archive = Path(directory) / 'bad.aesgcm'
            archive.write_bytes(cipher)
            manifest = json.loads(store.objects[report['key'] + '.json'])
            manifest['sha256'] = hashlib.sha256(cipher).hexdigest()
            with self.assertRaises(Exception):
                module.verify_restore(archive, manifest, b'x' * 32)
