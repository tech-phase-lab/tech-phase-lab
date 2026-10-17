"""Mixed-news read parity, per-request policy proof, and no writer-lock render."""
from copy import deepcopy
from datetime import timedelta
import sqlite3
import unittest
from unittest.mock import patch
import test_macro_read_cost as fixture
import test_attributed_policy_publication as policy_fixture
import attributed_policy_publication as policy
import financing_policy_source as grammar
news, research, NOW = fixture.news, fixture.research, fixture.NOW


class PolicyReadCostTests(unittest.TestCase):
    def setUp(self):
        self.mixed=fixture.MixedMacroFixture();self.addCleanup(self.mixed.close)
        self.mixed.recover()
        self.row=self.mixed.case.hold(policy_fixture.BODY,number=903)

    def recover(self):
        with research.connect(self.mixed.path) as db:
            self.assertEqual(policy.publish_held(db,NOW,clock=lambda:NOW),'done')

    def test_current_other_stories_source_clocks_and_header_lower_copy_unchanged(self):
        with fixture.open_read(self.mixed.path) as db:
            before=fixture.public_pieces(db);clocks=fixture.clocks(db)
            raw=[tuple(r) for r in db.execute('SELECT * FROM signal_x_acquisition ORDER BY url')]
        self.recover()
        with fixture.open_read(self.mixed.path) as db:
            after=fixture.public_pieces(db)
            self.assertEqual(db.total_changes,0)
            self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM signal_x_acquisition ORDER BY url')],raw)
            self.assertEqual([r for r in fixture.clocks(db) if r[0]!=self.row['id']],[r for r in clocks if r[0]!=self.row['id']])
        self.assertEqual([item for item in after['officialUpdates'] if item['id']!=str(self.row['id'])],before['officialUpdates'])
        for key in ('resultBriefs','analystUpdates','marketUpdates','officialResearch'):
            self.assertEqual(after[key],before[key])

    def test_one_selection_and_one_policy_proof_per_request_no_nested_scan(self):
        self.recover()
        for read in (fixture.read_official,fixture.public_pieces):
            with fixture.open_read(self.mixed.path) as db, \
                 patch.object(news,'candidates',wraps=news.candidates) as candidates, \
                 patch.object(policy,'current_row',side_effect=AssertionError('nested candidate scan')), \
                 patch.object(policy,'closed_proof',wraps=policy.closed_proof) as proofs, \
                 patch.object(policy,'source_snapshot',wraps=policy.source_snapshot) as snapshots, \
                 patch.object(policy,'ownership_state',wraps=policy.ownership_state) as owners, \
                 patch.object(grammar,'parse',wraps=grammar.parse) as parses:
                statements=[];db.set_trace_callback(statements.append);read(db)
                self.assertEqual(candidates.call_count,1);self.assertEqual(proofs.call_count,1)
                self.assertEqual(snapshots.call_count,1);self.assertEqual(owners.call_count,1)
                self.assertLessEqual(parses.call_count,8)
                self.assertEqual(db.total_changes,0)
                # Existing other feed lanes issue harmless IF NOT EXISTS on
                # already-present tables. The new policy reader issues none.
                self.assertFalse(any(sql.lstrip().upper().startswith('CREATE') and 'source_policy_' in sql for sql in statements))
                self.assertFalse(any(sql.lstrip().upper().startswith(('INSERT','UPDATE','DELETE','REPLACE','ALTER')) for sql in statements))

    def test_next_same_connection_request_sees_withdrawal_then_restore(self):
        self.recover()
        with fixture.open_read(self.mixed.path) as db:
            before=fixture.read_official(db)
            with sqlite3.connect(self.mixed.path) as writer:
                writer.execute("UPDATE official_research_attempt_failures SET detail='changed' WHERE event_id=?",(self.row['id'],))
            self.assertEqual(fixture.read_official(db),[item for item in before if item['id']!=str(self.row['id'])])
            with sqlite3.connect(self.mixed.path) as writer:
                writer.execute("UPDATE official_research_attempt_failures SET detail='' WHERE event_id=?",(self.row['id'],))
            self.assertEqual(fixture.read_official(db),before);self.assertEqual(db.total_changes,0)

    def test_query_only_upgrade_without_policy_tables_leaves_other_lanes_identical(self):
        with fixture.open_read(self.mixed.path) as db:before=fixture.public_pieces(db)
        with sqlite3.connect(self.mixed.path) as db:
            for table in (policy.AUDIT_TABLE,policy.ROUTE_TABLE,'source_policy_assessment_proofs'):db.execute('DROP TABLE '+table)
        with fixture.open_read(self.mixed.path) as db:
            self.assertEqual(fixture.public_pieces(db),before);self.assertEqual(db.total_changes,0)
