import importlib.util
import json
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('protection_keys', Path(__file__).resolve().parents[1] / 'scripts/resolute/protection_keys.py')
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)


class KeyEscrowTests(unittest.TestCase):
    def setUp(self):
        self.key = bytes(range(32))
        self.recipient = 'age1' + 'a' * 58
        self.run = lambda args, body: b'test:' + body if args[0] == '-r' else body.removeprefix(b'test:')
        self.cipher, self.receipt = keys.seal(self.key, self.recipient, 'fake-identity', self.run)

    def recover(self, **overrides):
        args = dict(cipher=self.cipher, identity='fake-identity', pin=self.receipt['capsuleSha256'], expected=self.receipt['keyFingerprint'], run=self.run)
        args.update(overrides)
        return keys.recover(**args)

    def test_round_trip(self):
        self.assertEqual(self.recover(), self.key)
        self.assertNotIn(self.key.hex(), json.dumps(self.receipt))

    def test_tampering_stops_before_decryption(self):
        def forbidden(*args):
            self.fail('decrypt called before checksum verification')
        with self.assertRaises(ValueError):
            self.recover(cipher=self.cipher + b'x', run=forbidden)

    def test_wrong_key_fingerprint(self):
        with self.assertRaises(ValueError):
            self.recover(expected='0' * 64)

    def test_wrong_identity_blocks_seal(self):
        def failed(args, body):
            if args[0] == '-d':
                raise ValueError('wrong identity')
            return self.run(args, body)
        with self.assertRaises(ValueError):
            keys.seal(self.key, self.recipient, 'wrong', failed)

    def test_bad_payloads(self):
        for raw in (b'[]', b'{}', b'{"purpose":"x","purpose":"y"}',
                    json.dumps({'purpose': 'other', 'keyHex': self.key.hex()}).encode(),
                    json.dumps({'purpose': keys.PURPOSE, 'keyHex': self.key.hex(), 'extra': 1}).encode()):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.recover(run=lambda args, body: raw)

    def test_missing_pins_and_oversize(self):
        for patch in ({'pin': ''}, {'expected': ''}, {'cipher': b'x' * (keys.LIMIT + 1)}):
            with self.subTest(patch=list(patch)), self.assertRaises(ValueError):
                self.recover(**patch)

    def test_invalid_seal_inputs(self):
        for key, recipient in ((b'short', self.recipient), (self.key, '-bad')):
            with self.assertRaises(ValueError):
                keys.seal(key, recipient, 'identity', self.run)

    def test_output_permissions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'key'
            keys.write_new(path, b'original')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                keys.write_new(path, b'changed')
            link = Path(directory) / 'link'
            os.symlink(path, link)
            with self.assertRaises(FileExistsError):
                keys.write_new(link, b'changed')
            self.assertEqual(path.read_bytes(), b'original')


class KeyVerificationCliTests(unittest.TestCase):
    def invoke(self, directory, failure=None):
        capsule = Path(directory) / 'capsule.age'
        capsule.write_bytes(b'ciphertext')
        argv = ['protection_keys.py', 'verify', '--capsule', str(capsule),
                '--capsule-sha256', 'a' * 64, '--key-fingerprint', 'b' * 64,
                '--identity', 'private-identity']
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.argv', argv), patch('sys.stdout', out), patch('sys.stderr', err), \
                patch.object(keys, 'recover', return_value=b'k' * 32, side_effect=failure) as recover, \
                patch.object(keys, 'write_new') as write:
            status = keys.main()
        write.assert_not_called()
        recover.assert_called_once_with(b'ciphertext', 'private-identity', 'a' * 64, 'b' * 64)
        self.assertEqual(sorted(p.name for p in Path(directory).iterdir()), ['capsule.age'])
        return status, out.getvalue(), err.getvalue()

    def test_verified_capsule_never_writes_or_prints_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            status, out, err = self.invoke(directory)
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out), {'state': 'verified'})
        self.assertEqual(err, '')

    def test_failed_verification_has_no_success_or_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            status, out, err = self.invoke(directory, ValueError('private secret detail'))
        self.assertEqual(status, 1)
        self.assertEqual(out, '')
        self.assertEqual(err, 'RESOLUTE_KEY_ESCROW_FAILED\n')

    def test_verify_rejects_plaintext_output_option(self):
        with patch('sys.argv', ['protection_keys.py', 'verify', '--capsule', 'x',
                              '--capsule-sha256', 'a' * 64, '--key-fingerprint', 'b' * 64,
                              '--identity', 'x', '--output', 'plaintext']), \
                patch('sys.stderr', io.StringIO()), patch.object(keys, 'recover') as recover:
            with self.assertRaises(SystemExit) as stopped:
                keys.main()
        self.assertEqual(stopped.exception.code, 2)
        recover.assert_not_called()


@unittest.skipUnless(os.name == 'posix', 'private POSIX filesystem required')
class LocalPreparationTests(unittest.TestCase):
    def setUp(self):
        self.identity = b'AGE-SECRET-KEY-1' + b'A' * 58 + b'\n'
        self.recipient = b'age1' + b'a' * 58 + b'\n'
        self.generate = lambda args: self.recipient if args else self.identity
        self.run = lambda args, body: b'test:' + body if args[0] == '-r' else body.removeprefix(b'test:')

    def test_preparation_is_private_separate_and_not_remote_acceptance(self):
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / 'new'
            keys.prepare(output, self.generate, self.run)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for item in output.iterdir():
                self.assertEqual(item.stat().st_mode & 0o777, 0o600)
            self.assertEqual({p.name for p in output.iterdir()}, {
                'google-recovery-identity.txt', 'google-integrity-pins.json',
                'evernote-recovery-capsule.age', 'local-preparation.json'})
            receipt = json.loads((output / 'google-integrity-pins.json').read_text())
            marker = json.loads((output / 'local-preparation.json').read_text())
            self.assertEqual(marker, {'state': 'locally-verified', 'remoteCustodyVerified': False, 'activated': False})
            self.assertNotIn('AGE-SECRET', json.dumps(receipt))
            recovered = keys.recover((output / 'evernote-recovery-capsule.age').read_bytes(),
                                     output / 'google-recovery-identity.txt',
                                     receipt['capsuleSha256'], receipt['keyFingerprint'], self.run)
            self.assertEqual(len(recovered), 32)

    def test_existing_directory_and_symlink_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as parent:
            old = Path(parent) / 'old'
            old.mkdir()
            (old / 'keep').write_text('original')
            link = Path(parent) / 'link'
            link.symlink_to(old, target_is_directory=True)
            for output in (old, link):
                with self.assertRaises(FileExistsError):
                    keys.prepare(output, self.generate, self.run)
            self.assertEqual((old / 'keep').read_text(), 'original')

    def test_shared_parent_rejected_before_key_generation(self):
        with tempfile.TemporaryDirectory() as parent:
            os.chmod(parent, 0o755)
            with patch.object(keys, 'secrets') as random, self.assertRaises(ValueError):
                keys.prepare(Path(parent) / 'new', self.generate, self.run)
            random.token_bytes.assert_not_called()

    def test_failed_decryption_removes_partial_identity_and_capsule(self):
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / 'new'
            def failed(args, body):
                if args[0] == '-d':
                    raise ValueError('private subprocess detail')
                return self.run(args, body)
            with self.assertRaises(ValueError):
                keys.prepare(output, self.generate, failed)
            self.assertFalse(output.exists())

    def test_invalid_identity_is_rejected_and_cleaned(self):
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / 'new'
            with self.assertRaises(ValueError):
                keys.prepare(output, lambda args: b'invalid', self.run)
            self.assertFalse(output.exists())

    def test_native_windows_fails_before_creating_anything(self):
        with patch.object(keys.os, 'name', 'nt'), patch.object(keys, 'keygen') as generate:
            with self.assertRaises(ValueError):
                keys.prepare('unused')
        generate.assert_not_called()

    def test_prepare_cli_never_prints_private_values(self):
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.argv', ['keys', 'prepare', '--directory', 'private']), \
                patch('sys.stdout', out), patch('sys.stderr', err), \
                patch.object(keys, 'prepare', side_effect=ValueError('SECRET')):
            self.assertEqual(keys.main(), 1)
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(err.getvalue(), 'RESOLUTE_KEY_ESCROW_FAILED\n')
