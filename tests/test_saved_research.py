import copy
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import saved_research as saved

class SavedResearchTests(unittest.TestCase):
    def document(self):
        return {'saved': ['article'], 'notebooks': {'article:ja': [{'id': 'note', 'kind': 'note', 'color': 'blue', 'note': '私のメモ', 'parts': [{'block': '0:2:hash', 'start': 0, 'end': 2, 'quote': '😀'}]}]}}
    def test_private_durable_roundtrip_and_compare_and_swap(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'saved.sqlite')
            with saved.connect(path) as db:
                self.assertEqual(saved.save(db, 'a'*64, 0, self.document())['revision'], 1)
                self.assertEqual(saved.read(db, 'b'*64)['document']['saved'], [])
            with saved.connect(path) as db:
                self.assertEqual(saved.read(db, 'a'*64)['document'], self.document())
                empty = {'saved': [], 'notebooks': {}}
                self.assertTrue(saved.save(db, 'a'*64, 0, empty)['conflict'])
                self.assertEqual(saved.read(db, 'a'*64)['document'], self.document())
                self.assertEqual(saved.save(db, 'a'*64, 1, empty)['revision'], 2)
    def test_validation_and_unicode_offsets(self):
        self.assertEqual(saved.validate(self.document()), self.document())
        bad = copy.deepcopy(self.document()); bad['notebooks']['article:ja'][0]['parts'][0]['end'] = 1
        for value in [None, {}, bad, {**self.document(), 'saved': ['a','a']}, {**self.document(), 'notebooks': {'bad-key': []}}]:
            with self.subTest(value=value), self.assertRaises(ValueError): saved.validate(value)
        with self.assertRaises(ValueError): saved.owner_key('wrong')
        with saved.connect(':memory:') as db:
            for revision in [True, -1, 0.5]:
                with self.assertRaises(ValueError): saved.save(db, 'a'*64, revision, self.document())

    def test_http_auth_private_routing_and_large_notebook(self):
        import json
        import os
        import threading
        from types import SimpleNamespace
        from unittest.mock import patch
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        import service
        with tempfile.TemporaryDirectory() as folder:
            server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
            server.app = SimpleNamespace(db_path=str(Path(folder) / 'saved.sqlite'))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            url = f'http://127.0.0.1:{server.server_port}/saved-research'
            def call(body=None, token='private-test-token', owner='a'*64):
                return urlopen(Request(url, data=json.dumps(body).encode() if body else None, headers={'Authorization': f'Bearer {token}', 'X-Saved-Research-Owner': owner, 'Content-Type': 'application/json'}), timeout=3)
            try:
                with patch.dict(os.environ, {'RESEARCH_API_TOKEN': ''}):
                    with self.assertRaises(HTTPError) as failure: call()
                    self.assertEqual(failure.exception.code, 401)
                with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'private-test-token'}):
                    with self.assertRaises(HTTPError) as failure: call(token='wrong')
                    self.assertEqual(failure.exception.code, 401)
                    document = self.document()
                    original = document['notebooks']['article:ja'][0]
                    document['notebooks']['article:ja'] = [{**original, 'id': str(i), 'note': 'あ'*500} for i in range(100)]
                    with call({'revision': 0, 'document': document}) as response:
                        self.assertEqual(json.loads(response.read())['revision'], 1)
                    with call(owner='b'*64) as response:
                        self.assertEqual(json.loads(response.read())['revision'], 0)
                    with call() as response:
                        self.assertEqual(json.loads(response.read())['document'], document)
                    with self.assertRaises(HTTPError) as failure: call({'revision': 0, 'document': self.document()})
                    self.assertEqual(failure.exception.code, 409)
            finally:
                server.shutdown(); server.server_close(); thread.join()
