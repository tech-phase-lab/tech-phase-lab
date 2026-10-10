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

    def test_primary_feed_matches_full_projection_without_reported_candidate_scans(self):
        self.assertEqual(self.case.run_note(),'done')
        with research.connect(self.case.path) as db:
            self.cache_body(db)
            published=signals.public_official_updates(db,reference=fixture.NOW,limit=500)
            rows=research.candidates(db,fixture.NOW,published_updates=published)
            expected=research.primary_publication_items(research.validated_publications(db,rows))[:20]
            self.assertEqual(len(expected),1)
            before=db.total_changes
            with patch.object(research.general_source_news,'candidates',side_effect=AssertionError('duplicate reported scan')),patch.object(research.issuer_business_news,'candidates',side_effect=AssertionError('duplicate issuer report scan')):
                self.assertEqual(research.feed(db,fixture.NOW,published_updates=published),expected)
                # Reusing the outer headlines still cannot bypass withdrawal.
                db.execute("UPDATE official_research_publications SET body_sha='withdrawn'")
                self.assertEqual(research.feed(db,fixture.NOW,published_updates=published),[])
            self.assertEqual(db.total_changes,before+1)

    def test_primary_feed_retains_cached_body_fallback(self):
        self.assertEqual(self.case.run_note(),'done')
        with research.connect(self.case.path) as db:
            self.cache_body(db)
            published=signals.public_official_updates(db,reference=fixture.NOW,limit=500)
            # A short discovery excerpt can still have a verified full article.
            db.execute("UPDATE source_revisions SET extracted_text='Short source excerpt.',extracted_chars=21")
            all_rows=research.candidates(db,fixture.NOW,published_updates=published)
            primary=research.candidates(db,fixture.NOW,published_updates=published,primary_only=True)
            self.assertEqual(primary,all_rows)
            self.assertEqual(len(primary),1);self.assertTrue(primary[0]['body_cached'])
            self.assertEqual(research.feed(db,fixture.NOW,published_updates=published),
                             research.primary_publication_items(research.validated_publications(db,all_rows))[:20])
            self.assertEqual(len(research.feed(db,fixture.NOW,published_updates=published)),1)

    def test_default_candidates_keep_both_reported_admission_paths(self):
        with research.connect(self.case.path) as db:
            general={'id':987,'general_source':True}
            issuer={'id':988,'issuer_business':True}
            with patch.object(research.general_source_news,'candidates',return_value=[general]) as first,patch.object(research.issuer_business_news,'candidates',return_value=[issuer]) as second:
                rows=research.candidates(db,fixture.NOW,published_updates=[])
            self.assertEqual(rows[-2:],[general,issuer])
            first.assert_called_once_with(db,fixture.NOW);second.assert_called_once_with(db,fixture.NOW)


if __name__=='__main__':unittest.main()
