import os
import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor


class RequestUserAgent(unittest.TestCase):
    def agent(self, value):
        with mock.patch.dict(os.environ, {'RESEARCH_USER_AGENT': value}):
            return monitor.request_user_agent()

    def test_full_width_space_and_other_non_ascii_never_reach_the_header(self):
        value = self.agent('TechPhaseResearch　research@example.com')
        self.assertEqual(value, 'TechPhaseResearch research@example.com')
        value.encode('latin-1')
        self.assertEqual(self.agent('Tech Phase 日本 research@example.com\n'), 'Tech Phase research@example.com')

    def test_empty_falls_back_to_the_default(self):
        self.assertEqual(self.agent('  　 '), 'TechPhaseResearch-SourceCheck/0.1')

    def test_sec_user_agent_accepts_the_repaired_value_and_still_requires_a_contact(self):
        with mock.patch.dict(os.environ, {'RESEARCH_USER_AGENT': 'TechPhaseResearch　research@example.com'}):
            self.assertEqual(monitor.sec_user_agent(), 'TechPhaseResearch research@example.com')
        with mock.patch.dict(os.environ, {'RESEARCH_USER_AGENT': 'TechPhaseResearch　no contact'}):
            with self.assertRaises(ValueError):
                monitor.sec_user_agent()

    def test_a_request_with_the_repaired_header_builds_without_error(self):
        import http.client
        conn = http.client.HTTPConnection('localhost')
        conn.putrequest('GET', '/')
        conn.putheader('User-Agent', self.agent('A　B research@example.com'))


if __name__ == '__main__':
    unittest.main()
