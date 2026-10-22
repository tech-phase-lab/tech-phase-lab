import io
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tech-phase'))
import restore_external_source as restore
import test_source_recovery_package as fixtures


class ReadOnlyStorage:
    # Deliberately no PUT, DELETE or LIST methods.
    def __init__(self, object_key, data):
        self.object_key, self.data = object_key, data
        self.calls = 0

    def get_object(self, *, Bucket, Key):
        if Bucket != 'fixture-bucket' or Key != self.object_key:
            raise ValueError('unexpected object access')
        self.calls += 1
        return {'Body': io.BytesIO(self.data)}


class ExistingSourceRestoreTests(unittest.TestCase):
    def test_independent_existing_object_restore_and_invalid_pins(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo, _, commit = fixtures.SourceRecoveryTests().fixture(root)
            package = root / 'package'
            restore.sealed.source.prepare(repo, package, commit)
            key = os.urandom(32)
            cipher = root / 'old.aesgcm'
            sealed = restore.sealed.seal(package, cipher, key, commit)
            object_key = restore.sealed.context(commit) + '/' + sealed['sha256'] + '.aesgcm'
            storage = ReadOnlyStorage(object_key, cipher.read_bytes())
            args = (storage, 'fixture-bucket', key, commit, sealed['sha256'], sealed['bytes'], sealed['tree'])
            result = restore.restore(*args)
            self.assertEqual(storage.calls, 1)
            self.assertFalse(result['new_upload'])
            self.assertTrue(result['source_restore_verified'])
            self.assertFalse(result['runtime_restore_verified'])
            for index, bad in [(2, os.urandom(32)), (5, sealed['bytes'] - 1), (6, '0' * 40)]:
                changed = list(args)
                changed[index] = bad
                with self.subTest(index=index), self.assertRaises(Exception):
                    restore.restore(*changed)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['old.aesgcm', 'package', 'repo'])

    def test_restore_does_not_inherit_upload_enablement(self):
        with self.assertRaises(ValueError):
            restore.configuration({'TECH_PHASE_SOURCE_UPLOAD_ENABLED': 'true'}, operation='restore')
        with self.assertRaises(ValueError):
            restore.configuration({}, operation='unexpected')
