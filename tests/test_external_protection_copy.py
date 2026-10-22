import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('external_protection', Path(__file__).resolve().parents[1] / 'scripts/resolute/mirror_protection.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Store:
    def __init__(self):
        self.objects = {}
        self.corrupt = False
        self.changing = False
        self.pages = 0

    def get_object(self, Bucket, Key):
        return {'Body': io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body):
        self.objects[Key] = b'bad' if self.corrupt else Body

    def get_paginator(self, operation):
        return self

    def paginate(self, Bucket, Prefix):
        self.pages += 1
        yield {'IsTruncated': False, 'Contents': [
            {'Key': k, 'Size': len(v), 'ETag': str(self.pages) if self.changing else hashlib.sha256(v).hexdigest()}
            for k, v in self.objects.items() if k.startswith(Prefix)]}


class ProtectionCopyTests(unittest.TestCase):
    def fixture(self):
        source, target = Store(), Store()
        key = module.events.PREFIX + 'a' * 64 + '.bin'
        body = b'RPE1' + b'synthetic-ciphertext' * 3
        source.objects[key] = body
        raw = json.dumps({'version': 1, 'objects': [{'key': key, 'sha256': hashlib.sha256(body).hexdigest()}]}).encode()
        pin = hashlib.sha256(raw).hexdigest()
        source.objects[module.events.MANIFEST_PREFIX + pin + '.json'] = raw
        return source, target, pin

    def test_complete_copy_and_no_restore_claim(self):
        source, target, pin = self.fixture()
        report = module.copy_protection(source, 'source', target, 'external', pin, writers_fenced=True)
        self.assertEqual(report['objects'], 1)
        self.assertFalse(report['restore_verified'])
        self.assertEqual(len(target.objects), 2)

    def test_old_empty_manifest_is_rejected_before_upload(self):
        source, target, _ = self.fixture()
        raw = b'{"version":1,"objects":[]}'
        pin = hashlib.sha256(raw).hexdigest()
        source.objects[module.events.MANIFEST_PREFIX + pin + '.json'] = raw
        with self.assertRaises(ValueError):
            module.copy_protection(source, 'source', target, 'external', pin, writers_fenced=True)
        self.assertEqual(target.objects, {})

    def test_changed_inventory_and_bad_readback_never_publish_manifest(self):
        for changing in (True, False):
            source, target, pin = self.fixture()
            source.changing = changing
            target.corrupt = not changing
            with self.assertRaises(ValueError):
                module.copy_protection(source, 'source', target, 'external', pin, writers_fenced=True)
            self.assertEqual(len(target.objects), 1)
            self.assertFalse(next(iter(target.objects)).endswith('.json'))

    def test_fence_acknowledgement_is_required(self):
        source, target, pin = self.fixture()
        with self.assertRaises(ValueError):
            module.copy_protection(source, 'source', target, 'external', pin)
        self.assertEqual(target.objects, {})
