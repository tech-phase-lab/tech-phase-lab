"""Synthetic pure macro grammar regressions; no live source/clock claims."""
from copy import deepcopy
from dataclasses import replace
import hashlib
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import macro_source_news as macro

JOBS = '''AUGUST U.S. JOBS REPORT 👇

NONFARM PAYROLLS +31K, (Est. +95K)\x20\x20
UNEMPLOYMENT RATE 4.3%, (Est. 4.0%)

AVG. HOURLY EARNINGS YoY 3.3%, (Est. 3.4%)

PARTICIPATION RATE 62.1%, (Est. 62.0%)\x20\x20
PRIVATE PAYROLLS +48K, (Est. +83K)

AVG. WORKWEEK 34.6 HOURS, (Est. 34.5 HOURS)

GOVERNMENT PAYROLLS -17K, (Prev. +45K)'''
CPI = '''Eurozone 🇪🇺 August CPI rose 3.9% YoY (est. 3.8%, prior 3.4%), the highest since June 2022.

Core CPI: 2.6%
Services inflation: 3.4% https://t.co/Example123'''


class MacroSourceTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden'))
            guard.start()
            self.addCleanup(guard.stop)

    def rejects(self, text, reason):
        with self.assertRaisesRegex(macro.MacroSourceError, '^' + reason + '$'):
            macro.parse(text)

    def test_jobs_binds_all_seven_metrics_and_retains_source_whitespace(self):
        report = macro.parse(JOBS)
        self.assertEqual(len(report.metrics), 7)
        self.assertEqual(report.body, JOBS)
        self.assertEqual(report.body_sha, hashlib.sha256(JOBS.encode()).hexdigest())
        self.assertEqual([x.key for x in report.metrics], [x[0] for x in macro.JOBS])
        self.assertTrue(all(x.period.month == 8 and x.period.year is None for x in report.metrics))
        self.assertEqual([x.period.basis for x in report.metrics], [None, None, 'YoY', None, None, None, None])
        for metric in report.metrics:
            for value in (metric.actual, metric.estimate, metric.prior):
                if value:
                    self.assertEqual(JOBS[value.evidence.start:value.evidence.end], value.literal)
            self.assertEqual(JOBS[metric.evidence.start:metric.evidence.end], metric.evidence.quote)
        self.assertEqual(report.metrics[-1].actual.number, '-17')
        self.assertEqual(report.metrics[-1].prior.number, '+45')
        self.assertIsNone(report.metrics[-1].estimate)
        self.assertEqual(report.metrics[-2].estimate.unit, 'HOURS')

    def test_jobs_copy_is_detailed_source_attributed_without_inferred_dates(self):
        copy = macro.derive(JOBS)
        self.assertEqual(set(copy), {'titleJa', 'titleEn', 'bodyJa', 'bodyEn'})
        self.assertEqual(copy['titleJa'], '米8月雇用統計：非農業部門雇用者数+31,000人')
        self.assertEqual(copy['titleEn'], 'U.S. August nonfarm payrolls +31K')
        self.assertTrue(copy['bodyJa'].startswith('報道によると、'))
        self.assertTrue(copy['bodyEn'].startswith('The report'))
        self.assertIn('政府部門雇用者数：実績 -17,000人、前回 +45,000人。', copy['bodyJa'])
        self.assertIn('Government payrolls: actual -17K; prior +45K.', copy['bodyEn'])
        self.assertIn('実績 34.6時間、予想 34.5時間', copy['bodyJa'])
        self.assertNotIn('previous month', copy['bodyEn'])
        self.assertNotIn('2026', str(copy))
        self.assertNotIn('seasonally', str(copy))
        self.assertNotIn('08:30', str(copy))
        self.assertEqual(macro.validate_rendered(JOBS, copy), copy)

    def test_japanese_payroll_conversion_is_integral_exact_and_never_rounded(self):
        for number, expected in [('+1.234', '+1,234人'), ('-0.001', '-1人'),
                                 ('+1.23400', '+1,234人'), ('+0', '+0人'),
                                 ('+123456789012345678901234567890.001',
                                  '+123,456,789,012,345,678,901,234,567,890,001人')]:
            with self.subTest(number=number):
                body = JOBS.replace('+31K', number + 'K')
                self.assertIn(expected, macro.derive(body)['titleJa'])
                self.assertIn(number + 'K', macro.derive(body)['titleEn'])
        for number in ('+1.2341', '-0.0001', '+0.000000001'):
            self.rejects(JOBS.replace('+31K', number + 'K'), 'invalid-macro-value')
            self.rejects(JOBS.replace('+95K', number + 'K'), 'invalid-macro-value')
            self.rejects(JOBS.replace('+45K', number + 'K'), 'invalid-macro-value')

    def test_cpi_preserves_roles_and_highest_since_only_for_headline_metric(self):
        report = macro.parse(CPI)
        main, core, services = report.metrics
        self.assertEqual((main.actual.number, main.estimate.number, main.prior.number), ('3.9', '3.8', '3.4'))
        self.assertEqual((main.period.month, main.period.year, main.period.basis), (8, None, 'YoY'))
        self.assertEqual((core.period, services.period), (macro.Period(), macro.Period()))
        self.assertEqual(report.historical_high.metric, 'cpi')
        self.assertEqual((report.historical_high.month, report.historical_high.year), (6, 2022))
        self.assertEqual(report.trailing_url.quote, 'https://t.co/Example123')
        copy = macro.render(report)
        self.assertIn('estimate of 3.8% and a prior reading of 3.4%', copy['bodyEn'])
        self.assertIn('highest reading since June 2022', copy['bodyEn'])
        self.assertIn('2022年6月以来の最高水準', copy['bodyJa'])
        self.assertEqual(copy['bodyEn'].count('year-over-year'), 1)
        self.assertNotIn('https://', str(copy))

    def test_comparisons_may_inherit_only_their_own_explicit_actual_unit(self):
        text = JOBS.replace('34.5 HOURS', '34.5')
        report = macro.parse(text)
        workweek = report.metrics[-2]
        self.assertEqual(workweek.estimate.unit, 'HOURS')
        self.assertEqual(workweek.estimate.literal, '34.5')
        self.assertEqual(workweek.estimate.unit_provenance, 'same-cell-explicit-actual-unit')
        self.assertEqual(workweek.estimate.unit_evidence, workweek.actual.unit_evidence)
        self.assertEqual(workweek.estimate.unit_evidence.quote, 'HOURS')
        self.assertEqual(macro.render(report), macro.derive(JOBS))
        for text in (JOBS.replace('+95K', '+95'), JOBS.replace('+45K', '+45'),
                     CPI.replace('est. 3.8%', 'est. 3.8'), CPI.replace('prior 3.4%', 'prior 3.4')):
            self.assertIsNotNone(macro.parse(text))
        for text in (JOBS.replace('34.6 HOURS, (Est. 34.5 HOURS)', '34.6, (Est. 34.5)'),
                     JOBS.replace('+31K, (Est. +95K)', '+31, (Est. +95)'),
                     CPI.replace('Core CPI: 2.6%', 'Core CPI: 2.6'),
                     CPI.replace('rose 3.9%', 'rose 3.9')):
            # Other rows/cells cannot supply the missing unit. Actuals remain
            # explicit even if their estimate happens to carry a unit.
            self.rejects(text, 'missing-macro-unit')
        for text in (JOBS.replace('+95K', '+95%'), JOBS.replace('34.5 HOURS', '34.5%'),
                     CPI.replace('prior 3.4%', 'prior 3.4K')):
            self.rejects(text, 'changed-macro-unit')

    def test_actual_units_and_payroll_signs_are_not_assumed(self):
        self.rejects(JOBS.replace('+31K,', '+31,'), 'missing-macro-unit')
        self.rejects(JOBS.replace('+31K,', '31K,'), 'missing-macro-sign')
        self.rejects(JOBS.replace('+45K)', '45K)'), 'missing-macro-sign')
        self.rejects(CPI.replace('rose 3.9%', 'rose -3.9%'), 'invalid-macro-value')

    def test_full_coverage_and_known_metric_identity_are_required(self):
        self.rejects(JOBS + '\nNFP +88K, (Est. +90K)', 'unsupported-macro-tail')
        self.rejects(JOBS + '\nNONFARM PAYROLLS +31K, (Est. +95K)', 'duplicate-macro-metric')
        self.rejects(JOBS + '\nNONFARM PAYROLLS -31K, (Est. +95K)', 'duplicate-macro-metric')
        self.rejects(JOBS.rsplit('\n', 1)[0], 'incomplete-macro-report')
        self.rejects(CPI.replace('Core CPI: 2.6%', 'Core CPI: 2.6%\nCore CPI: 9.2%'), 'duplicate-macro-metric')
        self.rejects(CPI.replace('Core CPI: 2.6%\n', ''), 'incomplete-macro-report')

    def test_roles_cannot_be_reinterpreted_or_shifted_across_rows(self):
        self.rejects(JOBS.replace('(Est. +95K)', '(Prev. +95K)'), 'changed-macro-role')
        self.rejects(JOBS.replace('(Prev. +45K)', '(Est. +45K)'), 'changed-macro-role')
        self.rejects(CPI.replace('(est. 3.8%, prior 3.4%)', '(prior 3.8%, est. 3.4%)'), 'unsupported-macro-format')
        self.rejects(JOBS.replace('NONFARM PAYROLLS +31K,', 'NONFARM PAYROLLS Est. +31K,'), 'invalid-macro-value')

    def test_calendar_timezone_unknown_tail_or_predicate_stays_private(self):
        examples = [
            'Today’s economic calendar (All EST)\n8:30 Nonfarm payrolls\nFed’s Logan',
            JOBS.replace('JOBS REPORT 👇', 'JOBS REPORT 08:30 EST'),
            JOBS + '\nAll EST', JOBS + '\nRecession is guaranteed.',
            CPI.replace('Core CPI: 2.6%', 'Core CPI: 2.6% YoY'),
            CPI + '\nAll EST', CPI + ' because energy prices rose.',
            CPI.replace('rose', 'will rise'), CPI.replace('YoY', 'annualized'),
        ]
        for text in examples:
            with self.subTest(text=text):
                with self.assertRaises(macro.MacroSourceError):
                    macro.parse(text)

    def test_ambiguous_comparisons_and_unsupported_number_grammar_reject(self):
        for replacement in ('+9,5K', '+95K to +99K', '+95K; +96K', '+95K (revised)', '+95K est.'):
            with self.subTest(replacement=replacement):
                with self.assertRaises(macro.MacroSourceError):
                    macro.parse(JOBS.replace('+95K', replacement))
        for text in (CPI.replace('est. 3.8%,', 'est. 3.8%, est. 3.7%,'),
                     CPI.replace('since June 2022.', 'since June 2022, excluding 2024.'),
                     CPI.replace('https://t.co/Example123', 'https://example.com/data')):
            with self.assertRaises(macro.MacroSourceError):
                macro.parse(text)

    def test_type_mutations_cannot_borrow_validity_from_other_fields(self):
        report = macro.parse(JOBS)
        first = report.metrics[0]
        mutations = [
            replace(first, actual=first.estimate, estimate=first.actual),
            replace(first, actual=replace(first.actual, number='-31')),
            replace(first, actual=replace(first.actual, unit='%')),
            replace(first, period=replace(first.period, year=2026)),
        ]
        for metric in mutations:
            with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
                macro.render(replace(report, metrics=(metric, *report.metrics[1:])))
        cpi = macro.parse(CPI)
        with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
            macro.render(replace(cpi, historical_high=replace(cpi.historical_high, metric='core-cpi')))

    def test_implicit_unit_proof_cannot_be_taken_from_another_cell(self):
        report = macro.parse(JOBS.replace('34.5 HOURS', '34.5'))
        workweek = report.metrics[-2]
        changed = replace(workweek, estimate=replace(workweek.estimate,
            unit_evidence=report.metrics[1].actual.unit_evidence))
        with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
            macro.render(replace(report, metrics=(*report.metrics[:-2], changed, report.metrics[-1])))
        self.assertEqual(workweek.period.basis, None)
        self.assertEqual(report.metrics[2].period.basis, 'YoY')

    def test_headline_cpi_period_cannot_be_transferred_to_unqualified_submetrics(self):
        report = macro.parse(CPI)
        main, core, services = report.metrics
        with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
            macro.render(replace(report, metrics=(main, replace(core, period=main.period), services)))
        copy = macro.render(report)
        copy['bodyEn'] = copy['bodyEn'].replace('core CPI at 2.6%', 'core CPI at 2.6% year-over-year')
        with self.assertRaisesRegex(macro.MacroSourceError, '^changed-macro-copy$'):
            macro.validate_rendered(CPI, copy)

    def test_boolean_and_float_fields_never_equal_integer_source_bindings(self):
        report = macro.parse(' ' + JOBS.replace('AUGUST', 'JANUARY'))
        self.assertEqual(report.month, 1)
        self.assertEqual(report.header.start, 1)
        for value in (True, 1.0):
            with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
                macro.render(replace(report, month=value))
            with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
                macro.render(replace(report, header=replace(report.header, start=value)))
            first = report.metrics[0]
            with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
                macro.render(replace(report, metrics=(replace(first, period=replace(first.period, month=value)), *report.metrics[1:])))
        for evidence_field in ('start', 'end'):
            first = report.metrics[0]
            original = first.actual.evidence
            changed = replace(original, **{evidence_field: float(getattr(original, evidence_field))})
            with self.assertRaisesRegex(macro.MacroSourceError, '^invalid-macro-binding$'):
                macro.render(replace(report, metrics=(replace(first, actual=replace(first.actual, evidence=changed)), *report.metrics[1:])))

    def test_entire_rendered_copy_must_equal_fresh_source_derivation(self):
        original = macro.derive(JOBS)
        replacements = [('actual +31K; estimate +95K', 'actual +95K; estimate +31K'),
                        ('actual -17K', 'actual +17K'), ('prior +45K', 'estimate +45K')]
        for old, new in replacements:
            copy = deepcopy(original)
            copy['bodyEn'] = copy['bodyEn'].replace(old, new)
            self.assertNotEqual(copy, original)
            with self.assertRaisesRegex(macro.MacroSourceError, '^changed-macro-copy$'):
                macro.validate_rendered(JOBS, copy)
        for copy in ({**original, 'approval': True}, {k: v for k, v in original.items() if k != 'bodyJa'},
                     {**original, 'bodyJa': original['bodyJa'] + '不況が確実になった。'}):
            with self.assertRaises(macro.MacroSourceError):
                macro.validate_rendered(JOBS, copy)

    def test_recognized_layout_does_not_change_values_or_allow_extra_content(self):
        report = macro.parse(JOBS.replace('\n', '\r\n') + '\nhttps://t.co/Jobs123\n')
        self.assertEqual(len(report.metrics), 7)
        self.assertEqual(macro.render(report), macro.derive(JOBS))
        for value in ('', None, '\x00' + JOBS, JOBS + '\n' + 'x' * macro.MAX_INPUT):
            with self.assertRaises(macro.MacroSourceError):
                macro.parse(value)


if __name__ == '__main__':
    unittest.main()
