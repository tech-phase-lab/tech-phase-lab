"""Dedicated reader capability never grants monitor writes or editor access."""
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import service

TOKEN = 'synthetic-reader-token-for-tests-only-1234'

class ResoluteNewsReaderTests(unittest.TestCase):
    def handler(self, path='/internal/resolute/news', token=TOKEN):
        h = object.__new__(service.Handler)
        h.path = path
        h.headers = {'Authorization': 'Bearer ' + token}
        h.send_json = Mock()
        h.server = SimpleNamespace(app=SimpleNamespace(public_news=Mock(return_value={'ok': True, 'enabled': False, 'items': []})))
        return h

    def test_reader_only_returns_published_feed(self):
        with patch.dict(os.environ, {'RESOLUTE_NEWS_READ_TOKEN': TOKEN, 'RESEARCH_API_TOKEN': 'general', 'RESEARCH_EDITOR_TOKEN': 'editor'}):
            h = self.handler(); h.do_GET()
            h.send_json.assert_called_once_with(200, {'ok': True, 'enabled': False, 'items': []})
            h.app.public_news.assert_called_once_with()
            self.assertFalse(h.authorized()); self.assertFalse(h.editor_authorized())
            for path in ['/saved-research', '/admin/news/review', '/internal/resolute/news']:
                h = self.handler(path); h.do_POST()
                self.assertEqual(h.send_json.call_args.args[0], 403)
                h.app.public_news.assert_not_called()
            h = self.handler('/internal/resolute/news?originalPreview=1'); h.do_GET()
            self.assertEqual(h.send_json.call_args.args[0], 400)
            h.app.public_news.assert_not_called()

    def test_missing_wrong_and_privileged_keys_do_not_open_reader(self):
        for configured, supplied, general in [('', TOKEN, 'general'), (TOKEN, 'wrong', 'general'), (TOKEN, 'general', 'general'), (TOKEN, TOKEN, TOKEN)]:
            with patch.dict(os.environ, {'RESOLUTE_NEWS_READ_TOKEN': configured, 'RESEARCH_API_TOKEN': general}):
                h = self.handler(token=supplied); h.do_GET()
                self.assertEqual(h.send_json.call_args.args[0], 401)
                h.app.public_news.assert_not_called()
        with patch.dict(os.environ, {'RESOLUTE_NEWS_READ_TOKEN': TOKEN, 'RESEARCH_API_TOKEN': ''}):
            self.assertFalse(self.handler().authorized())

    def test_upstream_failure_is_not_a_quiet_day(self):
        with patch.dict(os.environ, {'RESOLUTE_NEWS_READ_TOKEN': TOKEN, 'RESEARCH_API_TOKEN': 'general'}):
            h = self.handler(); h.app.public_news.side_effect = RuntimeError('private detail')
            h.do_GET()
            h.send_json.assert_called_once_with(503, {'ok': False, 'error': 'news-unavailable'})
