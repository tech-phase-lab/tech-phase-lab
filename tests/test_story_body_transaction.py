"""The article HTTP phase must not own SQLite's sole writer slot."""
import sqlite3
import unittest

import test_inline_article_enrichment as fixture
import official_research as research


class StoryBodyTransactionTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.InlineArticleEnrichmentTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)

    def test_primary_bridge_releases_writer_before_article_transport(self):
        observations=[]
        def request(*_):
            with sqlite3.connect(self.case.path,timeout=0) as other:
                try:
                    other.execute('BEGIN IMMEDIATE')
                    other.execute("UPDATE sources SET error='concurrent-worker-progress' WHERE url=?",(fixture.source.URL,))
                    observations.append('writer-progressed')
                except sqlite3.OperationalError as exc:
                    observations.append(str(exc))
            return {'body':fixture.HTML}
        self.assertEqual(research.prepare_story_body(self.case.path,fixture.NOW,request),'ready')
        self.assertEqual(observations,['writer-progressed'])
        with research.connect(self.case.path) as db:
            self.assertEqual(db.execute('SELECT error FROM sources WHERE url=?',(fixture.source.URL,)).fetchone()[0],
                             'concurrent-worker-progress')
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],1)

    def test_revision_change_during_transport_is_stale_and_cannot_save_body(self):
        changes=[]
        def request(*_):
            with sqlite3.connect(self.case.path,timeout=0) as other:
                other.execute('BEGIN IMMEDIATE')
                other.execute("UPDATE sources SET sha256='new-source-revision' WHERE url=?",(fixture.source.URL,))
                changes.append(1)
            return {'body':fixture.HTML}
        self.assertEqual(research.prepare_story_body(self.case.path,fixture.NOW,request),'stale')
        self.assertEqual(changes,[1])
        with research.connect(self.case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_bodies').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],0)


if __name__=='__main__':unittest.main()
