"""Primary bridge bookkeeping cannot lock writers during news projection."""
import sqlite3
from unittest.mock import patch
import unittest

import test_official_research as fixture
import official_research as research
import general_source_news
import signals


class PublicNewsTransactionTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.OfficialResearchTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)
        with sqlite3.connect(self.case.path) as db:
            db.execute('CREATE TABLE concurrent_writer_probe(value INTEGER)')

    def test_new_and_existing_primary_news_release_writer_before_projection(self):
        import service  # Test discovery reloads signals; resolve at execution.
        app=object.__new__(service.AutomaticMonitor);app.db_path=self.case.path
        original=general_source_news.public_items
        observations=[]
        def project(db,reference,**kwargs):
            transaction=db.in_transaction
            with sqlite3.connect(self.case.path,timeout=0) as other:
                try:
                    other.execute('INSERT INTO concurrent_writer_probe VALUES(1)')
                    status='writer-progressed'
                except sqlite3.OperationalError as exc:status=str(exc)
            observations.append((transaction,status))
            return original(db,reference,**kwargs)
        for _ in range(2):
            with patch.object(general_source_news,'public_items',side_effect=project):
                result=app.public_news()
            self.assertEqual(len(result['officialUpdates']),1)
            self.assertEqual(result['officialUpdates'][0]['url'],fixture.URL)
            self.assertEqual(result['officialUpdates'][0]['observedAt'],fixture.NOW.isoformat())
        self.assertEqual(observations,[(False,'writer-progressed')]*2)
        with sqlite3.connect(self.case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM concurrent_writer_probe').fetchone()[0],2)

    def test_read_only_projection_does_not_commit_the_callers_transaction(self):
        with research.connect(self.case.path) as db:
            signals.public_official_updates(db,reference=fixture.NOW)
            db.commit()
            db.execute('INSERT INTO concurrent_writer_probe VALUES(2)')
            self.assertTrue(db.in_transaction)
            signals.public_official_updates(db,reference=fixture.NOW,read_only=True)
            self.assertTrue(db.in_transaction)
            db.rollback()
            self.assertEqual(db.execute('SELECT count(*) FROM concurrent_writer_probe').fetchone()[0],0)


if __name__=='__main__':unittest.main()
