import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

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
    def recovery_pair(self, root):
        source = root / 'live.sqlite'
        self.source(source)
        store = Store()
        report = module.backup(source, store, 'external', b'x' * 32)
        archive = root / 'backup.aesgcm'
        archive.write_bytes(store.objects[report['key']])
        manifest = json.loads(store.objects[report['key'] + '.json'])
        return archive, manifest

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
            self.assertTrue(report['restore_verified'])
            self.assertTrue(json.loads(store.objects[report['key'] + '.json'])['restore_verified'])
            self.assertFalse(report['full_site_recovery_verified'])
            self.assertEqual(len(store.objects), 2)

    def test_restore_reads_downloaded_bytes_before_manifest_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = Store()
            verifier = module.verify_restore
            restored_paths = []

            def inspect(archive, manifest, key):
                restored_paths.append(archive)
                self.assertEqual(archive.name, 'downloaded.aesgcm')
                self.assertEqual(archive.read_bytes(), store.objects[manifest['key']])
                self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
                self.assertEqual(len(store.objects), 1)
                return verifier(archive, manifest, key)

            with patch.object(module, 'verify_restore', side_effect=inspect):
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(len(restored_paths), 1)
            self.assertFalse(restored_paths[0].parent.exists())

    def test_matching_cipher_checksum_does_not_replace_decryption_check(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = Store()
            encrypt = module.encrypt
            temporary_paths = []

            def wrong_key(source, target, key, object_key):
                temporary_paths.append(target)
                encrypt(source, target, b'y' * 32, object_key)

            with patch.object(module, 'encrypt', side_effect=wrong_key):
                with self.assertRaises(Exception):
                    module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(len(store.objects), 1)
            self.assertFalse(any(key.endswith('.json') for key in store.objects))
            self.assertFalse(temporary_paths[0].parent.exists())

    def test_manifest_readback_failure_never_reports_success(self):
        class BadManifestStore(Store):
            def get_object(self, Bucket, Key):
                if Key.endswith('.json'):
                    return {'Body': io.BytesIO(b'bad')}
                return super().get_object(Bucket, Key)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = BadManifestStore()
            with self.assertRaises(module.BackupStageError) as failure:
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(failure.exception.stage, 'manifest_readback')
            self.assertEqual(len(store.objects), 2)

    def test_corrupt_readback_never_publishes_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            self.source(path)
            store = Store(corrupt=True)
            with self.assertRaises(module.BackupStageError) as failure:
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(failure.exception.stage, 'download')
            self.assertEqual(len(store.objects), 1)

    def test_missing_or_incomplete_database_never_uploads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.sqlite'
            store = Store()
            with self.assertRaises(module.BackupStageError) as failure:
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(failure.exception.stage, 'snapshot')
            self.assertFalse(path.exists())
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE unrelated (id INTEGER)')
            with self.assertRaises(module.BackupStageError) as failure:
                module.backup(path, store, 'external', b'x' * 32)
            self.assertEqual(failure.exception.stage, 'snapshot')
            self.assertFalse(store.objects)

    def test_configuration_fails_closed(self):
        for env in ({}, {'TECH_PHASE_EXTERNAL_BACKUP_ENABLED': 'true'}):
            with self.assertRaises(ValueError):
                module.configuration(env)

    def configuration(self):
        return {
            'TECH_PHASE_EXTERNAL_BACKUP_ENABLED': 'true',
            'RESEARCH_DB_PATH': '/private/fixture.sqlite',
            'TECH_PHASE_EXTERNAL_KEY_HEX': 'ab' * 32,
            'MIRROR_DESTINATION_ENDPOINT': 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com',
            'MIRROR_DESTINATION_BUCKET': 'resolute-backup-external',
            'MIRROR_DESTINATION_REGION': 'auto',
            'MIRROR_DESTINATION_ACCESS_KEY_ID': 'fixture-only',
            'MIRROR_DESTINATION_SECRET_ACCESS_KEY': 'fixture-only-secret',
        }

    def test_existing_r2_destination_accepts_standard_and_jurisdiction_endpoints(self):
        for jurisdiction in ('', '.eu', '.fedramp'):
            for suffix in ('', '/', ':443', ':443/'):
                with self.subTest(jurisdiction=jurisdiction, suffix=suffix):
                    env = self.configuration()
                    endpoint = 'https://' + 'a' * 32 + jurisdiction + '.r2.cloudflarestorage.com' + suffix
                    env['MIRROR_DESTINATION_ENDPOINT'] = endpoint
                    source, config, key = module.configuration(env)
                    self.assertEqual(source, env['RESEARCH_DB_PATH'])
                    self.assertEqual(config['ENDPOINT'], endpoint)
                    self.assertEqual(config['BUCKET'], 'resolute-backup-external')
                    self.assertEqual(key, bytes.fromhex('ab' * 32))

    def test_wrong_endpoint_bucket_or_region_rejected_before_client_creation(self):
        endpoint = self.configuration()['MIRROR_DESTINATION_ENDPOINT']
        invalid = [
            ('ENDPOINT', value) for value in (
                'https://example.com', 'https://localhost', 'https://127.0.0.1',
                'https://bucket.s3.amazonaws.com', endpoint.replace('https:', 'http:'),
                endpoint + '.example.com', endpoint + ':8443', endpoint + ':bad',
                endpoint + '/bucket', endpoint + '?query=1', endpoint + '#fragment',
                endpoint.replace('https://', 'https://user:password@'),
                endpoint.replace('a' * 32, 'a' * 31), endpoint.replace('a' * 32, 'g' * 32),
                endpoint.replace('.r2.', '.other.r2.'), endpoint + '.',
                '\n' + endpoint, endpoint + '\n', endpoint.replace('.r2.', '.r2.\n'),
            )
        ] + [('BUCKET', 'other-bucket'), ('BUCKET', ''), ('REGION', 'us-east-1'), ('REGION', '')]
        for name, value in invalid:
            with self.subTest(name=name, value=value):
                env = self.configuration()
                env['MIRROR_DESTINATION_' + name] = value
                sdk = Mock()
                with patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', ['backup']), \
                        patch.dict(sys.modules, {'boto3': sdk}), patch.object(module, 'backup') as backup:
                    with self.assertRaises(module.BackupStageError) as failure:
                        module.main()
                    self.assertEqual(failure.exception.stage, 'configuration')
                    sdk.client.assert_not_called()
                    backup.assert_not_called()

    def test_failed_stages_remove_temporaries_and_never_report_success(self):
        stages = ('snapshot', 'encrypt', 'upload', 'download', 'restore',
                  'manifest_upload', 'manifest_readback')
        for failed_stage in stages:
            with self.subTest(stage=failed_stage), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'live.sqlite'
                self.source(source)
                store = Store()
                real_stage = module.stage

                # Fail after the operation's side effect, including a server
                # accepting an upload whose response was lost. Do not delete it
                # or announce success; every private local temporary must go.
                from contextlib import contextmanager
                @contextmanager
                def fail_after(name):
                    with real_stage(name):
                        yield
                        if name == failed_stage:
                            raise OSError('fixture credential MUST_NOT_APPEAR')

                def action():
                    print(json.dumps(module.backup(source, store, 'external', b'x' * 32)))

                output = io.StringIO()
                with patch.object(tempfile, 'tempdir', directory), \
                        patch.object(module, 'stage', side_effect=fail_after), \
                        patch.object(module, 'main', side_effect=action), \
                        patch('sys.stdout', output):
                    self.assertEqual(module.run(), 1)
                self.assertEqual(json.loads(output.getvalue()), {
                    'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED', 'stage': failed_stage})
                self.assertFalse(list(root.glob('research-*')))
                self.assertEqual(len(store.objects),
                                 0 if failed_stage in ('snapshot', 'encrypt') else
                                 2 if failed_stage in ('manifest_upload', 'manifest_readback') else 1)
                self.assertTrue(source.exists())

    def test_configuration_and_client_failures_are_safe_and_do_not_start_backup(self):
        for env, expected in (({}, 'configuration'), (self.configuration(), 'client')):
            with self.subTest(stage=expected):
                sdk = Mock()
                sdk.client.side_effect = RuntimeError('fixture credential MUST_NOT_APPEAR')
                output = io.StringIO()
                with patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', ['backup']), \
                        patch.dict(sys.modules, {'boto3': sdk, 'botocore.config': Mock()}), \
                        patch.object(module, 'backup') as backup, patch('sys.stdout', output):
                    self.assertEqual(module.run(), 1)
                self.assertEqual(json.loads(output.getvalue()), {
                    'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED', 'stage': expected})
                backup.assert_not_called()
                if expected == 'configuration':
                    sdk.client.assert_not_called()
                else:
                    sdk.client.assert_called_once()

    def test_unknown_diagnostic_and_exception_text_are_never_printed(self):
        for error in (ValueError('fixture secret'), module.BackupStageError('fixture secret'),
                      module.BackupStageError(['fixture secret'])):
            output = io.StringIO()
            with patch.object(module, 'main', side_effect=error), patch('sys.stdout', output):
                self.assertEqual(module.run(), 1)
            self.assertEqual(json.loads(output.getvalue()), {
                'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED', 'stage': 'internal'})

    def test_verify_cli_distinguishes_input_and_restore_failure_without_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'manifest.json'
            archive = root / 'missing.aesgcm'
            for value, expected in (('{', 'archive_input'), ('{}', 'restore')):
                manifest.write_text(value)
                output = io.StringIO()
                sdk = Mock()
                with patch.dict(os.environ, {'TECH_PHASE_EXTERNAL_KEY_HEX': 'ab' * 32}, clear=True), \
                        patch.object(sys, 'argv', ['backup', '--verify-archive', str(archive),
                                                  '--manifest', str(manifest)]), \
                        patch.dict(sys.modules, {'boto3': sdk}), patch('sys.stdout', output):
                    self.assertEqual(module.run(), 1)
                self.assertEqual(json.loads(output.getvalue()), {
                    'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED', 'stage': expected})
                sdk.client.assert_not_called()

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

    def test_export_cli_leaves_verified_wal_data_private_without_client_or_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, manifest = self.recovery_pair(root)
            metadata = root / 'manifest.json'
            metadata.write_text(json.dumps(manifest))
            output = root / 'recovered.sqlite'
            sdk = Mock()
            stdout = io.StringIO()
            with patch.dict(os.environ, {'TECH_PHASE_EXTERNAL_KEY_HEX': '78' * 32}, clear=True), \
                    patch.object(sys, 'argv', ['backup', '--verify-archive', str(archive),
                                              '--manifest', str(metadata), '--restore-output', str(output)]), \
                    patch.dict(sys.modules, {'boto3': sdk}), patch('sys.stdout', stdout):
                self.assertEqual(module.run(), 0)
            report = json.loads(stdout.getvalue())
            self.assertEqual(report['event'], 'TECH_PHASE_RESEARCH_RESTORE_EXPORT_OK')
            self.assertTrue(report['output_written'])
            self.assertFalse(report['promotion'])
            self.assertEqual(report['sha256'], manifest['plaintext_sha256'])
            self.assertEqual(module.persistence.digest(output), manifest['plaintext_sha256'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.stat().st_nlink, 1)
            with sqlite3.connect(output.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
                self.assertEqual(db.execute('SELECT document FROM member_saved_research').fetchone(),
                                 ('private notes',))
            self.assertNotIn(str(output), stdout.getvalue())
            self.assertFalse(list(root.glob('research-restore-*')))
            sdk.client.assert_not_called()

    def test_export_authentication_hash_and_database_failures_leave_no_output(self):
        for failure in ('key', 'cipher', 'plaintext_hash', 'database'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive, manifest = self.recovery_pair(root)
                key = b'x' * 32
                if failure == 'key':
                    key = b'y' * 32
                elif failure == 'cipher':
                    data = bytearray(archive.read_bytes())
                    data[20] ^= 1
                    archive.write_bytes(data)
                    manifest['sha256'] = module.persistence.digest(archive)
                elif failure == 'plaintext_hash':
                    manifest['plaintext_sha256'] = '0' * 64
                else:
                    invalid = root / 'invalid.sqlite'
                    invalid.write_bytes(b'not a database')
                    archive.unlink()
                    module.encrypt(invalid, archive, key, manifest['key'])
                    manifest.update(bytes=archive.stat().st_size, sha256=module.persistence.digest(archive),
                                    plaintext_sha256=module.persistence.digest(invalid))
                output = root / 'recovered.sqlite'
                with self.assertRaises(Exception):
                    module.verify_restore(archive, manifest, key, output=output)
                self.assertFalse(output.exists())
                self.assertFalse(list(root.glob('research-restore-*')))

    def test_export_rejects_existing_outputs_sidecars_and_unsafe_parents(self):
        for scenario in ('file', 'directory', 'symlink', '-wal', '-shm', '-journal',
                         'parent_symlink', 'shared_parent', 'relative'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive, manifest = self.recovery_pair(root)
                output = root / 'recovered.sqlite'
                if scenario == 'file':
                    output.write_bytes(b'keep existing database')
                elif scenario == 'directory':
                    output.mkdir()
                elif scenario == 'symlink':
                    output.symlink_to(root / 'missing')
                elif scenario.startswith('-'):
                    Path(str(output) + scenario).write_bytes(b'keep sidecar')
                elif scenario == 'parent_symlink':
                    alias = root / 'alias'
                    alias.symlink_to(root, target_is_directory=True)
                    output = alias / 'recovered.sqlite'
                elif scenario == 'shared_parent':
                    root.chmod(0o755)
                else:
                    output = Path('relative-export.sqlite')
                before = {p.name: p.lstat().st_ino for p in root.iterdir()}
                with self.assertRaises(module.BackupStageError) as error:
                    module.verify_restore(archive, manifest, b'x' * 32, output=output)
                self.assertEqual(error.exception.stage, 'export_output')
                self.assertEqual({p.name: p.lstat().st_ino for p in root.iterdir()}, before)
                if scenario == 'file':
                    self.assertEqual(output.read_bytes(), b'keep existing database')

    def test_export_race_and_disk_failure_never_overwrite_or_publish_partial_db(self):
        for failure in ('race', 'disk'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive, manifest = self.recovery_pair(root)
                output = root / 'recovered.sqlite'
                real_link = os.link
                def competing_output(source, destination):
                    Path(destination).write_bytes(b'keep concurrent database')
                    real_link(source, destination)
                operation = patch.object(module.os, 'link', side_effect=competing_output) if failure == 'race' \
                    else patch.object(module.os, 'fsync', side_effect=OSError('disk error'))
                with operation, self.assertRaises(module.BackupStageError) as error:
                    module.verify_restore(archive, manifest, b'x' * 32, output=output)
                self.assertEqual(error.exception.stage, 'export_output')
                if failure == 'race':
                    self.assertEqual(output.read_bytes(), b'keep concurrent database')
                else:
                    self.assertFalse(output.exists())
                self.assertFalse(list(root.glob('research-restore-*')))

    def test_default_verification_does_not_export_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, manifest = self.recovery_pair(root)
            before = set(root.iterdir())
            with patch.object(tempfile, 'tempdir', directory):
                report = module.verify_restore(archive, manifest, b'x' * 32)
            self.assertEqual(report['event'], 'TECH_PHASE_RESEARCH_ISOLATED_RESTORE_OK')
            self.assertNotIn('output_written', report)
            self.assertEqual(set(root.iterdir()), before)

    def test_export_argument_alone_cannot_start_backup(self):
        stdout = io.StringIO()
        with patch.object(sys, 'argv', ['backup', '--restore-output', '/private/new.sqlite']), \
                patch.object(module, 'backup') as backup, patch('sys.stdout', stdout):
            self.assertEqual(module.run(), 1)
        self.assertEqual(json.loads(stdout.getvalue())['stage'], 'archive_input')
        backup.assert_not_called()
