"""Owner, Oct 11: PRO deep analysis by a higher-tier model, numbers checked."""
import json
from datetime import timedelta
import unittest
from datetime import datetime, timezone

import test_official_research as base
from test_official_research import QUOTES, research
import deep_analysis
import release_watch
from unittest.mock import patch

ENV = {'OPENAI_API_KEY': 'sk-test-' + 'x' * 30, 'RESEARCH_DEEP_MODEL': 'gpt-6-astra'}
EARNINGS = 'Nebius Reports Third Quarter 2026 Financial Results'


def point(ja, en, evidence='0'):
    return {'ja': ja, 'en': en, 'evidenceIds': [evidence]}


GOOD = {'headline': {'ja': 'Nebius、Inferize買収で推論基盤を強化', 'en': 'Nebius strengthens its inference stack with Inferize'},
        'points': [point('Inferizeの買収は推論の最適化を自社に取り込む動き。', 'Acquiring Inferize brings inference optimization in-house.'),
                   point('技術とチームはToken Factoryに加わった。', 'The technology and team joined Token Factory.'),
                   point('GPUの遊休時間を減らし、稼働率の改善を狙う。', 'It aims to cut idle GPU time and lift utilization.')],
        'watch': point('今後は稼働率の改善が数字に表れるかを確認したい。', 'Watch whether utilization gains show up in reported figures.')}


def reply(note):
    return lambda payload, key: {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps(note, ensure_ascii=False)}]}]}


class DeepAnalysisTests(unittest.TestCase):
    def setUp(self):
        base.OfficialResearchTests.setUp(self)
        # the real calendar must not date releases against the test clock
        patcher = patch.object(release_watch, 'load_schedule', return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(deep_analysis, 'OLD_RETRY_SUBJECTS', ('NBIS',))  # the one-off retry is for named subjects only
        patcher.start()
        self.addCleanup(patcher.stop)

    def earnings(self):
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET title=?', (EARNINGS,))

    def run_deep(self, transport, now=None):
        return deep_analysis.run_once(self.path, transport, ENV, now=base.NOW.timestamp() if now is None else now,
                                      reference=base.NOW)

    def items(self):
        with deep_analysis.connect(self.path) as db:
            return deep_analysis.member_view(db, reference=base.NOW)

    def test_an_earnings_release_gets_one_checked_analysis(self):
        self.earnings()
        seen = []
        def transport(payload, key):
            seen.append(payload)
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_deep(transport), 'done')
        self.assertEqual(seen[0]['model'], 'gpt-6-astra')
        [item] = self.items()
        self.assertEqual(item['kind'], 'earnings')
        self.assertEqual(item['subject'], 'NBIS')
        self.assertEqual(len(item['points']), 3)
        self.assertEqual(self.run_deep(lambda *_: self.fail('analysed twice')), 'idle')

    def test_an_invented_number_is_left_out_and_too_few_points_hold_the_analysis(self):
        self.earnings()
        note = json.loads(json.dumps(GOOD))
        note['points'][0] = point('売上は前年比45%増えた。', 'Revenue rose 45% year over year.')
        self.assertEqual(self.run_deep(reply(note)), 'done')
        [item] = self.items()
        # Only the analysis text is checked: the item also carries a wall-clock timestamp
        # whose seconds can read "45" (CI, Oct 14), which is not an invented number.
        analysis = {key: item[key] for key in ('headline', 'points', 'watch')}
        self.assertNotIn('45', json.dumps(analysis, ensure_ascii=False))
        self.assertEqual(len(item['points']), 2)

    def test_a_rejected_analysis_is_held_after_one_call_but_a_call_that_returned_nothing_may_be_repeated(self):
        # Owner, Nov 15: one paid call per release. A reply the checks rejected is final; a timeout returned nothing to check.
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        calls = []
        def counting(payload, key):
            calls.append(1)
            return reply(bad)(payload, key)
        self.assertEqual(self.run_deep(counting), 'retry')
        self.assertEqual(self.run_deep(counting, now=base.NOW.timestamp() + 1000), 'idle')
        self.assertEqual(self.run_deep(counting, now=base.NOW.timestamp() + 5000), 'idle')
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.items(), [])
        with research.connect(self.path) as db:
            db.execute('DELETE FROM deep_analyses')
        def timeout(payload, key):
            raise TimeoutError('no answer')
        for attempt in range(3):
            self.assertEqual(self.run_deep(timeout, now=base.NOW.timestamp() + 10000 + attempt * 1000), 'retry')
        self.assertEqual(self.run_deep(lambda *_: self.fail('held'), now=base.NOW.timestamp() + 20000), 'idle')

    def test_a_point_may_cite_several_excerpts_but_a_figure_must_be_in_one_of_them(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.', '2': 'Unrelated background text.'}
        headline = {'ja': '売上高は34億1,000万ドル。', 'en': 'Revenue was $3.41 billion.'}
        both = {'ja': '売上高は3.41 billion ドル、営業利益は172 million ドルだった。', 'en': 'Revenue was $3.41 billion and operating income was $172 million.', 'evidenceIds': ['0', '1']}
        only_first = {'ja': '営業利益は172 million ドルだった。', 'en': 'Operating income was $172 million.', 'evidenceIds': ['0']}
        unknown = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['9']}
        note = {'headline': {'ja': 'Revenue was $3.41 billion', 'en': 'Revenue was $3.41 billion'}, 'points': [both, only_first, unknown, both], 'watch': None}
        try:
            deep_analysis.bind(note, excerpts)
        except deep_analysis.Unchecked as exc:  # pragma: no cover - only if the checks reject both citations
            self.fail(exc.detail)
        kept = deep_analysis.bind(note, excerpts)
        self.assertEqual(len(kept['points']), 1)  # the point citing only the revenue excerpt may not use the operating-income figure; the repeat is not added twice
        bad = {'headline': note['headline'], 'points': [only_first, unknown, only_first], 'watch': None}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind(bad, excerpts)
        self.assertEqual({k: v for k, v in caught.exception.detail.items() if k != 'carry'}, {'kept': 0, 'rejected': {'evidence-missing': 1, 'unsupported-number:value:172000000:E': 2}})

    def test_the_headline_is_checked_against_its_own_excerpts_and_negation_rejections_name_their_rule(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'The company did not raise guidance this quarter.',
                    '2': 'Operating income was $172 million.'}
        ok_point = {'ja': '営業利益は172 million ドル。', 'en': 'Operating income was $172 million.', 'evidenceIds': ['2']}
        headline = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}
        note = {'headline': headline, 'points': [ok_point], 'watch': None}
        self.assertEqual(len(deep_analysis.bind(note, excerpts)['points']), 1)  # the release has a negated clause elsewhere: not this headline's evidence
        flipped = {'ja': '会社は今四半期にガイダンスを引き上げた。', 'en': 'The company raised guidance this quarter.', 'evidenceIds': ['1']}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind({'headline': headline, 'points': [flipped, flipped], 'watch': None}, excerpts)
        [reason] = caught.exception.detail['rejected']
        self.assertTrue(reason.startswith('changed-negation:source-negated:'), reason)
        self.assertEqual(caught.exception.detail['kept'], 0)
        kept = deep_analysis.bind({'headline': headline, 'points': [flipped, ok_point], 'watch': None}, excerpts)  # one passed point is published
        self.assertEqual([p['ja'] for p in kept['points']], [ok_point['ja']])

    def test_a_rejected_headline_gets_a_fixed_one_so_a_passed_point_is_published_and_no_point_holds_with_the_reason(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.'}
        point = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}
        bad_headline = {'ja': '売上高は45%増。', 'en': 'Revenue rose 45%.', 'evidenceIds': ['0']}
        kept = deep_analysis.bind({'headline': bad_headline, 'points': [point], 'watch': None}, excerpts)
        self.assertEqual(kept['headline'], {'ja': 'この決算の要点', 'en': 'Key points of this release'})
        self.assertEqual(len(kept['points']), 1)
        bad_point = {'ja': '売上高は45%増。', 'en': 'Revenue rose 45%.', 'evidenceIds': ['0']}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind({'headline': bad_headline, 'points': [bad_point], 'watch': None}, excerpts)
        self.assertEqual(str(caught.exception), 'no-checked-points')
        self.assertEqual(caught.exception.detail['headline'], 'unsupported-number:value:45%:A')

    def test_the_request_has_no_retry_feedback_and_keeps_the_fixed_part_first_for_the_prompt_cache(self):
        self.earnings()
        seen = []
        def transport(payload, key):
            seen.append(payload)
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_deep(transport), 'done')
        [payload] = seen
        self.assertNotIn('previousAttemptRejected', payload['input'])
        self.assertNotIn('previousAttemptRejected', deep_analysis.POLICY)
        self.assertNotIn('alreadyAccepted', deep_analysis.POLICY)
        keys = list(payload)
        self.assertLess(keys.index('instructions'), keys.index('input'))
        self.assertLess(keys.index('prompt_cache_key'), keys.index('input'))
        self.assertEqual(keys[-1], 'input')  # what differs per release comes last
        self.assertEqual(payload['prompt_cache_key'], 'tech-phase-deep-analysis-v%d' % deep_analysis.VERSION)
        self.assertEqual(payload['instructions'], deep_analysis.POLICY)

    def test_unsupported_figures_are_tagged_as_cited_elsewhere_absent_or_mixed(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.'}
        def reason(text_en, text_ja):
            point = {'ja': text_ja, 'en': text_en, 'evidenceIds': ['0']}
            with self.assertRaises(deep_analysis.Unchecked) as caught:
                deep_analysis.bind({'headline': {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}, 'points': [point, point], 'watch': None}, excerpts)
            [key] = caught.exception.detail['rejected']
            return key
        self.assertTrue(reason('Operating income was $172 million.', '営業利益は172 million ドル。').endswith(':E'))  # in the release, not in the cited excerpt
        self.assertTrue(reason('Revenue rose 45%.', '売上は45%増。').endswith(':A'))  # nowhere in the release: calculated or invented
        self.assertTrue(reason('Revenue was $3.41 billion and costs rose 45%.', '売上高は3.41 billion ドル、費用は45%増。').endswith(':A'))

    def test_a_statement_table_figure_may_be_written_in_the_unit_its_header_declares(self):
        # Nov 14, NBIS: "In USD $ millions ... Revenues 146.1 980.8" -- the model wrote "$980.8 million" and the check saw 980800000 vs 980.8
        table = ('Q3 2026 Financial Highlights Consolidated results In USD $ millions Three months ended September 30 2025 2026 Change '
                 'Revenues 146.1 980.8 571 % Adjusted EBITDA / (loss) (5.2 ) 465.8 n/m Total assets 1,962.1 2026')
        def ok(ja, en):
            deep_analysis.checked({'ja': ja, 'en': en}, table)
        ok('売上高は980.8百万ドルだった。', 'Revenue was $980.8 million.')
        ok('調整後EBITDAは465.8百万ドル。', 'Adjusted EBITDA was $465.8 million.')
        for ja, en in [('売上高は9.8億ドル。', 'Revenue was $980.8 billion.'),          # wrong scale
                       ('売上高は9億8,000万ドル。', 'Revenue was $980.0 million.'),      # a figure the table does not print
                       ('売上は2,026百万ドル。', 'Revenue was $2,026 million.'),         # a year is not a table amount
                       ('売上は57.1百万ドル。', 'Revenue was $57.1 million.')]:          # a percentage is not an amount
            with self.assertRaises(ValueError, msg=en):
                deep_analysis.checked({'ja': ja, 'en': en}, table)
        self.assertEqual(deep_analysis.table_scaled_figures('Revenues 146.1 980.8'), '')  # no declared unit: nothing is converted
        # several units in one release: each table in its own unit; a figure printed under two units is ambiguous and converted in neither
        self.assertEqual(deep_analysis.table_scaled_figures('In millions A 1.5 In thousands B 2.5'), '1.5 million; 2.5 thousand')
        self.assertEqual(deep_analysis.table_scaled_figures('In millions A 1.5 In thousands B 1.5'), '')
        self.assertIn('980.8 million', deep_analysis.table_scaled_figures('(in millions of U.S. dollars) Revenues 980.8'))


    def test_a_table_figure_is_scaled_by_the_unit_header_of_an_excerpt_the_point_did_not_cite(self):
        # Nov 14, NBIS v7 still held: the unit header ("(in millions of U.S. dollars)") sits in another excerpt than the cash-flow rows the point cites,
        # and the cash-flow rows are further than the old 2500-character window from their header.
        header = 'Unaudited Condensed Consolidated Statements of Cash Flows (in millions of U.S. dollars) Three months ended September 30 '
        rows = 'Deferred revenue (3.8 ) 3,434.0 (0.7 ) 7,829.0 Proceeds from issuance of convertible notes 3,162.5 5,750.0 4,162.5 10,087.5'
        release = header + 'x ' * 1500 + rows
        quote = rows
        deep_analysis.checked({'ja': '転換社債の発行収入は5,750百万ドル。', 'en': 'Convertible notes proceeds were $5,750 million.'}, quote, release)
        for ja, en in [('転換社債の発行収入は5,750億ドル。', 'Convertible notes proceeds were $5,750 billion.'),   # wrong scale
                       ('発行収入は5,751百万ドル。', 'Proceeds were $5,751 million.'),                              # not printed
                       ('営業活動は4,231.1百万ドル。', 'Operating cash flow was $4,231.1 million.')]:            # printed elsewhere, not in the cited excerpt
            with self.assertRaises(ValueError, msg=en):
                deep_analysis.checked({'ja': ja, 'en': en}, quote, release + ' Net cash 4,231.1')


    def test_a_rule_based_rejection_names_the_check_that_fired(self):
        # Nov 14, NBIS: "invalid-copy" x3 came from one of a dozen checks that raise it; the reason now carries function:line (no text).
        excerpts = {'0': 'Revenue increased to 980.8 in the quarter.'}
        try:
            deep_analysis.checked({'ja': '売上は増加した。', 'en': 'Revenue decreased.'}, excerpts['0'])
        except ValueError as exc:
            reason = deep_analysis.why(exc, excerpts['0'])
        self.assertRegex(reason, r'^(?:invalid-copy@\w+:\d+|changed-direction:\w+:(?:up|down)>(?:up|down)(?:\|(?:up|down))*)$')
        self.assertNotIn('Revenue', reason)

    def test_a_copy_over_the_length_limit_is_rejected_with_its_own_reason_and_the_policy_states_the_limit(self):
        # Nov 14, NBIS v9: invalid-copy@checked:157 x3 -- the format check (empty, or over 600 characters); the policy never told the model a limit.
        self.assertIn('500 characters', deep_analysis.POLICY)
        long = 'x' * (deep_analysis.MAX_COPY_CHARS + 1)
        with self.assertRaises(ValueError) as caught:
            deep_analysis.checked({'ja': long, 'en': 'Revenue rose.'}, 'Revenue rose.')
        self.assertEqual(str(caught.exception), 'copy-too-long')
        with self.assertRaises(ValueError) as caught:
            deep_analysis.checked({'ja': ' ', 'en': 'Revenue rose.'}, 'Revenue rose.')
        self.assertEqual(str(caught.exception), 'invalid-copy')

    def test_a_direction_rejection_names_the_family_and_the_directions(self):
        try:
            deep_analysis.checked({'ja': '売上は減少した。', 'en': 'Revenue decreased.'}, 'Revenue increased to 980.8 in the quarter.')
        except ValueError as exc:
            reason = deep_analysis.why(exc, 'Revenue increased to 980.8 in the quarter.')
        self.assertRegex(reason, r'^(?:changed-direction:\w+:(?:up|down)>(?:up|down)(?:\|(?:up|down))*|changed-direction@\w+:\d+|invalid-copy@\w+:\d+)')


    def test_a_retry_row_that_left_the_window_is_retried_once_and_rejected_copy_is_logged_for_the_owner(self):
        # Nov 15: ARM stayed in 'retry' after its release left the 3-day window, so neither path ever attempted it again.
        import contextlib, io
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        def timeout(payload, key):
            raise TimeoutError('no answer')
        for attempt in range(2):
            self.run_deep(timeout, now=base.NOW.timestamp() + attempt * 1000)
        with research.connect(self.path) as db:
            row = db.execute("SELECT state,attempts FROM deep_analyses").fetchone()
            self.assertEqual((row[0], row[1]), ('retry', 2))
        on = {**ENV, deep_analysis.OLD_RETRY_ENV: 'true'}
        inside = base.NOW.timestamp() + 90000
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=inside), 'idle')  # still inside the window: left to the normal run
        outside = base.NOW.timestamp() + 5 * 86400
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(bad), on, now=outside), 'rejected')
        lines = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]
        self.assertTrue(lines)
        self.assertEqual({line['event'] for line in lines}, {'deep-analysis-rejected-copy'})
        self.assertEqual(lines[0]['part'], 'point')
        self.assertIn('unsupported-number', lines[0]['reason'])
        self.assertIn('45%', lines[0]['ja'])
        self.assertTrue(lines[0]['quote'])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT state FROM deep_analyses").fetchone()[0], 'held')
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=outside + 10), 'idle')  # once per marker
        with research.connect(self.path) as db:
            db.execute("DELETE FROM deep_old_retries")
            db.execute("UPDATE deep_analyses SET state='retry',attempts=2")
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=outside + 20), 'done')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT state FROM deep_analyses").fetchone()[0], 'done')

    def test_old_holds_are_retried_once_when_the_flag_is_on_and_a_good_result_is_dated_to_the_release(self):
        # Owner, Nov 14: the 14 held analyses get exactly one more attempt, with their reasons recorded.
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        for attempt in range(3):
            self.run_deep(reply(bad), now=base.NOW.timestamp() + attempt * 1000)
        later = base.NOW.timestamp() + 90000
        on = {**ENV, deep_analysis.OLD_RETRY_ENV: 'true'}
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), ENV, now=later), 'idle')  # flag off
        with research.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT state FROM deep_analyses").fetchone()[0], 'held')
            created = db.execute("SELECT created_at FROM deep_analyses").fetchone()[0]
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(bad), on, now=later), 'rejected')  # one attempt, held again with reasons
        with research.connect(self.path) as db:
            row = db.execute("SELECT state,attempts,detail FROM deep_analyses").fetchone()
            self.assertEqual((row[0], row[1]), ('held', deep_analysis.MAX_ATTEMPTS))
            self.assertIn('unsupported-number', row[2])
            self.assertEqual(deep_analysis.diagnostics(db, now=later)['oldRetry'], {'rejected': 1})
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=later + 10), 'idle')  # once: never repeated
        with research.connect(self.path) as db:
            db.execute("DELETE FROM deep_old_retries")
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=later + 20), 'done')
        with research.connect(self.path) as db:
            row = db.execute("SELECT state,published_at,created_at FROM deep_analyses").fetchone()
            self.assertEqual((row[0], row[1]), ('done', created))  # dated to the release, not to today
            db.execute("UPDATE deep_analyses SET state='held',source_ref='event:999:gone'")
            db.execute("DELETE FROM deep_old_retries")
        self.assertEqual(deep_analysis.retry_old_holds(self.path, reply(GOOD), on, now=later + 30), 'source-unavailable')

    def test_an_old_hold_whose_release_left_the_candidate_window_is_rebuilt_from_the_stored_event(self):
        # Nov 14 staging: 12 of 14 old holds came back source-unavailable because the newest-100 window had moved past them.
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        for attempt in range(3):
            self.run_deep(reply(bad), now=base.NOW.timestamp() + attempt * 1000)
        with research.connect(self.path) as db:
            ref = db.execute("SELECT source_ref FROM deep_analyses").fetchone()[0]
        far = base.NOW + timedelta(days=60)  # outside the 7-day candidate lookback
        self.assertEqual(deep_analysis.run_once(self.path, reply(GOOD), ENV, now=far.timestamp(), reference=far, only_ref=ref), 'done')
        with research.connect(self.path) as db:
            self.assertEqual(deep_analysis.stored_earnings_source(db, 'event:999:gone'), [])
            self.assertEqual(deep_analysis.stored_earnings_source(db, 'flash:1'), [])

    def test_an_earnings_analysis_not_done_after_two_hours_is_a_critical_incident_naming_company_and_check(self):
        # Nov 14, NBIS: held for 44 hours and nobody noticed. Two hours after the release is a critical alert with the ticker and the check.
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        start = base.NOW.timestamp()
        self.assertEqual(self.run_deep(reply(bad), now=start), 'retry')
        key = deep_analysis.INCIDENT_PREFIX + 'NBIS'
        with research.connect(self.path) as db:
            # The checks rejected every point and the call is not repeated (owner, Nov 15): the alert is immediate, not two hours later.
            self.assertEqual(deep_analysis.sync_incident(db, start + 60), 'deep-analysis-overdue')
            row = db.execute('SELECT severity,status,last_error_code FROM operational_incidents WHERE incident_key=?', (key,)).fetchone()
            self.assertEqual((row[0], row[1]), ('critical', 'open'))
            self.assertEqual(row[2], 'deep-analysis-overdue:NBIS:unsupported-number-value-45-A')
            self.assertEqual(db.execute('SELECT count(*) FROM incident_notification_outbox WHERE incident_key=?', (key,)).fetchone()[0], 1)
            deep_analysis.sync_incident(db, start + 7400)  # still late: one alert, not one per pass
            self.assertEqual(db.execute('SELECT count(*) FROM incident_notification_outbox WHERE incident_key=?', (key,)).fetchone()[0], 1)
            db.execute("UPDATE deep_analyses SET state='done'")
            self.assertIsNone(deep_analysis.sync_incident(db, start + 7500))
            self.assertEqual(db.execute('SELECT status FROM operational_incidents WHERE incident_key=?', (key,)).fetchone()[0], 'resolved')
            db.execute("UPDATE deep_analyses SET state='held'")
            self.assertIsNone(deep_analysis.sync_incident(db, start + 80 * 3600))  # history older than three days is never alerted again
            db.execute("UPDATE deep_analyses SET kind='indicator'")
            self.assertEqual(deep_analysis.overdue(db, start + 7300), [])  # only earnings releases

    def test_a_call_that_returned_nothing_is_a_critical_incident_only_after_two_hours(self):
        self.earnings()
        start = base.NOW.timestamp()
        def timeout(payload, key):
            raise TimeoutError('no answer')
        self.assertEqual(self.run_deep(timeout, now=start), 'retry')
        key = deep_analysis.INCIDENT_PREFIX + 'NBIS'
        with research.connect(self.path) as db:
            self.assertIsNone(deep_analysis.sync_incident(db, start + 3600))  # one hour: its repeat is still due
            self.assertIsNone(db.execute('SELECT 1 FROM operational_incidents WHERE incident_key=?', (key,)).fetchone())
            self.assertEqual(deep_analysis.sync_incident(db, start + 7300), 'deep-analysis-overdue')

    def test_only_boilerplate_is_removed_from_what_is_sent_and_the_amount_is_recorded(self):
        # Owner, Nov 15: shorter input, same content. Results, outlook, segments, comments, table cells and unit headers all stay.
        body = '\n'.join([
            'NEWS RELEASE Contact Jane Doe Investor Relations ir@example.com',
            'Example Corp Reports Third Quarter 2026 Financial Results',
            'Revenue was $980.8 million, up 355% year over year, led by the Cloud segment.',
            '"We are scaling faster than demand," said the chief executive.',
            'The company expects fourth-quarter revenue of $1.1 billion to $1.2 billion.',
            'Cautionary Statement',
            'This press release contains forward-looking statements. Actual results may differ materially because of risks and uncertainties. We undertake no obligation to update any forward-looking statement.',
            'Forward-looking guidance for the segment is unchanged and growth continues across the Cloud business without any stated range.',
            'Condensed Consolidated Statements of Operations',
            'Condensed Consolidated Statements of Operations',
            '(in thousands)', 'Net income', '6,108', '2,824', '7',
            'Media: +1 212 555 0123',
            '© 2026 Example Corp. All rights reserved.',
            'Example is a registered trademark of Example Corp.'])
        trimmed, trim = deep_analysis.trim_release(body)
        for kept in ('Revenue was $980.8 million', 'scaling faster than demand', 'expects fourth-quarter revenue of $1.1 billion',
                     'Forward-looking guidance for the segment is unchanged', '(in thousands)', 'Net income', '6,108', '2,824', '2,824\n7'):
            self.assertIn(kept, trimmed)
        self.assertEqual(trimmed.count('Condensed Consolidated Statements of Operations'), 1)  # a repeated heading, once
        for gone in ('ir@example.com', 'Cautionary Statement', 'undertake no obligation', '212 555', 'All rights reserved', 'registered trademark'):
            self.assertNotIn(gone, trimmed)
        self.assertEqual(trim['before'], len(body))
        self.assertEqual(trim['after'], len(trimmed))
        self.assertGreater(trim['removedChars'], 250)
        self.assertEqual(trim['estTokensRemoved'], trim['removedChars'] // 4)
        self.assertEqual(deep_analysis.trim_release('Revenue was $5 million.\nNet income was 2.')[0], 'Revenue was $5 million.\nNet income was 2.')

    def test_points_that_pass_are_published_and_the_rejected_ones_are_left_out_with_one_call(self):
        # Owner, Nov 15: no second call; one passed point is enough, the rest is dropped.
        self.earnings()
        first = json.loads(json.dumps(GOOD))
        first['points'] = [GOOD['points'][0], point('売上は45%増。', 'Revenue rose 45%.'), point('利益は45%増。', 'Profit rose 45%.')]
        calls = []
        def transport(payload, key):
            calls.append(1)
            return reply(first)(payload, key)
        self.assertEqual(self.run_deep(transport), 'done')
        [item] = self.items()
        self.assertEqual([p['ja'] for p in item['points']], [GOOD['points'][0]['ja']])
        self.assertEqual(item['headline']['ja'], GOOD['headline']['ja'])
        self.assertEqual(self.run_deep(transport, now=base.NOW.timestamp() + 1000), 'idle')
        self.assertEqual(len(calls), 1)

    def test_a_release_that_never_got_an_analysis_row_is_a_critical_incident_after_two_hours(self):
        # Owner, Nov 14: a release found but never attempted (daily budget spent, service stopped) must alert like a failed one.
        self.earnings()
        observed = datetime.fromisoformat(deep_analysis.earnings_sources(deep_analysis.connect(self.path), base.NOW)[0]['observedAt'].replace('Z', '+00:00'))
        start = observed.timestamp()
        key = deep_analysis.INCIDENT_PREFIX + 'NBIS'
        with research.connect(self.path) as db:
            self.assertIsNone(deep_analysis.sync_incident(db, start + 3600, ENV))  # one hour: not yet
            self.assertIsNone(deep_analysis.sync_incident(db, start + 7300, {}))  # deep analysis not configured: stays quiet
            self.assertEqual(deep_analysis.sync_incident(db, start + 7300, ENV), 'deep-analysis-overdue')
            self.assertEqual(db.execute('SELECT severity,last_error_code FROM operational_incidents WHERE incident_key=?', (key,)).fetchone()[:],
                             ('critical', 'deep-analysis-overdue:NBIS:not-attempted'))
            db.executemany('INSERT INTO deep_analysis_calls VALUES(?,?,?,0)', [(start + 7000 + i, 'x', 'm') for i in range(40)])
            self.assertEqual(deep_analysis.overdue(db, start + 7300, ENV)[0]['check'], 'daily-limit-reached')
            deep_analysis.schema(db)
            db.execute("DELETE FROM deep_analysis_calls")
        with research.connect(self.path) as db:
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,attempts,next_at,created_at) SELECT 'event:'||id||':'||sha,'earnings','NBIS',sha,'done',1,0,? FROM signal_events", (datetime.fromtimestamp(start + 7400, timezone.utc).isoformat(),))
            self.assertIsNone(deep_analysis.sync_incident(db, start + 7500, ENV))  # an analysis exists: resolved
            self.assertEqual(db.execute('SELECT status FROM operational_incidents WHERE incident_key=?', (key,)).fetchone()[0], 'resolved')

    def test_the_last_calls_of_the_day_are_kept_for_earnings(self):
        self.earnings()
        start = base.NOW.timestamp()
        with research.connect(self.path) as db:
            deep_analysis.schema(db)
            db.executemany('INSERT INTO deep_analysis_calls VALUES(?,?,?,0)', [(start - 100 + i, 'x', 'm') for i in range(35)])
        self.assertEqual(deep_analysis.earnings_reserve(40), 12)
        self.assertEqual(self.run_deep(reply(GOOD)), 'done')  # 35 of 40 used: earnings still run
        self.assertEqual(deep_analysis.earnings_reserve(3), 1)

    def test_why_an_analysis_is_held_is_recorded_and_older_holds_are_tried_again(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        self.assertEqual(self.run_deep(reply(bad)), 'retry')
        with deep_analysis.connect(self.path) as db:
            report = deep_analysis.diagnostics(db, now=base.NOW.timestamp() + 5000)
        [held] = report['notDone']
        self.assertEqual((held['subject'], held['state'], held['failure']), ('NBIS', 'held', 'no-checked-points'))
        self.assertEqual(held['detail'], {'kept': 0, 'rejected': {'unsupported-number:value:45%:A': 3}})
        self.assertEqual(report['version'], deep_analysis.VERSION)
        self.assertEqual(self.run_deep(lambda *_: self.fail('held'), now=base.NOW.timestamp() + 5000), 'idle')
        with deep_analysis.connect(self.path) as db:  # held by an older version of the checks
            db.execute('UPDATE deep_analyses SET version=0')
        self.assertEqual(self.run_deep(reply(GOOD), now=base.NOW.timestamp() + 6000), 'done')
        [item] = self.items()
        self.assertEqual(len(item['points']), 3)

    def test_earnings_only_companies_outside_the_roster_get_no_deep_analysis_but_roster_ones_do(self):
        # Owner, Nov 15: the 22 roster companies (DELL, AMZN, ORCL are earnings-scope) always get one; others keep the old rule.
        self.earnings()
        providers = deep_analysis.monitor.PROVIDERS
        with patch.dict(providers, {'NBIS': {**providers['NBIS'], 'scope': 'earnings'}}):
            with patch.object(deep_analysis, 'ROSTER', [t for t in deep_analysis.ROSTER if t != 'NBIS']):
                self.assertEqual(self.run_deep(lambda *_: self.fail('earnings-only')), 'idle')
            self.assertEqual(self.run_deep(reply(GOOD)), 'done')

    def test_other_news_and_missing_configuration_never_call_the_model(self):
        self.assertEqual(self.run_deep(lambda *_: self.fail('not earnings')), 'idle')
        self.earnings()
        self.assertEqual(deep_analysis.run_once(self.path, lambda *_: self.fail('unconfigured'),
                                                {'OPENAI_API_KEY': ENV['OPENAI_API_KEY']}, now=base.NOW.timestamp(),
                                                reference=base.NOW), 'idle')


    # Owner, Nov 15: every roster company's earnings deep analysis is published.
    def stored_release(self, ticker='CRWV', url='https://www.sec.gov/Archives/edgar/data/1769628/x/ex991.htm', at=None, text=None):
        at = (at or base.NOW).isoformat()
        text = text or (base.BODY + '\nFinancial Highlights')
        with research.connect(self.path) as db:
            db.execute("DELETE FROM source_revisions"); db.execute("DELETE FROM release_events"); db.execute("DELETE FROM sources")
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)', (url, ticker, 'x', '2026-11-10', at, 'rev1'))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)', (url, 'rev1', at, text, len(text)))

    def test_a_roster_release_known_only_from_a_stored_sec_page_still_gets_one_analysis(self):
        self.stored_release()
        self.assertEqual(self.run_deep(reply(GOOD)), 'done')
        [item] = self.items()
        self.assertEqual(item['subject'], 'CRWV')
        self.assertEqual(self.run_deep(reply(GOOD), now=base.NOW.timestamp() + 5), 'idle')  # one analysis per release

    def test_earnings_only_roster_companies_are_no_longer_left_out(self):
        for ticker in ('DELL', 'AMZN', 'ORCL'):
            with research.connect(self.path) as db:
                db.execute("UPDATE sources SET ticker=?", (ticker,))
                db.execute("UPDATE release_events SET ticker=?", (ticker,))
                db.execute("UPDATE signal_events SET source_id='primary-ir-%s'" % ticker.lower()) if db.execute("SELECT 1 FROM sqlite_master WHERE name='signal_events'").fetchone() else None
        self.earnings()
        with research.connect(self.path) as db:
            subjects = {row['subject'] for row in deep_analysis.earnings_sources(db, base.NOW)}
        self.assertTrue(subjects <= set(deep_analysis.ROSTER))

    def test_backfill_makes_one_analysis_per_company_dated_to_its_release_and_never_repeats(self):
        released = base.NOW - timedelta(days=20)
        self.stored_release(at=released)
        on = {**ENV, deep_analysis.BACKFILL_ENV: 'true'}
        now = base.NOW.timestamp()
        self.assertEqual(deep_analysis.backfill_roster(self.path, reply(GOOD), ENV, now=now), 'idle')  # flag off
        self.assertEqual(deep_analysis.backfill_roster(self.path, reply(GOOD), on, now=now), 'done')
        with research.connect(self.path) as db:
            row = db.execute("SELECT subject,state,published_at,created_at FROM deep_analyses").fetchone()
            self.assertEqual((row['subject'], row['state']), ('CRWV', 'done'))
            self.assertTrue(row['published_at'].startswith((released + timedelta(hours=1)).isoformat()[:13]))  # the release's date, not today
            self.assertEqual(db.execute("SELECT count(*) FROM deep_analysis_calls").fetchone()[0], 1)
        self.assertEqual(deep_analysis.backfill_roster(self.path, reply(GOOD), on, now=now + 10), 'idle')

    def test_backfill_skips_a_company_that_already_has_an_analysis_of_that_release(self):
        self.earnings()
        self.assertEqual(self.run_deep(reply(GOOD)), 'done')
        on = {**ENV, deep_analysis.BACKFILL_ENV: 'true'}
        self.assertEqual(deep_analysis.backfill_roster(self.path, reply(GOOD), on, now=base.NOW.timestamp() + 10), 'idle')

    def test_a_roster_company_without_an_analysis_is_a_critical_incident_from_the_next_morning_in_japan(self):
        released = datetime(2026, 11, 17, 21, 0, tzinfo=timezone.utc)  # NVDA after the US close: 06:00 JST on the 18th
        before_morning = (datetime(2026, 11, 17, 23, 30, tzinfo=timezone.utc)).timestamp()   # 08:30 JST
        morning = datetime(2026, 11, 18, 0, 5, tzinfo=timezone.utc).timestamp()               # 09:05 JST
        events = [{'kind': 'earnings', 'ticker': 'NVDA', 'phase': 'release', 'at': released},
                  {'kind': 'earnings', 'ticker': 'NVDA', 'phase': 'call', 'at': released + timedelta(hours=1)}]
        patcher = patch.object(release_watch, 'load_schedule', return_value=events)
        patcher.start()
        self.addCleanup(patcher.stop)
        with deep_analysis.connect(self.path) as db:
            self.assertEqual([i for i in deep_analysis.roster_silent(db, before_morning, ENV) if i['subject'] == 'NVDA'], [])
            late = [i for i in deep_analysis.roster_silent(db, morning, ENV) if i['subject'] == 'NVDA']
            self.assertEqual(len(late), 1)
            self.assertEqual(late[0]['check'], 'roster-no-analysis-none')
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,published_at) VALUES('r','earnings','NVDA','x','done',?,?)",
                       (released.isoformat(), released.isoformat()))
            self.assertEqual([i for i in deep_analysis.roster_silent(db, morning, ENV) if i['subject'] == 'NVDA'], [])
            self.assertIn('deep-analysis-overdue', deep_analysis.sync_incident(db, morning, ENV) or 'deep-analysis-overdue')

    def test_the_same_release_analysed_twice_shows_once_to_readers(self):
        with deep_analysis.connect(self.path) as db:
            for ref, at in (('event:1:a', '2026-11-04T01:00:00+00:00'), ('event:2:b', '2026-11-04T02:00:00+00:00')):
                db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,published_at,source_url,payload) VALUES(?,?,?,?,?,?,?,?,?)",
                           (ref, 'earnings', 'ARM', 'x', 'done', at, at, 'https://example.com/arm', json.dumps(GOOD)))
            items = deep_analysis.member_view(db, reference=datetime(2026, 11, 15, tzinfo=timezone.utc))
        self.assertEqual(len(items), 1)


    def test_one_release_carried_by_several_pages_shows_once_and_is_not_analysed_again(self):
        with deep_analysis.connect(self.path) as db:
            for ref, at, url in (('event:1:a', '2026-11-30T21:03:00+00:00', 'https://www.sec.gov/arm-8k.htm'),
                                 ('event:2:b', '2026-11-30T21:06:00+00:00', 'https://newsroom.arm.com/long-title'),
                                 ('event:3:c', '2026-11-30T21:09:00+00:00', 'https://newsroom.arm.com/short')):
                db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,published_at,source_url,payload) VALUES(?,?,?,?,?,?,?,?,?)",
                           (ref, 'earnings', 'ARM', 'x', 'done', at, at, url, json.dumps(GOOD)))
            later = '2026-12-20T00:00:00+00:00'  # the next quarter is a different release and shows too
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,published_at,source_url,payload) VALUES(?,?,?,?,?,?,?,?,?)",
                       ('event:9:z', 'earnings', 'ARM', 'x', 'done', later, later, 'https://newsroom.arm.com/q3', json.dumps(GOOD)))
            items = deep_analysis.member_view(db, reference=datetime(2026, 12, 21, tzinfo=timezone.utc))
            self.assertEqual(len(items), 2)
            row = {'subject': 'ARM', 'url': 'https://example.com/fourth-page', 'observedAt': '2026-11-30T21:30:00+00:00'}
            self.assertTrue(deep_analysis.same_release_done(db, row, base.NOW))
            self.assertFalse(deep_analysis.same_release_done(db, {**row, 'observedAt': '2026-12-10T00:00:00+00:00'}, base.NOW))


    def test_the_old_retry_touches_only_its_named_subjects_never_a_new_hold(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        self.run_deep(reply(bad))
        with research.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT state,attempts FROM deep_analyses").fetchone()[:], ('held', 1))  # one call, final
            db.execute("UPDATE deep_analyses SET subject='ARM'")
        on = {**ENV, deep_analysis.OLD_RETRY_ENV: 'true'}
        self.assertEqual(deep_analysis.retry_old_holds(self.path, lambda *_: self.fail('no re-call of a rejected analysis'), on,
                                                       now=base.NOW.timestamp() + 90000), 'idle')

    def test_computed_figures_come_from_the_results_table_and_a_point_may_cite_them(self):
        import issuer_result_flash as flash
        facts = [('revenue', '\u20a9104.615T', '\u20a933.3T', ('売上高', 'Revenue (preliminary, KRW trillion)')),
                 ('operating-income', '\u20a960.5T', '\u20a910.6T', ('営業利益', 'Operating profit (preliminary, KRW trillion)'))]
        parse = lambda text, url=None: {'period': 'Q3 2026', 'facts': facts}
        with patch.dict(flash.PROFILES, {'SKHY': {**flash.PROFILES['SKHY'], 'parse': parse}}):
            text = deep_analysis.derived_figures('SKHY', 'https://x', 'ignored')
        self.assertIn('Computed by the service', text)
        self.assertIn('change year over year: up 214.2%', text)           # 104.615 / 33.3 - 1
        self.assertIn('Operating margin: 57.8% of revenue; a year earlier 31.8% of revenue', text)
        self.assertEqual(deep_analysis.derived_figures('NOPROFILE', 'https://x', 'ignored'), '')
        excerpts = {'0': 'The company reported results for the quarter.', '1': text}
        note = {'headline': {'ja': 'SK hynixの営業利益率が改善', 'en': 'SK hynix operating margin improves', 'evidenceIds': ['1']},
                'points': [{'ja': '営業利益率は57.8%となり、前年同期の31.8%から上昇した。', 'en': 'Operating margin was 57.8% of revenue, up from 31.8% a year earlier.',
                            'evidenceIds': ['1']}],
                'watch': {'ja': '次の四半期の営業利益率を確認したい。', 'en': 'Watch the operating margin next quarter.', 'evidenceIds': ['0']}}
        self.assertEqual(len(deep_analysis.bind(note, excerpts)['points']), 1)


    def test_every_rejected_piece_is_logged_with_its_quote_without_a_second_call(self):
        import contextlib, io
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = bad['points'] + [point('売上は45%増。', 'Revenue rose 45%.')]
        calls = []
        def transport(payload, key):
            calls.append(1)
            return reply(bad)(payload, key)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(self.run_deep(transport), 'done')
        self.assertEqual(len(calls), 1)
        lines = [json.loads(line) for line in out.getvalue().splitlines() if 'deep-analysis-rejected-copy' in line]
        self.assertTrue(lines and lines[0]['quote'] and lines[0]['reason'])
        self.assertNotIn('Revenue rose 45%', json.dumps(deep_analysis.diagnostics(deep_analysis.connect(self.path))))  # never in /health


    def test_a_call_interrupted_by_a_restart_is_resumed_once_not_forever(self):
        released = base.NOW - timedelta(days=10)
        self.stored_release(at=released)
        on = {**ENV, deep_analysis.BACKFILL_ENV: 'true'}
        now = base.NOW.timestamp()
        with deep_analysis.connect(self.path) as db:
            item = deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=30))[0]
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,attempts,next_at,created_at,source_url,source_title,version) "
                       "VALUES(?,?,?,?,'running',1,?,?,?,?,?)", (item['ref'], 'earnings', 'CRWV', item['sha'], now + 300, released.isoformat(), item['url'], item['title'],
                                                                 deep_analysis.VERSION))
        self.assertEqual(deep_analysis.backfill_roster(self.path, lambda *_: self.fail('still in flight'), on, now=now), 'idle')  # not stale yet
        calls = []
        def transport(payload, key):
            calls.append(1)
            return reply(GOOD)(payload, key)
        self.assertEqual(deep_analysis.backfill_roster(self.path, transport, on, now=now + 1000), 'done')  # stale: resumed once
        self.assertEqual(len(calls), 1)
        with research.connect(self.path) as db:
            db.execute("UPDATE deep_analyses SET state='running',attempts=2,next_at=?", (now + 1100,))
            db.execute("DELETE FROM deep_old_retries")
        self.assertEqual(deep_analysis.backfill_roster(self.path, lambda *_: self.fail('no third call'), on, now=now + 2000), 'source-unavailable')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT state,failure FROM deep_analyses").fetchone()[:], ('held', 'interrupted'))


    def test_an_old_release_stored_under_a_new_date_is_not_taken_for_the_latest_quarter(self):
        old = 'Exhibit 99.1\nDell Technologies Delivers First Quarter Fiscal 2025 Financial Results\nROUND ROCK, Texas \u2014 May 30, 2024\n' + base.BODY
        self.stored_release(ticker='DELL', url='https://www.sec.gov/Archives/edgar/data/1571996/x/ex991.htm', text=old + '\nStatements of Income and Related Financial Highlights')
        with deep_analysis.connect(self.path) as db:
            self.assertEqual(deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=30)), [])
            reasons = deep_analysis.source_reasons(db, 'DELL', base.NOW)
        self.assertEqual(reasons['verdicts'], {'stale-period': 1})
        current = old.replace('May 30, 2024', (base.NOW - timedelta(days=5)).strftime('%B %d, %Y').replace(' 0', ' ')).replace('2025', '2027')
        self.stored_release(ticker='DELL', url='https://www.sec.gov/Archives/edgar/data/1571996/x/ex991.htm', text=current + '\nStatements of Income and Related Financial Highlights')
        with deep_analysis.connect(self.path) as db:
            self.assertEqual(len(deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=30))), 1)
        self.assertFalse(deep_analysis.stale_release('Results\nJanuary 15, 2027 ... December 2026', datetime(2027, 1, 20, tzinfo=timezone.utc)))

    def test_health_says_why_a_roster_company_has_no_analysis(self):
        self.stored_release(ticker='GEV', url='https://www.sec.gov/Archives/edgar/data/1996810/x/ex991.htm', text='tiny')
        with deep_analysis.connect(self.path) as db:
            report = deep_analysis.diagnostics(db, now=base.NOW.timestamp())
        gev = {row['ticker']: row for row in report['roster']}['GEV']
        self.assertEqual(gev['storedPages']['verdicts'], {'short': 1})
        self.assertEqual(gev['storedPages']['samples']['short'][0]['address'], 'www.sec.gov/Archives/edgar/data/1996810/x/ex991.htm')
        self.assertNotIn('tiny', json.dumps(report))


    def test_an_analysis_made_weeks_after_a_release_does_not_cover_it(self):
        # Dell, Nov 15: a held analysis of an old page dated Sep 24 must not keep the Sep 1 release from being made.
        released = base.NOW - timedelta(days=10)
        self.stored_release(at=released)
        with deep_analysis.connect(self.path) as db:
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,source_url) VALUES('old','earnings','CRWV','x','held',?,?)",
                       ((released + timedelta(days=21)).isoformat(), 'https://elsewhere.example/old'))
            self.assertEqual(len(deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=30))), 1)
            db.execute("UPDATE deep_analyses SET created_at=?", ((released + timedelta(hours=1)).isoformat(),))
            deep_analysis.STORED_CACHE.clear()
            self.assertEqual(deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=30)), [])


    def test_the_newest_release_by_its_own_date_is_taken_not_the_newest_by_the_day_it_was_stored(self):
        # Nov 15: AVGO's, DELL's and ORCL's old SEC filings were all stored on Sep 24, so "newest stored" was arbitrary.
        stored = base.NOW - timedelta(days=30)
        pages = (('https://www.sec.gov/Archives/edgar/data/1571996/000157199624000050/dell-20240530.htm', 'May 30, 2024'),
                 ('https://www.sec.gov/Archives/edgar/data/1571996/000157199626000100/dell-20260901.htm', 'September 1, 2026'),
                 ('https://www.sec.gov/Archives/edgar/data/1571996/000157199625000096/dell-20250828.htm', 'August 28, 2025'))
        with research.connect(self.path) as db:
            db.execute("DELETE FROM source_revisions"); db.execute("DELETE FROM release_events"); db.execute("DELETE FROM sources")
            for index, (url, day) in enumerate(pages):
                text = 'Dell Technologies Delivers Results\nROUND ROCK, Texas \u2014 %s\n' % day + base.BODY + '\nStatements of Income and Related Financial Highlights'
                db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)', (url, 'DELL', 'x', '2026-09-01', stored.isoformat(), 'rev%d' % index))
                db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)', (url, 'rev%d' % index, stored.isoformat(), text, len(text)))
        with deep_analysis.connect(self.path) as db:
            found = deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=120))
            self.assertEqual([item['url'][-17:] for item in found], ['dell-20260901.htm'])
            self.assertTrue(found[0]['observedAt'].startswith('2026-09-01'))
            # once that newest release is covered, an older one is never taken in its place
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,source_url) VALUES('x','earnings','DELL','s','done',?,?)",
                       ('2026-09-01T22:00:00+00:00', 'https://elsewhere.example/dell'))
            deep_analysis.STORED_CACHE.clear()
            self.assertEqual(deep_analysis.stored_release_sources(db, base.NOW, False, since=base.NOW - timedelta(days=120)), [])
        self.assertEqual(deep_analysis.release_date('https://x/y/avgo-20260902.htm', '', stored).date().isoformat(), '2026-09-02')
        self.assertEqual(deep_analysis.release_date('https://x/y/page', 'ROUND ROCK \u2014 May 30, 2024 ...', stored).date().isoformat(), '2024-05-30')
        self.assertEqual(deep_analysis.release_date('https://x/y/page', 'no date', stored), stored)


class IndicatorAnalysisTests(unittest.TestCase):
    setUp = base.OfficialResearchTests.setUp

    def test_an_indicator_flash_is_analysed_from_its_own_figures_only(self):
        from unittest.mock import patch
        import market_results
        flash = {'id': '9', 'kind': 'economic', 'period': 'SEPTEMBER U.S. CPI', 'url': 'https://x.com/wallstengine/status/9',
                 'titleEn': 'U.S. September CPI: YoY 2.9%',
                 'facts': [{'key': 'cpi-yoy', 'ja': 'CPI（前年比）', 'en': 'CPI (YoY)', 'value': '2.9%', 'comparisons': {'forecast': '2.9%', 'previous': '2.7%'}}]}
        note = {'headline': {'ja': '米CPIは前年比2.9%で予想通り', 'en': 'U.S. CPI at 2.9% YoY, in line with forecasts'},
                'points': [point('前年比2.9%は予想の2.9%と一致した。', 'The 2.9% YoY reading matched the 2.9% forecast.'),
                           point('前回の2.7%から伸びが強まった。', 'It firmed from the previous 2.7%.'),
                           point('利下げ観測は3.5%まで後退した。', 'Rate-cut odds fell to 3.5%.')],
                'watch': point('コアの動きを確認したい。', 'Watch the core reading.')}
        with patch.object(market_results, 'public_feed', return_value=[flash]):
            self.assertEqual(deep_analysis.run_once(self.path, reply(note), ENV, now=base.NOW.timestamp(), reference=base.NOW), 'done')
        with deep_analysis.connect(self.path) as db:
            [item] = deep_analysis.member_view(db, reference=base.NOW)
        self.assertEqual(item['kind'], 'indicator')
        self.assertEqual(len(item['points']), 2)
        self.assertNotIn('3.5', json.dumps(item, ensure_ascii=False))


    def test_health_lists_published_names_and_the_roster_without_any_text(self):
        now = base.NOW.timestamp()
        with deep_analysis.connect(self.path) as db:
            for ref, kind, subject, state, created in (('a', 'earnings', 'NVDA', 'done', '2026-10-20T00:00:00+00:00'),
                                                       ('b', 'indicator', 'U.S. PCE', 'done', '2026-10-21T00:00:00+00:00'),
                                                       ('c', 'earnings', 'AMD', 'held', '2026-10-22T00:00:00+00:00')):
                db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,created_at,published_at,payload) VALUES(?,?,?,?,?,?,?,?)",
                           (ref, kind, subject, 'x', state, created, created if state == 'done' else None, '{"headline":{"ja":"SECRET","en":"SECRET"}}'))
            report = deep_analysis.diagnostics(db, now=now)
        self.assertEqual({(i['subject'], i['kind']) for i in report['published']}, {('NVDA', 'earnings'), ('U.S. PCE', 'indicator')})
        roster = {row['ticker']: row for row in report['roster']}
        self.assertEqual(len(roster), 22)
        self.assertEqual(roster['NVDA']['deepState'], 'done')
        self.assertEqual(roster['AMD']['deepState'], 'held')
        self.assertEqual(roster['MU']['deepState'], 'none')
        self.assertNotIn('SECRET', json.dumps(report))



if __name__ == '__main__':
    unittest.main()
