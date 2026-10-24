import copy
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tech-phase'))
import external_runtime as recovery
import verify_runtime_image as probe
from test_source_recovery_upload import Storage

COMMIT = 'a' * 40
TREE = 'b' * 40
IMAGE = 'sha256:' + 'c' * 64


class RuntimeCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'image.tar.gz'
        self.archive.write_bytes(gzip.compress(b'fixture image bytes, not a real Docker image'))
        self.key = os.urandom(32)
        self.output = self.root / 'restored.tar.gz'

    def upload(self, storage=None):
        return recovery.upload(self.archive, storage or Storage(), 'fixture-bucket', self.key,
                               COMMIT, TREE, 'api', IMAGE, self.output)

    def sealed(self):
        path = self.root / 'cipher'
        recovery.encrypt(self.archive, path, self.key, recovery.context(COMMIT, 'api', IMAGE))
        return path

    def restore(self, path, **changes):
        values = dict(cipher=path, key=self.key, commit=COMMIT, service='api', image_id=IMAGE,
                      cipher_sha=recovery.digest(path), archive_sha=recovery.digest(self.archive),
                      output=self.output)
        values.update(changes)
        return recovery.restore(**values)

    def test_real_crypto_uses_downloaded_bytes_and_does_not_claim_image_boot(self):
        storage = Storage()
        with patch.object(recovery, 'restore', wraps=recovery.restore) as restore:
            result = self.upload(storage)
        self.assertEqual(Path(restore.call_args.args[0]).name, 'download.aesgcm')
        self.assertEqual(self.output.read_bytes(), self.archive.read_bytes())
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertTrue(result['archive_restored'])
        for field in ('image_loaded', 'runtime_boot_verified', 'live_database_verified', 'deployed_image_export'):
            self.assertFalse(result[field])
        self.assertEqual(storage.writes, [result['key'], result['key'] + '.json'])
        self.assertNotIn(self.key.hex(), json.dumps(result))
        self.assertNotIn(self.archive.read_bytes(), storage.objects['fixture-bucket', result['key']])

    def test_wrong_key_source_service_image_and_plain_hash_do_not_publish(self):
        cipher = self.sealed()
        cases = [{'key': os.urandom(32)}, {'commit': 'd' * 40}, {'service': 'billing'},
                 {'image_id': 'sha256:' + 'e' * 64}, {'archive_sha': '0' * 64},
                 {'cipher_sha': '0' * 64}]
        for case in cases:
            with self.subTest(case=list(case)):
                with self.assertRaises(Exception):
                    self.restore(cipher, **case)
                self.assertFalse(self.output.exists())

    def test_gcm_tampering_and_truncation_rejected_even_with_recomputed_cipher_hash(self):
        cipher = self.sealed()
        original = cipher.read_bytes()
        for damaged in (original[:-1] + bytes([original[-1] ^ 1]), original[:-20]):
            cipher.write_bytes(damaged)
            with self.assertRaises(Exception):
                self.restore(cipher)
            self.assertFalse(self.output.exists())

    def test_corrupt_or_oversized_download_never_publishes_manifest(self):
        for corruption in ('cipher', 'oversize'):
            storage = Storage(corruption)
            with self.assertRaises(ValueError):
                self.upload(storage)
            self.assertEqual(len(storage.writes), 1)
            self.assertFalse(self.output.exists())

    def test_manifest_readback_failure_and_rejected_write_never_return_success(self):
        with self.assertRaises(ValueError):
            self.upload(Storage('manifest'))
        self.output.unlink()
        storage = Storage(reject_put=True)
        with self.assertRaises(ValueError):
            self.upload(storage)
        self.assertFalse(self.output.exists())
        self.assertEqual(storage.writes, [])

    def test_size_non_gzip_and_existing_outputs_are_rejected_before_upload(self):
        storage = Storage()
        with patch.object(recovery, 'MAX_ARCHIVE', 8), self.assertRaises(ValueError):
            self.upload(storage)
        self.archive.write_bytes(b'not a compressed archive')
        with self.assertRaises(ValueError):
            self.upload(storage)
        self.assertEqual(storage.writes, [])
        self.output.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            self.upload(storage)
        self.assertEqual(self.output.read_bytes(), b'keep')

    def test_source_and_dependency_gates_do_not_enable_runtime_upload(self):
        env = {'TECH_PHASE_SOURCE_UPLOAD_ENABLED': 'true', 'TECH_PHASE_DEPENDENCIES_UPLOAD_ENABLED': 'true',
               'TECH_PHASE_EXTERNAL_KEY_HEX': 'a' * 64,
               'MIRROR_DESTINATION_ENDPOINT': 'https://' + 'b' * 32 + '.r2.cloudflarestorage.com',
               'MIRROR_DESTINATION_BUCKET': 'fixture-bucket', 'MIRROR_DESTINATION_REGION': 'auto',
               'MIRROR_DESTINATION_ACCESS_KEY_ID': 'fixture', 'MIRROR_DESTINATION_SECRET_ACCESS_KEY': 'fixture'}
        with self.assertRaises(ValueError):
            recovery.configuration(env, scope='runtime')
        values, key = recovery.configuration({**env, 'TECH_PHASE_RUNTIME_UPLOAD_ENABLED': 'true'}, scope='runtime')
        self.assertEqual(values['BUCKET'], 'fixture-bucket')
        self.assertEqual(len(key), 32)

    def test_context_rejects_credential_files_links_and_private_material_across_chunks(self):
        source = self.root / 'source'
        source.mkdir()
        (source / '.env.example').write_text('EXAMPLE=placeholder')
        self.assertTrue(recovery.validate_source_context(source)['source_context_checked'])
        for name in ('.env', '.env.production', '.npmrc', 'id_rsa', 'identity.pem'):
            path = source / name
            path.write_text('fixture')
            with self.assertRaises(ValueError):
                recovery.validate_source_context(source)
            path.unlink()
        link = source / 'alias'
        link.symlink_to(self.archive)
        with self.assertRaises(ValueError):
            recovery.validate_source_context(source)
        link.unlink()
        material = source / 'unexpected.txt'
        material.write_bytes(b'x' * (1024 * 1024 - 8) + b'-----BEGIN ' + b'PRIVATE KEY-----\n' + b'A' * 80)
        with self.assertRaises(ValueError):
            recovery.validate_source_context(source)

    def test_cipher_symlink_and_existing_plaintext_are_preserved(self):
        cipher = self.sealed()
        link = self.root / 'cipher-link'
        link.symlink_to(cipher)
        with self.assertRaises(ValueError):
            self.restore(link)
        self.output.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            self.restore(cipher)
        self.assertEqual(self.output.read_bytes(), b'keep')


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.image = {'Id': IMAGE, 'Architecture': 'amd64', 'Os': 'linux',
                      'Config': {'Env': ['NODE_ENV=production'],
                                 'Labels': {'org.opencontainers.image.revision': COMMIT}},
                      'RootFS': {'Layers': ['fixture-layer']}}
        self.host = {'NetworkMode': 'none', 'ReadonlyRootfs': True, 'CapDrop': ['ALL'], 'Binds': None,
                     'CapAdd': None, 'Privileged': False, 'SecurityOpt': ['no-new-privileges']}
        self.exec_result = {'http_checks': 7}
        self.exec_failure = False
        self.oneshot = {'backup_toolchain_verified': True, 'database_connected': False}

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        if args[:2] == ['image', 'inspect']:
            return json.dumps([self.image])
        if args[0] == 'create':
            return 'fixture-container'
        if args[0] == 'inspect':
            if '--format' in args:
                return '0' if args[2] == '{{.State.ExitCode}}' else 'true'
            return json.dumps([{'HostConfig': self.host}])
        if args[0] == 'start':
            return json.dumps(self.oneshot) if '--attach' in args else 'fixture-container'
        if args[0] == 'exec':
            if self.exec_failure:
                raise subprocess.CalledProcessError(1, 'fixture')
            return json.dumps(self.exec_result)
        if args[0] == 'logs':
            return ''
        if args[0] == 'rm':
            return 'fixture-container'
        raise AssertionError(args)


class RuntimeProbeTests(unittest.TestCase):
    def test_exact_source_and_platform_and_credential_free_image_required(self):
        original = FakeDocker().image
        cases = [dict(Id='sha256:'+'0'*64), dict(Architecture='arm64'), dict(Os='windows'),
                 dict(Config={'Labels': {'org.opencontainers.image.revision':'d'*40}, 'Env': []}),
                 dict(Config={'Labels': {'org.opencontainers.image.revision':COMMIT}, 'Env':['OPENAI_API_KEY=fixture']}),
                 dict(Config={'Labels': {'org.opencontainers.image.revision':COMMIT}, 'Env':['secret=fixture']})]
        for changes in cases:
            fake = FakeDocker()
            fake.image = {**copy.deepcopy(original), **changes}
            with patch.object(probe, 'command', fake), self.assertRaises(ValueError):
                probe.verify('api', IMAGE, COMMIT)
            self.assertFalse(any(c[0]=='create' for c in fake.calls))

    def test_only_reviewed_public_signing_fingerprint_is_allowed(self):
        fake=FakeDocker()
        fingerprint=next(iter(probe.PUBLIC_IMAGE_ENV['GPG_KEY']))
        fake.image['Config']['Env'].append('GPG_KEY='+fingerprint)
        with patch.object(probe,'command',fake):
            self.assertTrue(probe.inspect_image(IMAGE,COMMIT)['image_config_checked'])
        for value in ('0'*40,'fixture-private'):
            fake.image['Config']['Env']=['GPG_KEY='+value]
            with patch.object(probe,'command',fake), self.assertRaises(ValueError):
                probe.inspect_image(IMAGE,COMMIT)

    def test_verified_network_none_and_readonly_are_required_before_start(self):
        for change in ({'NetworkMode':'bridge'}, {'ReadonlyRootfs':False}, {'CapDrop':[]}, {'Binds':['/secret:/app']}, {'CapAdd':['SYS_ADMIN']},
                       {'Privileged':True}, {'SecurityOpt':[]}):
            fake = FakeDocker()
            fake.host.update(change)
            with patch.object(probe, 'command', fake), self.assertRaises(ValueError):
                probe.verify('api', IMAGE, COMMIT)
            self.assertFalse(any(c[0]=='start' for c in fake.calls))
            self.assertEqual(fake.calls[-1][0], 'rm')

    def test_probe_failure_and_false_receipts_fail_closed_and_cleanup(self):
        for failure in ('exec', 'incomplete', 'false-backup'):
            fake = FakeDocker()
            if failure=='exec':fake.exec_failure=True
            if failure=='incomplete':fake.exec_result={'http_checks':True}
            if failure=='false-backup':fake.oneshot['backup_toolchain_verified']=False
            with patch.object(probe, 'command', fake), self.assertRaises(Exception):
                probe.verify('backup' if failure=='false-backup' else 'api', IMAGE, COMMIT)
            self.assertEqual(fake.calls[-1][0], 'rm')

    def test_boot_receipt_distinguishes_disposable_http_from_live_database(self):
        fake = FakeDocker()
        with patch.object(probe, 'command', fake):
            result = probe.verify('api', IMAGE, COMMIT)
        self.assertTrue(result['runtime_probe_verified'])
        self.assertTrue(result['network_disabled'])
        self.assertFalse(result['live_database_verified'])
        self.assertFalse(result['authenticated_storage_verified'])
        self.assertEqual(result['live_ai_calls'], 0)
        create = next(c for c in fake.calls if c[0]=='create')
        self.assertIn('--pull=never', create)
        self.assertIn('--network=none', create)
        self.assertEqual(fake.calls[-1][:3], ['rm', '--force', '--volumes'])

    def test_command_does_not_inherit_provider_or_remote_docker_configuration(self):
        result = subprocess.CompletedProcess([],0,stdout='ok',stderr='')
        with patch.dict(os.environ, {'OPENAI_API_KEY':'fixture-private','DOCKER_HOST':'tcp://invalid:2375'}):
            with patch.object(subprocess,'run',return_value=result) as run:
                self.assertEqual(probe.command(['info']), 'ok')
        self.assertEqual(set(run.call_args.kwargs['env']), {'PATH'})
        self.assertEqual(run.call_args.args[0][:3], ['docker','--host','unix:///var/run/docker.sock'])
        for service in recovery.SERVICES:
            self.assertNotIn('OPENAI_API_KEY', probe.configuration(service))
