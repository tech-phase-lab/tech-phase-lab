"""Metadata consumers need current identities, not repeated article copies."""
import json
import unittest
from unittest.mock import patch

import test_official_research as fixture
import official_research as research
import headline_translation
import signals


class NewsMetadataProjectionTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.OfficialResearchTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)

    def cache_body(self,db):
        row=research.candidates(db,fixture.NOW)[0]
        db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                   (row['id'],row['sha'],row['body_sha'],row['body'],row['body_at'],0,None))
        return row

    def test_metadata_matches_default_public_projection_except_article_bodies(self):
        self.assertEqual(self.case.run_note(),'done')
        with research.connect(self.case.path) as db:
            self.cache_body(db)
            full=signals.public_official_updates(db,reference=fixture.NOW)
            self.assertIn('bodyJa',full[0]);self.assertIn('bodyEn',full[0])
            expected=[{k:v for k,v in item.items() if k not in ('bodyJa','bodyEn')} for item in full]
            with patch.object(research,'public_story_body',side_effect=AssertionError('unused body validation')):
                metadata=signals.public_official_updates(db,reference=fixture.NOW,include_bodies=False)
                rows=research.candidates(db,fixture.NOW)
                headline_translation.diagnostics(db,fixture.ENV,now=fixture.NOW.timestamp())
            self.assertEqual(metadata,expected)
            self.assertEqual(rows,research.candidates(db,fixture.NOW,published_updates=full))
            self.assertEqual(signals.public_official_updates(db,reference=fixture.NOW),full)

    def test_headline_counts_and_claim_identity_match_previous_body_enriched_path(self):
        self.assertEqual(self.case.run_note(),'done')
        with research.connect(self.case.path) as db:
            self.cache_body(db)
            original=signals.public_official_updates
            def previous(*args,**kwargs):
                kwargs['include_bodies']=True
                return original(*args,**kwargs)
            with patch.object(signals,'public_official_updates',side_effect=previous):
                before=headline_translation.diagnostics(db,fixture.ENV,now=fixture.NOW.timestamp())
                first=headline_translation.claim(db,signals.SOURCES,200,'mock',fixture.NOW.timestamp())
            self.assertIsNotNone(first)
            db.execute('DELETE FROM signal_headline_translation_jobs')
            db.execute("DELETE FROM signal_headline_translation_calls WHERE source_id NOT LIKE 'research:%'")
            db.commit()
            with patch.object(research,'public_story_body',side_effect=AssertionError('unused body validation')):
                after=headline_translation.diagnostics(db,fixture.ENV,now=fixture.NOW.timestamp())
                second=headline_translation.claim(db,signals.SOURCES,200,'mock',fixture.NOW.timestamp())
            self.assertEqual(before,after)
            self.assertEqual(dict(first[0]),dict(second[0]))

    def test_saved_invalid_body_stays_held_after_metadata_candidate_selection(self):
        transport=self.case.comparison_fixture('既知より50％多い排出を検出。')
        with patch.object(research.factual_validation,'validate_comparison_baselines'):
            self.assertEqual(self.case.run_note(transport),'done')
        with research.connect(self.case.path) as db:
            row=self.cache_body(db)
            with patch.object(research,'public_story_body',side_effect=AssertionError('candidate must use metadata')):
                rows=research.candidates(db,fixture.NOW)
                self.assertEqual([r['id'] for r in rows],[row['id']])
                self.assertEqual(research.validated_publications(db,rows),[])
                self.assertEqual(research.publication_hold_reason(db,row,fixture.NOW),'unsupported-comparison-baseline')
                calls=[tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')]
                self.assertIsNone(research.claim(db,fixture.NOW,fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],200))
                self.assertEqual(calls,[tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')])
            item=signals.public_official_updates(db,reference=fixture.NOW)[0]
            self.assertNotIn('bodyJa',item);self.assertNotIn('bodyEn',item)
            db.execute("UPDATE sources SET sha256='superseded'")
            self.assertEqual(signals.public_official_updates(db,reference=fixture.NOW,include_bodies=False),[])


if __name__=='__main__':unittest.main()
