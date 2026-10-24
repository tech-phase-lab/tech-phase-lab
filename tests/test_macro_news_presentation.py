"""Synthetic presentation-only macro regressions; no live or provider access."""
from copy import deepcopy
from dataclasses import replace
import json
import unittest
from unittest.mock import patch

from test_macro_source_news import JOBS, CPI
import test_macro_source_publication as fixture
import macro_source_news as grammar
import macro_source_publication as publication
import official_research as research


class MacroPresentationTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden'))
            guard.start()
            self.addCleanup(guard.stop)

    def test_compact_complete_reports_keep_region_month_actual_units_and_basis(self):
        for body, expected in (
            (JOBS, {'shortTitleJa': '米8月非農業部門雇用+31,000人',
                    'shortTitleEn': 'U.S. Aug nonfarm payrolls +31K'}),
            (CPI, {'shortTitleJa': '報道：ユーロ圏8月CPI 前年比3.9%',
                   'shortTitleEn': 'Reported Eurozone Aug CPI: 3.9% YoY'}),
            (JOBS.replace('AUGUST', 'SEPTEMBER').replace('+31K', '-0.001K'),
             {'shortTitleJa': '米9月非農業部門雇用-1人',
              'shortTitleEn': 'U.S. Sep nonfarm payrolls -0.001K'}),
            (CPI.replace('August', 'May').replace('rose 3.9%', 'rose +4.25%'),
             {'shortTitleJa': '報道：ユーロ圏5月CPI 前年比+4.25%',
              'shortTitleEn': 'Reported Eurozone May CPI: +4.25% YoY'}),
        ):
            with self.subTest(expected=expected):
                report = grammar.parse(body)
                before = deepcopy(report)
                self.assertEqual(grammar.compact_titles(report), expected)
                with patch.object(grammar,'parse',wraps=grammar.parse) as parses:
                    self.assertEqual(grammar.derive_compact(body),expected)
                self.assertEqual(parses.call_count,1)
                self.assertEqual(report, before)
                # Full persisted copy remains the original four-field grammar.
                self.assertEqual(set(grammar.render(report)), {'titleJa', 'titleEn', 'bodyJa', 'bodyEn'})
                self.assertNotRegex(str(expected), 'estimate|forecast|予想|3.8%|95K')

    def test_compact_copy_rejects_changed_type_role_sign_period_unit_and_source(self):
        report = grammar.parse(JOBS)
        first = report.metrics[0]
        changed = [replace(first, actual=first.estimate, estimate=first.actual),
                   replace(first, actual=replace(first.actual, number='-31')),
                   replace(first, actual=replace(first.actual, unit='%')),
                   replace(first, period=replace(first.period, month=9))]
        reports = [replace(report, metrics=(value, *report.metrics[1:])) for value in changed]
        reports += [replace(report, month=True), replace(report, region='Eurozone'),
                    replace(report, kind='preview'), replace(report, body_sha='changed'),
                    replace(report, body=JOBS.replace('+31K', '+32K'))]
        for value in reports:
            with self.subTest(value=value.kind):
                with self.assertRaisesRegex(ValueError, 'invalid-macro-binding'):
                    grammar.compact_titles(value)

    def test_partial_calendar_forecast_unknown_tail_cannot_supply_compact_copy(self):
        for body in [JOBS.rsplit('\n', 1)[0], JOBS + '\nUnproved additional claim.',
                     CPI.replace('rose', 'will rise'), CPI.replace('YoY', 'annualized'),
                     'Today economic calendar: nonfarm payrolls estimate +95K']:
            with self.assertRaises(ValueError):
                grammar.compact_titles(grammar.parse(body))
            with self.assertRaises(ValueError):
                grammar.derive_compact(body)

    def test_projection_adds_only_category_and_short_titles_without_rewriting_audits(self):
        for body in (JOBS, CPI):
            case = fixture.MacroPublicationTests()
            case.setUp()
            try:
                row = case.hold(body)
                self.assertEqual(case.recover(), 'done')
                with research.connect(case.path) as db:
                    saved = dict(db.execute('SELECT * FROM official_research_publications').fetchone())
                    audit = dict(db.execute('SELECT * FROM ' + publication.AUDIT_TABLE).fetchone())
                    note = json.loads(saved['payload'])
                    self.assertTrue(publication.publication_valid(db, row, saved, fixture.NOW))
                before = deepcopy((row, note))
                item = publication.public_item(row, note)
                self.assertEqual((row, note), before)
                self.assertEqual(item['newsCategory'], 'economic')
                self.assertEqual(item['tickers'], [])
                expected = {'id': str(row['id']), 'title': note['macroTitles']['en'],
                            'translationJa': note['macroTitles']['ja'], 'url': row['url'],
                            'publisher': 'Reported economic news', 'tickers': [],
                            'publishedAt': row['published_at'], 'observedAt': row['observed_at'],
                            'bodyJa': note['facts'][0]['ja'], 'bodyEn': note['facts'][0]['en'],
                            'generalSource': 1}
                self.assertEqual({key: value for key, value in item.items()
                                  if key not in ('newsCategory', 'shortTitleJa', 'shortTitleEn')}, expected)
                self.assertEqual(note, publication.derived_note(row))
                self.assertEqual(set(note['macroTitles']), {'ja', 'en'})
                self.assertNotIn('newsCategory', note)
                self.assertEqual(case.feed(), [item])
                with research.connect(case.path) as db:
                    self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()), saved)
                    self.assertEqual(dict(db.execute('SELECT * FROM ' + publication.AUDIT_TABLE).fetchone()), audit)
                    self.assertTrue(publication.publication_valid(db, row, saved, fixture.NOW))
                case.mutate('DELETE FROM ' + publication.AUDIT_TABLE)
                self.assertEqual(case.feed(), [])
            finally:
                case.doCleanups()


if __name__ == '__main__':
    unittest.main()
