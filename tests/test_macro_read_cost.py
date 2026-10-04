"""Offline mixed-fixture public read parity and bounded cost measurements.

All sources, assessments, and clocks are synthetic. The optional measurement
entry point records work rather than claiming production or live-source cost.
"""
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import statistics
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import general_source_news as news
import macro_source_news as parser
import macro_source_publication as macro
import official_research as research
import signals
# Keep this early test import from binding the suite's canonical service to
# an obsolete signals object when test_research_service replaces sys.modules.
# This is the real service code in an isolated, coherent module graph.
service_spec = importlib.util.spec_from_file_location(
    'macro_read_cost_service', Path(__file__).resolve().parents[1] / 'scripts/research/service.py')
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)
import test_macro_source_publication as macro_fixture
import test_retained_business_admission as retained_fixture
import test_source_news_admission as source_fixture
from test_general_semantic_assessment import result
from test_official_research import BODY, NOTE, TITLE

NOW = retained_fixture.NOW
ORDINARY_NAMES = ('Orion Labs', 'Nova Labs', 'Atlas Labs', 'Comet Labs')
TRACKED = (
    (news, 'candidates'), (news, 'assessments'), (news, 'evidence_rows'),
    (macro, 'publication_valid'), (macro, 'current_row'),
    (macro, 'source_snapshot'), (macro, 'ownership_state'),
    (macro, 'artifacts'), (macro, 'closed_proof'),
    (parser, 'parse'), (parser, 'derive'),
)


@contextmanager
def open_read(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    try:
        yield db
    finally:
        db.close()


def public_pieces(db):
    """The service's real read components, with bridge writes explicitly off."""
    official = signals.public_official_updates(db, reference=NOW, limit=500, read_only=True)
    return service.news_history.bounded({
        **service.news_drafts.public_feed(db),
        **research.news_projection(db, NOW, official),
        'marketUpdates': service.x_market_news.public_feed(db, now=NOW),
        'analystUpdates': service.analyst_news.public_feed(db, now=NOW),
        'resultBriefs': service.market_results.public_feed(db, reference=NOW),
    })


def read_official(db):
    return signals.public_official_updates(db, reference=NOW, limit=500, read_only=True)


def clocks(db):
    return [tuple(row) for row in db.execute('''SELECT e.id,e.source_id,e.url,e.sha,
        e.published_at,e.observed_at,p.started_at,p.public_at,p.generation_ms
        FROM signal_events e LEFT JOIN official_research_publications p ON p.event_id=e.id
        ORDER BY e.id''')]


def content_hash(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


class MixedMacroFixture:
    def __init__(self, ordinary_names=ORDINARY_NAMES):
        self.case = macro_fixture.MacroPublicationTests()
        self.case.setUp()
        self.path = self.case.path
        self.macro_ids = set()
        try:
            for index, name in enumerate(ordinary_names):
                self.case.raw(source_fixture.UNTRACKED.replace('Orion Labs', name), number=800 + index)
                copy = {key: value.replace('Orion Labs', name) if key in ('en', 'ja') else value
                        for key, value in source_fixture.COPY.items()}
                status = self.case.run_once(lambda *_, copy=copy: result(facts=[copy]))
                assert status == 'done', (index, name, status)
            for number, body in ((901, macro_fixture.JOBS), (902, macro_fixture.CPI)):
                self.macro_ids.add(str(self.case.hold(body, number)['id']))
            with research.connect(self.path) as db:
                stamp = (NOW - timedelta(hours=2)).isoformat()
                url = 'https://nebius.com/newsroom/synthetic-read-cost-acquisition'
                db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256,source_mode)
                    VALUES(?,?,?,?,?,?,?)''', (url, 'NBIS', TITLE, NOW.date().isoformat(), stamp, 'synthetic-read-cost', 'inline'))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (url, 'NBIS', stamp))
                db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
                    VALUES(?,?,?,?,?)''', (url, 'synthetic-read-cost', stamp, BODY, len(BODY)))
                rows = research.candidates(db, NOW, primary_only=True)
                assert len(rows) == 1
                row = rows[0]
                public = (NOW - timedelta(minutes=1)).isoformat()
                db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                           (row['id'], row['sha'], row['body_sha'], json.dumps(NOTE), '[]', public, public, 1))
            # Finish normal schema/bridge lifecycle before measured reads.
            app = object.__new__(service.AutomaticMonitor)
            app.db_path = self.path
            with patch.object(service, 'datetime', wraps=datetime) as clock:
                clock.now.return_value = NOW
                app.public_news()
        except BaseException:
            self.close()
            raise

    def recover(self):
        assert self.case.recover() == 'done'
        assert self.case.recover() == 'done'
        assert self.case.recover() is None

    def close(self):
        self.case.doCleanups()


class MacroReadCostTests(unittest.TestCase):
    def setUp(self):
        for name in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(name, side_effect=AssertionError('network forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        self.fixture = MixedMacroFixture()
        self.addCleanup(self.fixture.close)

    def test_mixed_public_reads_change_only_the_two_audited_macro_rows(self):
        with open_read(self.fixture.path) as db:
            before_changes = db.total_changes
            before = public_pieces(db)
            before_clocks = clocks(db)
            before_source = [tuple(row) for row in db.execute('SELECT * FROM signal_x_acquisition ORDER BY url')]
            self.assertEqual(db.total_changes, before_changes)
        self.assertEqual(len(before['officialUpdates']), 5)
        self.fixture.recover()
        with open_read(self.fixture.path) as db:
            before_changes = db.total_changes
            after = public_pieces(db)
            after_clocks = clocks(db)
            self.assertEqual([tuple(row) for row in db.execute('SELECT * FROM signal_x_acquisition ORDER BY url')], before_source)
            self.assertEqual(db.total_changes, before_changes)
            self.assertEqual([item for item in read_official(db) if item.get('generalSource') == news.VERSION],
                             [item for item in after['officialUpdates'] if item.get('generalSource') == news.VERSION])
            self.assertEqual(public_pieces(db), after)
        ids = self.fixture.macro_ids
        added = [item for item in after['officialUpdates'] if item['id'] in ids]
        self.assertEqual(len(added), 2)
        self.assertEqual(len(after['officialUpdates']), 7)
        self.assertEqual([item for item in after['officialUpdates'] if item['id'] not in ids], before['officialUpdates'])
        for item in added:
            self.assertEqual(item['publishedAt'], retained_fixture.PUBLISHED)
            self.assertEqual(item['observedAt'], retained_fixture.FIRST)
            self.assertEqual(item['tickers'], [])
            self.assertTrue(item['bodyJa'] and item['bodyEn'])
        stripped = deepcopy(after)
        stripped['officialUpdates'] = [item for item in stripped['officialUpdates'] if item['id'] not in ids]
        stripped['officialHistory'] = {**stripped['officialHistory'], 'sourceEligible': 5, 'returned': 5}
        self.assertEqual(stripped, before)
        self.assertEqual([row for row in after_clocks if str(row[0]) not in ids],
                         [row for row in before_clocks if str(row[0]) not in ids])
        for row in after_clocks:
            if str(row[0]) in ids:
                self.assertEqual(row[4:6], (retained_fixture.PUBLISHED, retained_fixture.FIRST))
                self.assertEqual(row[6:8], (NOW.isoformat(), NOW.isoformat()))

    def test_service_test_module_is_isolated_from_canonical_imports(self):
        self.assertIsNot(service, sys.modules.get('service'))
        self.assertIs(service.signals, signals)
        self.assertIs(service.official_research, research)

    def test_query_only_upgrade_without_macro_tables_preserves_other_news(self):
        with open_read(self.fixture.path) as db:
            before = public_pieces(db)
        with sqlite3.connect(self.fixture.path) as db:
            db.execute('DROP TABLE source_macro_news_derivations')
            db.execute('DROP TABLE source_macro_assessment_proofs')
        with open_read(self.fixture.path) as db:
            initial = db.total_changes
            self.assertEqual(public_pieces(db), before)
            self.assertEqual(db.total_changes, initial)
            self.assertFalse(macro.exists(db, macro.AUDIT_TABLE))
            self.assertFalse(macro.exists(db, 'source_macro_assessment_proofs'))
        # Normal worker initialization supplies both tables before a write.
        with research.connect(self.fixture.path) as db:
            self.assertTrue(macro.exists(db, macro.AUDIT_TABLE))
            self.assertTrue(macro.exists(db, 'source_macro_assessment_proofs'))

    def test_public_macro_diagnostics_expose_only_aggregate_ownership(self):
        with open_read(self.fixture.path) as db:
            detail = macro.diagnostics(db, NOW)
            summary = news.diagnostics(db, NOW)['macroPublication']
        self.assertEqual(len(detail['records']), 2)
        self.assertEqual(summary['measured'], 2)
        self.assertEqual(sum(summary['ownershipReasons'].values()), 2)
        self.assertEqual(set(summary), {'readOnly', 'scope', 'publicResultLimit',
                         'browserDeliveryVerified', 'ownershipReasons', 'measured', 'truncated'})
        serialized = json.dumps(summary)
        for private in ('eventId', 'marketRecords', 'records', 'https://', 'source',
                        'Model wording', 'nonfarm', 'Wall St'):
            self.assertNotIn(private, serialized)

    def test_query_only_public_path_performs_no_data_mutations(self):
        self.fixture.recover()
        with open_read(self.fixture.path) as db:
            initial = db.total_changes
            for read in (read_official, public_pieces):
                self.assertTrue(read(db))
                self.assertEqual(db.total_changes, initial)
            self.assertEqual(db.execute('PRAGMA query_only').fetchone()[0], 1)


    def test_public_read_has_one_candidate_pass_and_one_proof_per_macro(self):
        self.fixture.recover()
        with open_read(self.fixture.path) as db:
            for read in (read_official, public_pieces):
                with patch.object(news, 'candidates', wraps=news.candidates) as candidates, \
                     patch.object(macro, 'current_row', side_effect=AssertionError('repeated full selection')), \
                     patch.object(macro, 'closed_proof', wraps=macro.closed_proof) as proofs, \
                     patch.object(macro, 'source_snapshot', wraps=macro.source_snapshot) as snapshots, \
                     patch.object(macro, 'ownership_state', wraps=macro.ownership_state) as ownership, \
                     patch.object(parser, 'parse', wraps=parser.parse) as reparses:
                    read(db)
                self.assertEqual(candidates.call_count, 1)
                self.assertEqual(proofs.call_count, 2)
                self.assertEqual(snapshots.call_count, 2)
                self.assertEqual(ownership.call_count, 2)
                self.assertLessEqual(reparses.call_count, 10)

    def test_next_request_on_same_read_connection_sees_withdrawal_and_restoration(self):
        self.fixture.recover()
        target = min(self.fixture.macro_ids)
        with open_read(self.fixture.path) as db:
            before = read_official(db)
            with sqlite3.connect(self.fixture.path) as writer:
                old = writer.execute('SELECT detail FROM official_research_attempt_failures WHERE event_id=?', (target,)).fetchone()[0]
                writer.execute('UPDATE official_research_attempt_failures SET detail=? WHERE event_id=?', ('changed synthetic proof', target))
            after = read_official(db)
            self.assertEqual(after, [item for item in before if item['id'] != target])
            with sqlite3.connect(self.fixture.path) as writer:
                writer.execute('UPDATE official_research_attempt_failures SET detail=? WHERE event_id=?', (old, target))
            self.assertEqual(read_official(db), before)
            self.assertEqual(db.total_changes, 0)

    def test_request_withdraws_all_macro_rows_if_proof_changes_after_validation(self):
        self.fixture.recover()
        original = macro.publication_valid
        for concurrent in (False, True):
            with self.subTest(concurrent=concurrent), sqlite3.connect(self.fixture.path) as db:
                db.row_factory = sqlite3.Row
                before = read_official(db)
                changed = []
                def invalidate(*args, **kwargs):
                    valid = original(*args, **kwargs)
                    if valid and not changed:
                        row = args[1]
                        target = row['id']
                        changed.append(target)
                        if concurrent:
                            with sqlite3.connect(self.fixture.path) as writer:
                                writer.execute('UPDATE official_research_attempt_failures SET detail=? WHERE event_id=?', ('during-request', target))
                        else:
                            db.execute('UPDATE official_research_attempt_failures SET detail=? WHERE event_id=?', ('during-request', target))
                    return valid
                with patch.object(macro, 'publication_valid', side_effect=invalidate):
                    after = read_official(db)
                self.assertEqual(len(changed), 1)
                self.assertEqual(after, [item for item in before if item['id'] not in self.fixture.macro_ids])
                db.execute('UPDATE official_research_attempt_failures SET detail=? WHERE event_id=?', ('', changed[0]))


    def test_cached_proof_requires_exact_row_input(self):
        self.fixture.recover()
        original = macro.publication_valid
        checked = []
        with open_read(self.fixture.path) as db:
            before = read_official(db)
            def check_input(*args, **kwargs):
                valid = original(*args, **kwargs)
                if valid:
                    row = {**args[1], 'title': args[1]['title'] + ' altered metadata'}
                    self.assertFalse(original(args[0], row, *args[2:], **kwargs))
                    checked.append(row['id'])
                return valid
            with patch.object(macro, 'publication_valid', side_effect=check_input):
                self.assertEqual(read_official(db), before)
            self.assertEqual(len(checked), 2)

    def test_request_withdraws_macro_rows_on_source_or_parser_policy_change(self):
        self.fixture.recover()
        original = macro.publication_valid
        original_parse = parser.parse
        source = next(value for value in signals.SOURCES if value['id'] == 'x-wallstengine')
        for change in ('source-policy', 'parser-version', 'parser-callable'):
            with self.subTest(change=change), open_read(self.fixture.path) as db:
                before = read_official(db)
                changed = []
                with ExitStack() as guards:
                    def invalidate(*args, **kwargs):
                        valid = original(*args, **kwargs)
                        if valid and not changed:
                            changed.append(True)
                            if change == 'source-policy':
                                guards.enter_context(patch.dict(source, {'allowedHosts': ['blocked.invalid']}))
                            elif change == 'parser-version':
                                guards.enter_context(patch.object(parser, 'VERSION', parser.VERSION + 1))
                            else:
                                guards.enter_context(patch.object(parser, 'parse', lambda *a, **k: original_parse(*a, **k)))
                        return valid
                    with patch.object(macro, 'publication_valid', side_effect=invalidate):
                        after = read_official(db)
                self.assertEqual(len(changed), 1)
                self.assertEqual(after, [item for item in before if item['id'] not in self.fixture.macro_ids])
                self.assertEqual(read_official(db), before)
                self.assertEqual(db.total_changes, 0)


def measure_read(path, read, *, warm=10, cold=3):
    """Bounded timings are descriptive; deterministic work counts are primary."""
    with open_read(path) as db:
        statements = []
        initial = db.total_changes
        with ExitStack() as stack:
            calls = {module.__name__ + '.' + name: stack.enter_context(patch.object(module, name, wraps=getattr(module, name)))
                     for module, name in TRACKED}
            db.set_trace_callback(statements.append)
            output = read(db)
            db.set_trace_callback(None)
        measured = {
            'sql_statements': len(statements),
            'sql_selects': sum(sql.lstrip().upper().startswith(('SELECT', 'WITH')) for sql in statements),
            'sql_dml': sum(sql.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE')) for sql in statements),
            'mutations': db.total_changes - initial,
            'calls': {name: call.call_count for name, call in calls.items()},
            'output_sha256': content_hash(output),
            'query_only': bool(db.execute('PRAGMA query_only').fetchone()[0]),
        }
        elapsed = []
        for _ in range(warm):
            started = time.perf_counter()
            assert read(db) == output
            elapsed.append((time.perf_counter() - started) * 1000)
        measured['warm_ms'] = {'n': warm, 'min': min(elapsed), 'median': statistics.median(elapsed), 'max': max(elapsed)}
        assert db.total_changes == initial
    elapsed = []
    for _ in range(cold):
        started = time.perf_counter()
        with open_read(path) as db:
            assert read(db) == output
            assert db.total_changes == 0
        elapsed.append((time.perf_counter() - started) * 1000)
    measured['cold_connection_ms'] = {'n': cold, 'min': min(elapsed), 'median': statistics.median(elapsed), 'max': max(elapsed)}
    return measured, output


def measure_report(*, ordinary_names=ORDINARY_NAMES, warm=10, cold=3):
    with ExitStack() as stack:
        for name in ('socket.create_connection', 'socket.socket.connect'):
            stack.enter_context(patch(name, side_effect=AssertionError('network forbidden')))
        mixed = MixedMacroFixture(ordinary_names)
        stack.callback(mixed.close)
        report = {'synthetic_only': True, 'reference': NOW.isoformat(),
                  'ordinary_source_notes': len(ordinary_names), 'primary_notes': 1, 'macro_rows': 2,
                  'timing_scope': 'in-process warm reads; cold means new SQLite connection, not filesystem cache eviction',
                  'source_modules': {module.__name__: str(Path(module.__file__).resolve()) for module in (news, macro, parser, research)}}
        for phase in ('held', 'recovered'):
            if phase == 'recovered':
                mixed.recover()
            report[phase] = {}
            for name, read in (('official_updates', read_official), ('service_public_pieces', public_pieces)):
                report[phase][name], output = measure_read(mixed.path, read, warm=warm, cold=cold)
                report[phase][name]['output'] = output
            with open_read(mixed.path) as db:
                report[phase]['source_and_publication_clocks'] = clocks(db)
        return report


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--measure':
        Path(sys.argv[2]).write_text(json.dumps(measure_report(), indent=2, ensure_ascii=False) + '\n')
    else:
        unittest.main()
