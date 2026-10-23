import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tech-phase'))
import external_dependencies as recovery
import prepare_offline_dependencies as prepare
from test_source_recovery_upload import Storage


class DependencyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        pkg = self.repo / 'node_modules/pkg'
        pkg.mkdir(parents=True)
        lock = json.dumps({'packages': {'node_modules/pkg': {'version': '1.0.0'}}})
        (self.repo / 'package-lock.json').write_text(lock)
        (self.repo / 'node_modules/.package-lock.json').write_text(lock)
        (pkg / 'run.js').write_text('process.stdout.write("fixture");')
        (pkg / 'run.js').chmod(0o755)
        (pkg / 'alias').symlink_to('run.js')
        self.package = self.root / 'package'
        self.lock = prepare.prepare(self.repo, self.package)['lock_sha256']
        self.key = os.urandom(32)
        self.output = self.root / 'restored'

    def rewrite(self, entries):
        """Construct authenticated-but-malformed archives, not only bit flips."""
        manifest = json.loads((self.package / 'manifest.json').read_text())
        archive = self.package / 'dependencies.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for entry, content in entries:
                member = tarfile.TarInfo(entry['path'])
                if 'link' in entry:
                    member.type = tarfile.SYMTYPE
                    member.linkname = entry['link']
                    tar.addfile(member)
                else:
                    member.size = len(content)
                    tar.addfile(member, io.BytesIO(content))
        manifest.update(files=[entry for entry, _ in entries], archive_bytes=archive.stat().st_size,
                        archive_sha256=recovery.digest(archive))
        (self.package / 'manifest.json').write_text(json.dumps(manifest))

    def test_real_cipher_download_decrypt_extract_hashes_modes_and_links(self):
        storage = Storage()
        with patch.object(recovery, 'restore', wraps=recovery.restore) as restore:
            report = recovery.upload(self.package, storage, 'fixture-bucket', self.key, self.lock, self.output)
        self.assertEqual(Path(restore.call_args.args[0]).name, 'download.aesgcm')
        self.assertTrue(report['dependency_restore_verified'])
        self.assertFalse(report['runtime_build_verified'])
        self.assertFalse(report['includes_node_runtime'])
        self.assertEqual(storage.writes, [report['key'], report['key'] + '.json'])
        self.assertEqual((self.output / 'node_modules/pkg/alias').read_text(), 'process.stdout.write("fixture");')
        self.assertEqual((self.output / 'node_modules/pkg/run.js').stat().st_mode & 0o111, 0o111)
        self.assertNotIn(self.key.hex(), json.dumps(report))
        self.assertNotIn(b'process.stdout', storage.objects['fixture-bucket', report['key']])

    def test_wrong_key_lock_and_tampering_never_publish_plaintext(self):
        cipher = self.root / 'cipher'
        recovery.seal(self.package, cipher, self.key, self.lock)
        for key, lock in ((os.urandom(32), self.lock), (self.key, '0' * 64)):
            with self.assertRaises(Exception):
                recovery.restore(cipher, key, lock, self.output)
            self.assertFalse(self.output.exists())
        data = cipher.read_bytes()
        cipher.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaises(Exception):
            recovery.restore(cipher, self.key, self.lock, self.output)
        self.assertFalse(self.output.exists())

    def test_corrupt_download_never_publishes_receipt_or_restored_files(self):
        for corruption in ('cipher', 'oversize'):
            storage = Storage(corruption)
            with self.assertRaises(ValueError):
                recovery.upload(self.package, storage, 'fixture-bucket', self.key, self.lock, self.output)
            self.assertEqual(len(storage.writes), 1)
            self.assertFalse(self.output.exists())

    def test_failed_manifest_readback_never_returns_success(self):
        with self.assertRaises(ValueError):
            recovery.upload(self.package, Storage('manifest'), 'fixture-bucket', self.key, self.lock, self.output)

    def test_platform_lock_and_existing_output_rejected(self):
        manifest = self.package / 'manifest.json'
        original = json.loads(manifest.read_text())
        for field, value in [('runtime', {}), ('libc', []), ('lock_sha256', '0' * 64), ('archive_sha256', '0' * 64)]:
            manifest.write_text(json.dumps({**original, field: value}))
            with self.assertRaises(ValueError):
                recovery.restore_package(self.package, self.output, self.lock)
            self.assertFalse(self.output.exists())
        manifest.write_text(json.dumps(original))
        self.output.mkdir()
        (self.output / 'retained').write_text('keep')
        with self.assertRaises(ValueError):
            recovery.restore_package(self.package, self.output, self.lock)
        self.assertEqual((self.output / 'retained').read_text(), 'keep')

    def test_traversal_credentials_duplicate_and_parent_links_rejected(self):
        empty = {'size': 0, 'sha256': __import__('hashlib').sha256(b'').hexdigest()}
        cases = [[({'path': name, **empty}, b'')] for name in
                 ('../escape', '/tmp/escape', 'node_modules/../escape',
                  'node_modules/.env', 'node_modules//bad', 'node_modules/./bad')]
        cases += [
            [({'path': 'node_modules/pkg', 'link': '../../escape'}, b'')],
            [({'path': 'node_modules/pkg', 'link': '../other'}, b''),
             ({'path': 'node_modules/pkg/file', **empty}, b'')],
            [({'path': 'node_modules/a', **empty}, b'')] * 2,
            [({'path': 'node_modules/a', 'link': 'b'}, b''),
             ({'path': 'node_modules/b', 'link': 'a'}, b'')],
            [({'path': 'node_modules/missing', 'link': 'absent'}, b'')],
        ]
        for entries in cases:
            with self.subTest(entries=entries):
                self.rewrite(entries)
                with self.assertRaises((ValueError, RuntimeError, OSError)):
                    recovery.restore_package(self.package, self.output, self.lock)
                self.assertFalse(self.output.exists())

    def test_file_corruption_rejected_even_with_matching_outer_archive_hash(self):
        entry = {'path': 'node_modules/file', 'size': 3, 'sha256': '0' * 64}
        self.rewrite([(entry, b'bad')])
        with self.assertRaises(ValueError):
            recovery.restore_package(self.package, self.output, self.lock)
        self.assertFalse(self.output.exists())

    def test_source_gate_does_not_enable_dependency_upload(self):
        env = {'TECH_PHASE_SOURCE_UPLOAD_ENABLED': 'true', 'TECH_PHASE_EXTERNAL_KEY_HEX': 'a' * 64,
               'MIRROR_DESTINATION_ENDPOINT': 'https://' + 'b' * 32 + '.r2.cloudflarestorage.com',
               'MIRROR_DESTINATION_BUCKET': 'fixture-bucket', 'MIRROR_DESTINATION_REGION': 'auto',
               'MIRROR_DESTINATION_ACCESS_KEY_ID': 'fixture', 'MIRROR_DESTINATION_SECRET_ACCESS_KEY': 'fixture'}
        with self.assertRaises(ValueError):
            recovery.configuration(env, scope='dependencies')
        env['TECH_PHASE_DEPENDENCIES_UPLOAD_ENABLED'] = 'true'
        self.assertEqual(len(recovery.configuration(env, scope='dependencies')[1]), 32)
