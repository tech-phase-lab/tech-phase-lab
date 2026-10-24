"""Held saved copy stays held after acquisition changes only the article body."""
import hashlib
import json
import unittest
from unittest.mock import patch

import test_article_identity_containment as wrong
import test_inline_article_enrichment as inline
import official_research as research
import official_research_editorial_recovery as recovery


class CrossBodyPublicationHoldTests(unittest.TestCase):
    def setUp(self):
        inline.InlineArticleEnrichmentTests.setUp(self)
        with research.connect(self.path) as db:
            event=db.execute('SELECT * FROM signal_events').fetchone()
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (event['id'],event['sha'],hashlib.sha256(inline.BODY.encode()).hexdigest(),
                        inline.BODY,inline.NOW.isoformat(),inline.NOW.timestamp()+900,None))
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (event['id'],event['sha'],hashlib.sha256(wrong.BAD['bodyEn'].encode()).hexdigest(),
                        json.dumps(wrong.wrong_note()),'[]',inline.NOW.isoformat(),inline.NOW.isoformat(),12))
            db.execute('''INSERT INTO official_research_jobs
              (event_id,sha,attempts,next_at,lease,state) VALUES(?,?,?,?,?,?)''',
                       (event['id'],event['sha'],1,inline.NOW.timestamp()+900,'saved-call','done'))
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                       (inline.NOW.timestamp(),'research:'+event['source_id'],event['sha'],
                        'test-model','done','{}','saved-call'))
            self.row=research.candidates(db,inline.NOW)[0]

    def test_reacquired_body_is_publication_held_without_mutating_history(self):
        with research.connect(self.path) as db:
            before=list(db.iterdump())
            self.assertIsNone(research.claim(db,inline.NOW,'no-provider',1000))
            self.assertEqual(research.publication_hold_reason(db,self.row,inline.NOW),'source-event-identity-mismatch')
            state=research.delivery_diagnostics(db,inline.NOW,[self.row],set())
            self.assertEqual((state['tracked'],state['validated'],state['automaticPending'],state['publicationHeld'],state['reviewHeld']),(1,0,0,1,1))
            self.assertEqual(state['publicationHoldReasons'],{'source-event-identity-mismatch':1})
            self.assertEqual(research.validated_publications(db,[self.row]),[])
            item=research.signals.public_official_updates(db,reference=inline.NOW)[0]
            self.assertEqual(item['title'],inline.source.TITLE)
            self.assertNotIn('bodyJa',item)
            self.assertEqual(list(db.iterdump()),before)

    def test_changed_current_source_body_or_status_does_not_authorize_hold(self):
        changes=("UPDATE sources SET sha256='superseded'",
                 "UPDATE sources SET status='held'",
                 "UPDATE sources SET status='rejected'",
                 "UPDATE official_story_bodies SET body_sha='another-body'",
                 "UPDATE official_research_publications SET sha='another-source'")
        with research.connect(self.path) as db:
            for sql in changes:
                with self.subTest(sql=sql):
                    db.execute('SAVEPOINT changed');db.execute(sql)
                    before=list(db.iterdump())
                    self.assertIsNone(research.publication_hold_reason(db,self.row,inline.NOW))
                    self.assertEqual(list(db.iterdump()),before)
                    db.execute('ROLLBACK TO changed');db.execute('RELEASE changed')
            with patch.object(research,'publication_clock_valid',return_value=False):
                self.assertIsNone(research.publication_hold_reason(db,self.row,inline.NOW))

    def test_changed_body_with_compatible_copy_is_not_a_cross_event_hold(self):
        pin=json.loads(recovery.RETAINED_COPY_PATH.read_text())['announcements'][0]
        note=recovery.retained_note(self.row,pin)
        with research.connect(self.path) as db:
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(note),))
            before=list(db.iterdump())
            with patch.object(research,'validate_row',side_effect=AssertionError('full-copy validation on another body')):
                self.assertIsNone(research.publication_hold_reason(db,self.row,inline.NOW))
            self.assertEqual(list(db.iterdump()),before)


if __name__=='__main__':unittest.main()
