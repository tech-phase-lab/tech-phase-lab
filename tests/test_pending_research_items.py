"""Source-only placeholders for reported stories whose checked copy is not ready (owner, Oct 9)."""
from pathlib import Path
import sqlite3
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import general_source_news as general

NOW = datetime(2026, 10, 9, 15, 0, tzinfo=timezone.utc)


def row(**extra):
    base = {'id': 7, 'sha': 's', 'body_sha': 'b', 'source_id': 'x-tipranks', 'url': 'https://x.com/tipranks/status/123',
            'title': 'NVIDIA agrees to acquire Run:ai', 'body': 'NVIDIA $NVDA agrees to acquire Run:ai. https://t.co/x',
            'observed_at': '2026-10-09T14:00:00+00:00', 'published_at': '2026-10-09T13:59:00+00:00',
            'ticker': 'NVDA', 'category': 'acquisition', 'units': []}
    return {**base, **extra}


class PendingItemTests(unittest.TestCase):
    def items(self, rows, jobs=(), reviews=(), published_ids=(), published_urls=()):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE official_research_jobs(event_id INTEGER, sha TEXT, state TEXT, failure_kind TEXT)')
        db.execute('CREATE TABLE general_source_semantic_reviews(event_id INTEGER, sha TEXT, body_sha TEXT, reason TEXT)')
        db.executemany('INSERT INTO official_research_jobs VALUES(?,?,?,?)', jobs)
        db.executemany('INSERT INTO general_source_semantic_reviews VALUES(?,?,?,?)', reviews)
        with mock.patch.object(general, 'candidates', return_value=rows):
            return general.pending_items(db, NOW, set(published_ids), set(published_urls))

    def test_failed_check_shows_fixed_japanese_label_and_the_source_post(self):
        [item] = self.items([row()], jobs=[(7, 's', 'retry', 'unsupported-number')])
        self.assertEqual(item['translationJa'], 'NVDA：買収に関する報道')
        self.assertEqual(item['title'], 'NVIDIA $NVDA agrees to acquire Run:ai.')
        self.assertEqual((item['publisher'], item['tickers'], item['pendingResearch']), ('X · TipRanks', ['NVDA'], 1))
        self.assertNotIn('bodyJa', item)

    def test_vague_or_held_or_published_stories_are_not_shown(self):
        self.assertEqual(self.items([row(category='company-development')]), [])
        self.assertEqual(self.items([row(category=None)]), [])
        self.assertEqual(self.items([row()], jobs=[(7, 's', 'review', 'classified-attempt')]), [])
        self.assertEqual(self.items([row()], reviews=[(7, 's', 'b', 'insufficient-source-evidence')]), [])
        self.assertEqual(self.items([row()], published_ids=[7]), [])
        self.assertEqual(self.items([row()], published_urls=['https://x.com/tipranks/status/123']), [])
        self.assertEqual(self.items([row(url='https://x.com/trendspider/status/123', source_id='x-trendspider')]), [])
        # A check failure moved to review still falls back to the source post.
        self.assertEqual(len(self.items([row()], reviews=[(7, 's', 'b', 'unsubstantiated-model-output')])), 1)

    def test_long_post_is_cut_only_where_no_qualifier_is_dropped(self):
        lead = 'NVIDIA $NVDA agrees to acquire Run:ai for its GPU orchestration software platform. '
        filler = 'The startup builds tools that schedule AI workloads across large clusters of accelerators for enterprises.'
        self.assertEqual(general.pending_title(lead + filler + ' Terms were disclosed in a filing.'), lead.strip() + ' …')
        self.assertIsNone(general.pending_title(lead + filler + ' The deal may not close until regulators approve it.'))
        self.assertIsNone(general.pending_title('x' * 400))


if __name__ == '__main__':
    unittest.main()
