import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor


class ResearchUserAgent(unittest.TestCase):
    """A full-width space in RESEARCH_USER_AGENT stopped every request for a day (Nov 13-14); the header is now always sendable."""

    def test_full_width_characters_become_ascii_and_the_header_encodes(self):
        with patch.dict(os.environ, {'RESEARCH_USER_AGENT': 'TechPhase　Research ｃｏｎｔａｃｔ＠example.com　'}):
            value = monitor.research_user_agent()
            self.assertEqual(value, 'TechPhase Research contact@example.com')
            value.encode('latin-1')
            self.assertEqual(monitor.sec_user_agent(), value)
            self.assertTrue(monitor.research_user_agent_normalized())
            self.assertTrue(monitor.SEC_ACCESS.state()['userAgentNormalized'])

    def test_other_non_ascii_is_dropped_and_a_clean_value_is_unchanged(self):
        with patch.dict(os.environ, {'RESEARCH_USER_AGENT': 'Tech Phase 運営 research@example.com'}):
            self.assertEqual(monitor.research_user_agent(), 'Tech Phase research@example.com')
        with patch.dict(os.environ, {'RESEARCH_USER_AGENT': 'TechPhase research@example.com'}):
            self.assertEqual(monitor.research_user_agent(), 'TechPhase research@example.com')
            self.assertFalse(monitor.research_user_agent_normalized())

    def test_empty_value_uses_the_default(self):
        with patch.dict(os.environ, {'RESEARCH_USER_AGENT': '　'}):
            self.assertEqual(monitor.research_user_agent('Default/1'), 'Default/1')


if __name__ == '__main__':
    unittest.main()
