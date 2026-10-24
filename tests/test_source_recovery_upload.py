import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tech-phase'))
import upload_source_recovery as upload
import test_source_recovery_package as fixtures


class Storage:
    def __init__(self, corruption=None, reject_put=False):
        self.objects, self.writes = {}, []
        self.corruption, self.reject_put = corruption, reject_put

    def put_object(self, *, Bucket, Key, Body, IfNoneMatch):
        assert IfNoneMatch == '*'
        if self.reject_put or (Bucket, Key) in self.objects:
            raise ValueError('precondition failed')
        self.objects[Bucket, Key] = Body.read() if hasattr(Body, 'read') else Body
        self.writes.append(Key)

    def get_object(self, *, Bucket, Key):
        data = self.objects[Bucket, Key]
        if self.corruption == 'cipher' and Key.endswith('.aesgcm'):
            data = data[:-1] + bytes([data[-1] ^ 1])
        elif self.corruption == 'manifest' and Key.endswith('.json'):
            data = data[:-1]
        elif self.corruption == 'oversize' and Key.endswith('.aesgcm'):
            data += b'extra'
        return {'Body': io.BytesIO(data)}


class SourceUploadTests(unittest.TestCase):
    def package(self, root):
        repo, _, commit = fixtures.SourceRecoveryTests().fixture(root)
        package = root / 'package'
        upload.sealed.source.prepare(repo, package, commit)
        return package, commit

    def test_upload_reads_back_decrypts_and_publishes_manifest_last(self):
        with tempfile.TemporaryDirectory() as temp:
            package, commit = self.package(Path(temp))
            storage = Storage()
            key = os.urandom(32)
            with patch.object(upload.sealed, 'verify', wraps=upload.sealed.verify) as verify:
                report = upload.upload(package, storage, 'fixture-bucket', key, commit)
                self.assertEqual(Path(verify.call_args.args[0]).name, 'download.aesgcm')
            self.assertTrue(report['source_restore_verified'])
            self.assertFalse(report['runtime_restore_verified'])
            self.assertEqual(storage.writes, [report['key'], report['key'] + '.json'])
            manifest = json.loads(storage.objects['fixture-bucket', report['key'] + '.json'])
            self.assertEqual(manifest['commit'], commit)
            self.assertNotIn(key.hex(), json.dumps(manifest))
            self.assertNotIn(b'EXAMPLE_API_KEY', storage.objects['fixture-bucket', report['key']])

    def test_corrupt_and_oversize_cipher_never_publish_completion_manifest(self):
        for corruption in ('cipher', 'oversize'):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as temp:
                package, commit = self.package(Path(temp))
                storage = Storage(corruption)
                with self.assertRaises(ValueError):
                    upload.upload(package, storage, 'fixture-bucket', os.urandom(32), commit)
                self.assertEqual(len(storage.writes), 1)

    def test_manifest_failure_and_conditional_write_failure_never_report_success(self):
        for storage in (Storage('manifest'), Storage(reject_put=True)):
            with tempfile.TemporaryDirectory() as temp:
                package, commit = self.package(Path(temp))
                with self.assertRaises(ValueError):
                    upload.upload(package, storage, 'fixture-bucket', os.urandom(32), commit)

    def test_wrong_trusted_commit_never_contacts_storage(self):
        with tempfile.TemporaryDirectory() as temp:
            package, _ = self.package(Path(temp))
            storage = Storage()
            with self.assertRaises(ValueError):
                upload.upload(package, storage, 'fixture-bucket', os.urandom(32), '0' * 40)
            self.assertEqual(storage.writes, [])

    def test_configuration_is_opt_in_and_rejects_wrong_destinations(self):
        env = {'TECH_PHASE_SOURCE_UPLOAD_ENABLED': 'true', 'TECH_PHASE_EXTERNAL_KEY_HEX': 'a' * 64,
               'MIRROR_DESTINATION_ENDPOINT': 'https://' + 'b' * 32 + '.r2.cloudflarestorage.com',
               'MIRROR_DESTINATION_BUCKET': 'fixture-bucket', 'MIRROR_DESTINATION_REGION': 'auto',
               'MIRROR_DESTINATION_ACCESS_KEY_ID': 'fixture', 'MIRROR_DESTINATION_SECRET_ACCESS_KEY': 'fixture'}
        self.assertEqual(len(upload.configuration(env)[1]), 32)
        for name, value in [('TECH_PHASE_SOURCE_UPLOAD_ENABLED', ''),
                            ('TECH_PHASE_EXTERNAL_KEY_HEX', ''),
                            ('MIRROR_DESTINATION_ENDPOINT', 'https://example.com'),
                            ('MIRROR_DESTINATION_ENDPOINT', env['MIRROR_DESTINATION_ENDPOINT'] + '.evil.test'),
                            ('MIRROR_DESTINATION_ENDPOINT', env['MIRROR_DESTINATION_ENDPOINT'] + '/path'),
                            ('MIRROR_DESTINATION_SECRET_ACCESS_KEY', '')]:
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                upload.configuration({**env, name: value})
