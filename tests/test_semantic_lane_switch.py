"""Posts that fit none of the stated topics are not sent to the model once the lane is off (owner, Oct 10)."""
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import general_source_news as news
import test_actor_grounding as grounding

ACQUISITION = 'Micron $MU to acquire a memory startup for its packaging technology in a deal announced Friday.'
CONTRACT = 'Micron $MU signed a multi-year supply agreement with a major cloud provider for HBM memory.'
OUTLOOK = 'Micron $MU CEO: we expect strong demand for high-bandwidth memory through next year.'
OTHER = 'Micron $MU shares rose on Friday as investors cheered the AI memory outlook for the sector.'
SPEAKER = 'Micron $MU is sending trial memory devices to industrial customers, reporter Dana Vale says.'


class SemanticLaneSwitchTests(unittest.TestCase):
    def test_default_keeps_the_assessment_lane(self):
        self.assertTrue(news.SEMANTIC_ASSESSMENT_ENABLED)
        for body in (OTHER, SPEAKER):
            self.assertEqual(grounding.assessment(body)[1], 'eligible-semantic-assessment')

    def test_off_stops_only_the_open_ended_posts(self):
        with mock.patch.object(news, 'SEMANTIC_ASSESSMENT_ENABLED', False):
            for body in (OTHER, SPEAKER):
                row, reason = grounding.assessment(body)
                self.assertEqual((row, reason), (None, news.SEMANTIC_OFF))
            for body, category in ((ACQUISITION, 'acquisition'), (CONTRACT, 'contract'), (OUTLOOK, 'management-outlook')):
                row, reason = grounding.assessment(body)
                self.assertEqual((reason, row['category']), ('eligible', category))

    def test_service_turns_it_off_at_startup_unless_asked(self):
        source = (Path(__file__).resolve().parents[1] / 'scripts/research/service.py').read_text()
        self.assertIn('general_source_news.SEMANTIC_ASSESSMENT_ENABLED = os.environ.get("RESEARCH_SEMANTIC_NEWS", "") == "1"', source)


if __name__ == '__main__':
    unittest.main()
