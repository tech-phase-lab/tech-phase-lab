import copy
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('resolute_protection', Path(__file__).resolve().parents[1] / 'scripts/resolute/protection.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ProtectionTests(unittest.TestCase):
    def ledger(self):
        return {'version': 1, 'deletions': [{'userId': 'user_test', 'revision': 2, 'at': '2026-10-19T06:00:00.000Z'}], 'suppressions': []}

    def test_strict_validation(self):
        for value in [None, {}, {'version': True, 'deletions': [], 'suppressions': []}]:
            with self.assertRaises(ValueError): p.validate(value)
        for key, value in [('userId', "user_';DROP"), ('revision', True), ('revision', 9007199254740991), ('at', 'yesterday'), ('at', '2026-02-31T06:00:00.000Z')]:
            ledger = self.ledger(); ledger['deletions'][0][key] = value
            with self.assertRaises(ValueError): p.validate(ledger)
        ledger = self.ledger(); ledger['deletions'].append(copy.deepcopy(ledger['deletions'][0]))
        with self.assertRaises(ValueError): p.validate(ledger)
        with self.assertRaises(ValueError): p.load_json(b'{"version":1,"version":1,"deletions":[],"suppressions":[]}')

    def test_encrypted_export_readback_restore_and_no_plaintext_in_bucket(self):
        objects = {}
        class S3:
            def put_object(self, **kw): objects[kw['Key']] = kw['Body']
            def get_object(self, **kw): return {'Body': io.BytesIO(objects[kw['Key']])}
        ledger = self.ledger(); commands = []
        def run(args, **kw):
            commands.append((args, kw))
            if args[0] == 'psql' and '-c' in args: return json.dumps(ledger).encode()
            if args[0] == 'age':
                # Crypto executable double: verifies transport/wiring, not real age.
                out = Path(args[args.index('-o') + 1])
                out.write_bytes(json.dumps(ledger).encode() if '-d' in args else b'encrypted-test-fixture')
            return b''
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); s3 = S3()
            pin = p.export_checkpoint(s3, 'private', root, run, {}, 'age-test')
            self.assertEqual(pin, hashlib.sha256(b'encrypted-test-fixture').hexdigest())
            self.assertFalse(any(b'user_test' in value for value in objects.values()))
            self.assertTrue(all(key.startswith(p.PREFIX) for key in objects))
            result = p.restore_checkpoint(s3, 'private', root, run, {}, root/'identity', pin)
            self.assertEqual(result['state'], 'verified')
            self.assertIn(b'Isolated restore database required', commands[-1][1]['data'])
            objects[p.PREFIX+pin+'.age'] = b'corrupted'
            count = len(commands)
            with self.assertRaisesRegex(RuntimeError, 'checksum'): p.restore_checkpoint(s3, 'private', root, run, {}, root/'identity', pin)
            self.assertEqual(len(commands), count)
            for bad in [None, '', '../latest', 'A'*64]:
                with self.assertRaises(RuntimeError): p.restore_checkpoint(s3, 'private', root, run, {}, root/'identity', bad)

    def test_export_readback_failure_never_returns_a_pin(self):
        class S3:
            def put_object(self, **kw): pass
            def get_object(self, **kw): return {'Body': io.BytesIO(b'wrong')}
        def run(args, **kw):
            if args[0]=='psql': return json.dumps(self.ledger()).encode()
            Path(args[args.index('-o')+1]).write_bytes(b'cipher')
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, 'readback'):
                p.export_checkpoint(S3(), 'private', Path(temp), run, {}, 'age-test')
