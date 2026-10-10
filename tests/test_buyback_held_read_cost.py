"""Terminal review can avoid decoration without changing duplicate admission."""
import json
import unittest
from unittest.mock import patch

import test_buyback_context as fixture
import buyback_recap
import general_source_news as news
import official_research as research
import signals


class HeldBuybackReadTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.BuybackContextTests();self.case.setUp();self.addCleanup(self.case.doCleanups)

    def held_row(self,body=fixture.RAW['body']):
        self.case.seed(body)
        with research.connect(self.case.path) as db:
            with patch.object(buyback_recap,'published_context',return_value=[]):
                row=news.candidates(db,fixture.NOW)[0]
            news.save_semantic_review(db,row,'fixture-held','2026-10-04T03:00:00Z',
                                     '2026-10-04T03:01:00Z','unsubstantiated-model-output')
        return row

    def test_public_candidates_skip_only_unused_context_and_preserve_review_projection(self):
        self.held_row()
        with research.connect(self.case.path) as db:
            before=db.total_changes
            db.execute('PRAGMA query_only=ON')
            with patch.object(buyback_recap,'published_context',side_effect=AssertionError('unused context')):
                self.assertEqual(news.candidates(db,fixture.NOW),[])
                self.assertEqual(news.public_items(db,fixture.NOW),[])
            with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]) as context:
                reviewed=news.candidates(db,fixture.NOW,include_review=True)
                self.assertEqual(len(reviewed),1)
                self.assertEqual(reviewed[0]['related_authorizations'][0]['id'],'1101')
                self.assertEqual(list(news.assessments(db,fixture.NOW))[0][1],reviewed[0])
                self.assertEqual(context.call_count,2)
            self.assertEqual(db.total_changes,before);self.assertFalse(db.in_transaction)

    def test_held_representative_still_prevents_duplicate_promotion(self):
        first=self.held_row()
        grouped=next(source for source in signals.SOURCES if source['id']=='x-wallstengine')
        self.case.seed(url='https://x.com/TipRanks/status/2106523440635363386',account_source=grouped)
        with research.connect(self.case.path) as db:
            with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]):
                self.assertEqual(news.candidates(db,fixture.NOW),[])
                self.assertEqual(news.public_items(db,fixture.NOW),[])
                rows=news.candidates(db,fixture.NOW,include_review=True)
                self.assertEqual([row['id'] for row in rows],[first['id']])

    def test_later_held_duplicate_does_not_remove_unheld_representative(self):
        self.case.seed()
        grouped=next(source for source in signals.SOURCES if source['id']=='x-wallstengine')
        self.case.seed(url='https://x.com/TipRanks/status/2106523440635363386',account_source=grouped)
        with research.connect(self.case.path) as db:
            with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]):
                all_rows=[row for _,row,_ in news.assessments(db,fixture.NOW)]
                first,later=all_rows
                news.save_semantic_review(db,later,'later-held','2026-10-04T03:00:00Z',
                                         '2026-10-04T03:01:00Z','unsubstantiated-model-output')
                rows=news.candidates(db,fixture.NOW)
                self.assertEqual([row['id'] for row in rows],[first['id']])
                self.assertEqual(rows[0]['related_authorizations'][0]['id'],'1101')

    def test_reviewed_recovery_restores_full_context_without_promoting_unresolved_copy(self):
        import micron_reviewed_recovery
        row=self.held_row()
        note,_=news.bind_assessment({'disposition':'publish','reason':'material-company-development',
                                    'facts':[fixture.FACT,fixture.AUTH]},row)
        with research.connect(self.case.path) as db:
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],row['body_sha'],json.dumps(note),'[]',
                        '2026-10-04T03:01:00Z','2026-10-04T03:01:30Z',1000))
            # A valid saved body alone must never override a terminal review.
            with patch.object(buyback_recap,'published_context',side_effect=AssertionError('unresolved review')):
                self.assertEqual(news.public_items(db,fixture.NOW),[])
            with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]) as context:
                db.execute('SAVEPOINT without_review')
                db.execute('DELETE FROM general_source_semantic_reviews')
                expected=news.public_items(db,fixture.NOW)
                db.execute('ROLLBACK TO without_review');db.execute('RELEASE without_review')
                context.reset_mock()
                # Existing reviewed-recovery resolution remains authoritative;
                # this mock simulates its verified approval, not a live bypass.
                with patch.object(micron_reviewed_recovery,'resolves',return_value=True):
                    actual=news.public_items(db,fixture.NOW)
                self.assertEqual(actual,expected);self.assertEqual(len(actual),1)
                self.assertNotIn('$150B',actual[0]['bodyEn'])
                self.assertIn('2026-09-28',actual[0]['bodyEn'])
                context.assert_called_once_with(db,fixture.NOW)

    def test_missing_stale_or_future_hold_never_skips_current_relation_checks(self):
        self.held_row()
        for field,value in (('sha','superseded'),('body_sha','different-body'),
                            ('policy_version',-1),('decided_at','2026-10-05T03:01:00Z')):
            with self.subTest(field=field),research.connect(self.case.path) as db:
                saved=db.execute('SELECT '+field+' FROM general_source_semantic_reviews').fetchone()[0]
                db.execute('UPDATE general_source_semantic_reviews SET '+field+'=?',(value,))
                with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]) as context:
                    rows=news.candidates(db,fixture.NOW)
                    self.assertEqual(len(rows),1)
                    self.assertEqual(rows[0]['related_authorizations'][0]['id'],'1101')
                    context.assert_called_once_with(db,fixture.NOW)
                db.execute('UPDATE general_source_semantic_reviews SET '+field+'=?',(saved,))

    def test_authorization_only_review_keeps_covered_suppression(self):
        self.held_row('NVIDIA $NVDA authorized another $150B in share repurchases last quarter, with $235B of remaining authorization.')
        with research.connect(self.case.path) as db:
            with patch.object(buyback_recap,'published_context',return_value=[fixture.OFFICIAL]) as context:
                self.assertEqual(news.candidates(db,fixture.NOW),[])
                context.assert_called_once_with(db,fixture.NOW)
                record=list(news.assessments(db,fixture.NOW))[0]
                self.assertIsNone(record[1]);self.assertEqual(record[2],'covered-buyback-authorization')


if __name__=='__main__':unittest.main()
