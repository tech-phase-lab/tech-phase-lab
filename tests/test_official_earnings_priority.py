"""Owner, Oct 11: an earnings release is retried within minutes, not hours."""
import json
import unittest

import test_official_research as base
from test_official_research import NOTE, QUOTES, copy, research

EARNINGS_TITLE = 'Nebius Reports Third Quarter 2026 Financial Results'


def reply(note):
    return lambda *_: {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps(note, ensure_ascii=False)}]}]}


class EarningsPriorityTests(unittest.TestCase):
    setUp = base.OfficialResearchTests.setUp
    run_note = base.OfficialResearchTests.run_note

    def failing(self):
        note = json.loads(json.dumps(NOTE))
        note['title'] = copy('Inferizeを5億ドルで買収', 'Nebius buys Inferize for $500 million', QUOTES[0])
        return reply(note)

    def retry_wait(self, title):
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET title=?', (title,))
            db.execute('UPDATE signal_events SET title=?', (title,))
        self.assertEqual(self.run_note(), 'done')  # creates the job
        with research.connect(self.path) as db:
            db.execute("UPDATE official_research_jobs SET state='retry',attempts=3,next_at=0")
            db.execute('DELETE FROM official_research_publications')
        self.assertEqual(self.run_note(self.failing()), 'retry')
        with research.connect(self.path) as db:
            return db.execute('SELECT next_at FROM official_research_jobs').fetchone()[0] - base.NOW.timestamp()

    def test_a_rejected_earnings_note_is_retried_within_ten_minutes(self):
        self.assertLessEqual(self.retry_wait(EARNINGS_TITLE), research.EARNINGS_RETRY_SECONDS)

    def test_other_news_keeps_the_ordinary_schedule(self):
        self.assertGreater(self.retry_wait(base.TITLE), research.EARNINGS_RETRY_SECONDS)

    def test_only_a_companys_own_results_release_counts(self):
        self.assertTrue(research.earnings_release({'source_id': 'primary-ir-NBIS', 'title': EARNINGS_TITLE}))
        self.assertFalse(research.earnings_release({'source_id': 'primary-ir-NBIS', 'title': 'Nebius to Report Third Quarter Results on Nov 5'}))
        self.assertFalse(research.earnings_release({'source_id': 'nebius-blog', 'title': EARNINGS_TITLE}))
        self.assertFalse(research.earnings_release({'source_id': 'primary-ir-NBIS', 'title': base.TITLE}))


if __name__ == '__main__':
    unittest.main()
