import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

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
