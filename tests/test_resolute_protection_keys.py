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
