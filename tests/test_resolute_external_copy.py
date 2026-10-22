import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).resolve().parents[1] / 'scripts/resolute/mirror_backup.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class Store:
    def __init__(self, objects=None, corrupt=False):
        self.objects = objects or {}
        self.corrupt = corrupt
        self.writes = []

    def get_object(self, Bucket, Key):
        return {'Body': io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body):
        data = Body.read() if hasattr(Body, 'read') else Body
        self.objects[Key] = b'bad' if self.corrupt else data
        self.writes.append(Key)


class ExternalCopyTests(unittest.TestCase):
    def source(self):
        data = b'age-encryption.org/v1\nsynthetic-ciphertext'
        key = 'resolute/v1/dumps/20261022T120000123456Z.dump.age'
        manifest = {'key': key, 'bytes': len(data), 'cipher_sha256': hashlib.sha256(data).hexdigest()}
        return Store({key: data, mirror.PREFIX + 'latest.json': json.dumps(manifest).encode()}), key

    def test_round_trip_without_latest_or_history_success_claim(self):
        source, _ = self.source()
        destination = Store()
        report = mirror.copy_backup(source, 'source', destination, 'external')
        self.assertEqual(len(destination.writes), 2)
        self.assertFalse(report['restore_verified'])
        self.assertFalse(report['protection_history_copied'])
        self.assertNotIn(mirror.PREFIX + 'latest.json', destination.objects)

    def test_corrupt_source_never_writes(self):
        source, key = self.source()
        source.objects[key] = b'corrupt'
        destination = Store()
        with self.assertRaises(ValueError):
            mirror.copy_backup(source, 'source', destination, 'external')
        self.assertEqual(destination.writes, [])

    def test_corrupt_destination_does_not_publish_manifest(self):
        source, _ = self.source()
        destination = Store(corrupt=True)
        with self.assertRaises(ValueError):
            mirror.copy_backup(source, 'source', destination, 'external')
        self.assertEqual(len(destination.writes), 1)

    def test_rejects_unsafe_key_and_oversize(self):
        for change in ({'key': '../secret'}, {'bytes': mirror.MAX_BYTES + 1}, {'bytes': True}):
            source, _ = self.source()
            manifest = json.loads(source.objects[mirror.PREFIX + 'latest.json'])
            manifest.update(change)
            source.objects[mirror.PREFIX + 'latest.json'] = json.dumps(manifest).encode()
            destination = Store()
            with self.assertRaises(ValueError):
                mirror.copy_backup(source, 'source', destination, 'external')
            self.assertEqual(destination.writes, [])

    def test_disabled_and_same_endpoint_are_rejected(self):
        with self.assertRaises(ValueError):
            mirror.configuration({})
        env = {'RESOLUTE_EXTERNAL_COPY_ENABLED': 'true'}
        for side in ('SOURCE', 'DESTINATION'):
            for key, value in {'ENDPOINT': 'https://same.example', 'BUCKET': side, 'REGION': 'auto', 'ACCESS_KEY_ID': 'fixture', 'SECRET_ACCESS_KEY': 'fixture'}.items():
                env[f'MIRROR_{side}_{key}'] = value
        with self.assertRaises(ValueError):
            mirror.configuration(env)
