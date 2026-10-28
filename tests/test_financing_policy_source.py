"""Minimal synthetic grammar fixtures; real retained posts are kept out of Git."""
from copy import deepcopy
from dataclasses import replace
import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import financing_policy_source as grammar

# Changed quantities and a synthetic link; no event IDs, publisher or live URLs.
FINANCE = ('Broadcom $AVGO is assembling roughly $8B of financing to help Anthropic '
           'and other AI customers fund chip &amp; infrastructure purchases\n\n'
           'The package includes:\n$5B senior-secured debt  \n'
           '$3B junior debt led by Blackstone\n\n'
           '$BX is expected to commit $1B itself &amp; syndicate the rest https://t.co/Test123')
POLICY = ('WHITE HOUSE HASSETT: \n\nTHIS JOBS REPORT WAS ABOUT EXPECTED\n\n'
          'PRESIDENT IS COMMITTED TO CUTTING THE DEFICIT\n\n'
          'WE DO NOT WANT TO INFLATE OUR WAY OUT OF DEBT')


class FinancingPolicyTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden'))
            guard.start()
            self.addCleanup(guard.stop)

    def rejects(self, text):
        with self.assertRaisesRegex(grammar.FinancingPolicyError, '^' + grammar.UNSUPPORTED + '$'):
            grammar.parse(text)

    def rejects_binding(self, report):
        with self.assertRaisesRegex(grammar.FinancingPolicyError, '^invalid-financing-policy-binding$'):
            grammar.render(report)

    def rejects_copy(self, body, value):
        with self.assertRaisesRegex(grammar.FinancingPolicyError, '^changed-financing-policy-copy$'):
            grammar.validate_rendered(body, value)

    def test_full_finance_roles_and_unknowns(self):
        report = grammar.parse(FINANCE)
        self.assertEqual(report.body, FINANCE)
        self.assertEqual(report.body_sha, hashlib.sha256(FINANCE.encode()).hexdigest())
        self.assertEqual(report.assembly.actor.literal, 'Broadcom')
        self.assertEqual(report.assembly.modality, 'assembling')
        self.assertEqual(report.arranger_ticker.quote, '$AVGO')
        self.assertEqual([x.literal for x in report.beneficiaries], ['Anthropic', 'other AI customers'])
        self.assertEqual([x.quote for x in report.purchase_objects], ['chip', 'infrastructure'])
        self.assertEqual(report.total.role, 'package-total')
        self.assertTrue(report.total.approximate)
        self.assertEqual(report.total.approximation_evidence.quote, 'roughly')
        self.assertEqual(report.package.actor.literal, 'The package')
        self.assertEqual(report.package.context, (report.assembly.evidence,))
        senior, junior = report.components
        self.assertEqual((senior.amount.billion_usd, senior.seniority, senior.security, senior.leader), ('5', 'senior', 'secured', None))
        self.assertEqual((junior.amount.billion_usd, junior.seniority, junior.security, junior.leader.literal), ('3', 'junior', None, 'Blackstone'))
        p = report.participation
        self.assertEqual(p.commitment.actor.literal, '$BX')
        self.assertIsNone(p.commitment.actor.resolved_identity)
        self.assertEqual(p.amount.role, 'expected-own-commitment')
        self.assertEqual((p.commitment.modality, p.syndication.modality), ('expected', 'expected'))
        self.assertEqual(p.commitment.actor, p.syndication.actor)
        self.assertEqual(p.commitment.evidence, p.syndication.evidence)
        self.assertEqual(p.remainder_evidence.quote, 'the rest')
        for value in (p.remainder_amount, p.remainder_denominator, p.commitment_tranche, p.commitment_instrument, p.completed):
            self.assertIsNone(value)

    def test_finance_copy_and_exact_scaling(self):
        copy = grammar.derive(FINANCE)
        self.assertEqual(len(copy['facts']), 3)
        self.assertIn('約80億ドル', copy['titleJa'])
        self.assertIn('about $8 billion', copy['facts'][0]['en'])
        self.assertIn('50億ドルの担保付きシニア債務', copy['facts'][1]['ja'])
        self.assertIn('30億ドルのジュニア債務', copy['facts'][1]['ja'])
        self.assertIn('$BXは10億ドルの拠出に自らコミット', copy['facts'][2]['ja'])
        self.assertIn('is expected to commit $1 billion itself and syndicate the rest', copy['facts'][2]['en'])
        self.assertTrue(all(f['en'].startswith('The report says') for f in copy['facts']))
        self.assertNotIn('equity', str(copy))
        self.assertEqual(grammar.validate_rendered(FINANCE, copy), copy)

    def test_each_amount_is_independent_not_arithmetic_admission(self):
        for token, field, expected in [('$8B', 0, '12.34'), ('$5B', 1, '12.34'), ('$3B', 1, '12.34'), ('$1B', 2, '12.34')]:
            body = FINANCE.replace(token, '$12.34B')
            copy = grammar.derive(body)
            self.assertIn('$12.34 billion', copy['facts'][field]['en'])
            self.assertIn('123.4億ドル', copy['facts'][field]['ja'])
            p = grammar.parse(body).participation
            self.assertIsNone(p.remainder_amount)
            self.assertIsNone(p.remainder_denominator)
            self.assertIsNone(p.commitment_tranche)
        # Coincidence with the junior amount, total, or zero never resolves scope.
        for number in ('3', '8', '0', '999999.999', '0.001', '1.000'):
            r = grammar.parse(FINANCE.replace('$1B', '$' + number + 'B'))
            self.assertIsNone(r.participation.remainder_amount)
            self.assertIsNone(r.participation.commitment_tranche)
        self.assertIn('0.01億ドル', grammar.derive(FINANCE.replace('$1B', '$0.001B'))['facts'][2]['ja'])
        self.assertIn('9999999.99億ドル', grammar.derive(FINANCE.replace('$1B', '$999999.999B'))['facts'][2]['ja'])

    def test_policy_header_is_shared_context_not_fourth_fact(self):
        report = grammar.parse(POLICY)
        copy = grammar.render(report)
        self.assertEqual(len(report.claims), 3)
        self.assertEqual(len(copy['facts']), 3)
        self.assertEqual(report.header.quote, 'WHITE HOUSE HASSETT: ')
        self.assertEqual(report.speaker.literal, 'WHITE HOUSE HASSETT')
        self.assertIsNone(report.speaker.full_name)
        self.assertIsNone(report.speaker.official_title)
        self.assertTrue(all(c.context == (report.header,) for c in report.claims))
        self.assertEqual(len(copy['contextOnly']), 1)
        self.assertTrue(all(f['contextEvidence'] == copy['contextOnly'] for f in copy['facts']))
        self.assertEqual(copy['titleEvidence'], [copy['contextOnly'][0], copy['facts'][0]['claimEvidence']])

    def test_policy_predicates_tense_modality_polarity_and_unresolved_we(self):
        r = grammar.parse(POLICY)
        assessment, commitment, desire = r.claims
        self.assertEqual((assessment.actor.literal, assessment.tense, r.expectation_match), ('THIS JOBS REPORT', 'past', 'approximate'))
        self.assertEqual((commitment.actor.literal, commitment.modality), ('PRESIDENT', 'committed'))
        self.assertEqual((desire.actor.literal, desire.actor.kind, desire.polarity, desire.modality), ('WE', 'unresolved-first-person-plural', 'negative', 'desire'))
        self.assertIsNone(desire.actor.resolved_identity)
        self.assertIsNone(r.deficit_reduction_completed)
        self.assertIsNone(r.inflation_forecast)
        self.assertIsNone(r.prohibition_or_impossibility)
        copy = grammar.render(r)
        self.assertIn('おおむね予想通りだった', copy['facts'][0]['ja'])
        self.assertIn('broadly in line with expectations', copy['facts'][0]['en'])
        self.assertIn('Hassett said the president is committed', copy['facts'][1]['en'])
        self.assertIn('“We do not want', copy['facts'][2]['en'])
        self.assertIn('「我々はインフレで債務から抜け出すことを望んでいない」', copy['facts'][2]['ja'])
        self.assertTrue(all('ホワイトハウスのハセット氏' in f['ja'] for f in copy['facts']))

    def test_all_evidence_spans_are_exact_and_formatting_is_consumed(self):
        for body in (FINANCE, POLICY, '\t' + FINANCE + '\n', POLICY.replace('\n', '\r\n') + ' https://t.co/Synthetic'):
            copy = grammar.derive(body)
            spans = copy['titleEvidence'] + copy['contextOnly']
            for fact in copy['facts']:
                spans += [fact['claimEvidence']] + fact['contextEvidence']
            if copy['trailingUrl']:
                spans.append(copy['trailingUrl'])
            self.assertTrue(all(body[e['start']:e['end']] == e['quote'] for e in spans))
            self.assertEqual(grammar.validate_rendered(body, copy), copy)
        self.assertEqual(grammar.parse(FINANCE).trailing_url.quote, 'https://t.co/Test123')

    def test_url_has_no_semantic_authority(self):
        a = grammar.derive(FINANCE)
        b = grammar.derive(FINANCE.replace('Test123', 'Any456'))
        for key in ('titleJa', 'titleEn', 'facts', 'kind'):
            self.assertEqual(a[key], b[key])
        self.assertIsNone(grammar.parse(FINANCE.split(' https://')[0]).trailing_url)
        for suffix in (' https://example.com/report', ' https://t.co/A more facts', ' https://t.co/A https://t.co/B',
                       ' https://t.co/A?completed=true', ' https://t.co/', ' https://t.co/A#fact'):
            self.rejects(POLICY + suffix)
        self.rejects('Unrecognized report https://t.co/Test123')

    def test_finance_source_counterexamples_are_unsupported(self):
        replacements = [
            ('is assembling', 'has completed'), ('is assembling', 'has signed'),
            ('is assembling', 'has guaranteed'), ('is expected to', 'plans to'),
            ('is expected to', 'has already'), ('commit', 'invest in equity'),
            ('commit', 'purchase shares with'), ('Broadcom $AVGO', 'Anthropic $AVGO'),
            ('Broadcom $AVGO', 'Blackstone $AVGO'), ('Broadcom $AVGO', '$BX $AVGO'),
            ('Broadcom $AVGO', 'Unknown $AVGO'), ('Anthropic and', 'Unknown and'),
            ('Blackstone', 'Unknown'), ('senior-secured', 'senior'),
            ('junior debt', 'junior-secured debt'), ('junior debt', 'junior unsecured debt'),
            ('roughly ', ''), ('$BX is expected', 'Blackstone is expected'),
            ('the rest', '$7B'), ('the rest', '$1B'),
            ('commit $1B itself', 'commit $1B itself to the junior tranche'),
            ('syndicate the rest', 'has syndicated the rest'),
            ('is expected to commit $1B itself', 'has committed $1B itself'),
            ('The package includes:', 'The guaranteed package includes:'),
            ('chip &amp; infrastructure', 'chip & infrastructure'),
            ('purchases', 'purchases as borrower'), ('purchases', 'purchases as guarantor'),
        ]
        for old, new in replacements:
            with self.subTest(new=new):
                self.rejects(FINANCE.replace(old, new))
        for amount in ('$1-2B', '$1M', '$01B', '$-1B', '$1,000B', '$1.0001B', '$1000000B', '$1e2B'):
            self.rejects(FINANCE.replace('$1B', amount))

    def test_policy_source_counterexamples_are_unsupported(self):
        replacements = [
            ('WHITE HOUSE HASSETT:', 'PRESIDENT:'), ('HASSETT:', 'KEVIN HASSETT:'),
            ('HASSETT:', 'ADVISER HASSETT:'), ('HASSETT:', 'SOMEONE:'),
            ('WAS ABOUT EXPECTED', 'WAS EXPECTED'), ('WAS ABOUT EXPECTED', 'WILL BE ABOUT EXPECTED'),
            ('THIS JOBS REPORT', 'SEPTEMBER JOBS REPORT'), ('THIS JOBS REPORT', 'THIS 100K JOBS REPORT'),
            ('IS COMMITTED TO CUTTING', 'HAS CUT'), ('IS COMMITTED TO CUTTING', 'HAS SIGNED AN AGREEMENT TO CUT'),
            ('CUTTING THE DEFICIT', 'FUNDING THE DEFICIT'),
            ('DO NOT WANT', 'DO WANT'), ('DO NOT WANT', 'WANT NOT'),
            ('DO NOT WANT', 'CANNOT'), ('DO NOT WANT', 'MUST NOT'),
            ('WE DO', 'THE ADMINISTRATION DOES'), ('INFLATE OUR WAY OUT OF DEBT', 'CANCEL DEBT'),
            ('INFLATE OUR WAY OUT OF DEBT', 'DEFAULT ON DEBT'),
            ('\n\nPRESIDENT', '\n\nTREASURY SECRETARY:\n\nPRESIDENT'),
        ]
        for old, new in replacements:
            with self.subTest(new=new):
                self.rejects(POLICY.replace(old, new))
        for start, end in [(POLICY.index('THIS'), POLICY.index('PRESIDENT')),
                           (POLICY.index('PRESIDENT'), POLICY.index('WE DO'))]:
            self.rejects(POLICY[:start] + POLICY[end:])
        self.rejects(POLICY.rsplit('\n\n', 1)[0])
        self.rejects(POLICY.split('\n\n', 1)[1])

    def test_extra_unknown_duplicate_prefix_and_tail_fail_closed(self):
        for body in (FINANCE, POLICY):
            for extra in ('\nUnknown further claim.', '\nAPPROVED', '\nAll EST', '\n' + body, '\u200b', '\x00'):
                self.rejects(body + extra)
                self.rejects(extra + body)
        for value in (None, '', 7, b'bytes', 'x' * 2401):
            self.rejects(value)

    def test_finance_typed_mutations_reject_unsupported_inferences(self):
        r = grammar.parse(FINANCE)
        p = r.participation
        mutations = [
            replace(r, assembly=replace(r.assembly, modality='completed')),
            replace(r, assembly=replace(r.assembly, actor=r.beneficiaries[0])),
            replace(r, components=tuple(reversed(r.components))),
            replace(r, total=replace(r.total, approximate=False)),
            replace(r, components=(r.components[0], replace(r.components[1], security='unsecured'))),
            replace(r, components=(r.components[0], replace(r.components[1], security='secured'))),
            replace(r, participation=replace(p, commitment=replace(p.commitment, actor=replace(p.commitment.actor, resolved_identity='Blackstone')))),
            replace(r, participation=replace(p, remainder_amount='7')),
            replace(r, participation=replace(p, remainder_amount='1')),
            replace(r, participation=replace(p, remainder_denominator='junior-debt')),
            replace(r, participation=replace(p, commitment_tranche='junior')),
            replace(r, participation=replace(p, commitment_instrument='equity')),
            replace(r, participation=replace(p, completed=True)),
            replace(r, participation=replace(p, commitment=replace(p.commitment, modality='planned'))),
            replace(r, participation=replace(p, syndication=replace(p.syndication, modality='completed'))),
        ]
        for changed in mutations:
            self.rejects_binding(changed)

    def test_policy_typed_mutations_reject_scope_and_predicate_changes(self):
        r = grammar.parse(POLICY)
        for changed in [replace(r, speaker=replace(r.speaker, full_name='Kevin Hassett')),
                        replace(r, speaker=replace(r.speaker, official_title='Adviser')),
                        replace(r, expectation_match='exact'),
                        replace(r, deficit_reduction_completed=True),
                        replace(r, inflation_forecast='falling'),
                        replace(r, prohibition_or_impossibility='prohibited'),
                        replace(r, claims=tuple(reversed(r.claims))),
                        replace(r, claims=r.claims[:2])]:
            self.rejects_binding(changed)
        for index, changes in [(0, {'tense': 'future'}), (1, {'modality': 'completed'}),
                               (2, {'polarity': 'positive'}), (2, {'modality': 'impossible'})]:
            claims = list(r.claims)
            claims[index] = replace(claims[index], **changes)
            self.rejects_binding(replace(r, claims=tuple(claims)))
        for index in range(3):
            claims = list(r.claims)
            claims[index] = replace(claims[index], context=())
            self.rejects_binding(replace(r, claims=tuple(claims)))
        claims = list(r.claims)
        claims[2] = replace(claims[2], actor=replace(claims[2].actor, resolved_identity='White House'))
        self.rejects_binding(replace(r, claims=tuple(claims)))

    def test_exact_binding_evidence_hash_body_and_type_proof(self):
        for body in (FINANCE, POLICY):
            r = grammar.parse(body)
            self.rejects_binding(replace(r, body_sha='0' * 64))
            self.rejects_binding(replace(r, body=body + '\n'))
            self.rejects_binding(replace(r, body=body + '\nunknown'))
            copy = grammar.render(r)
            for field in ('bodySha', 'grammarVersion', 'kind', 'titleEvidence', 'trailingUrl'):
                bad = deepcopy(copy)
                bad[field] = 'tampered'
                self.rejects_copy(body, bad)
            for numeric in (True, 1.0):
                bad = deepcopy(copy)
                bad['grammarVersion'] = numeric
                self.rejects_copy(body, bad)
            bad = deepcopy(copy)
            bad['facts'][0]['claimEvidence']['quote'] += '.'
            self.rejects_copy(body, bad)
            bad = deepcopy(copy)
            bad['facts'][0]['claimEvidence']['start'] = float(bad['facts'][0]['claimEvidence']['start'])
            self.rejects_copy(body, bad)
            self.rejects_copy(body + '\n', copy)
        r = grammar.parse(FINANCE)
        self.rejects_binding(replace(r, total=replace(r.total, approximate=1)))
        self.rejects_binding(replace(r, total=replace(r.total, evidence=replace(r.total.evidence, start=float(r.total.evidence.start)))))
        self.rejects_binding(None)

    def test_finance_copy_counterexamples_reject_exactly(self):
        original = grammar.derive(FINANCE)
        changes = [(0, 'ja', '組成している', '調達を完了した'),
                   (0, 'ja', '約80億ドル', '80億ドル'),
                   (0, 'ja', '約80億ドル', '約8億ドル'),
                   (0, 'en', 'Broadcom', 'Anthropic'),
                   (1, 'en', '$5 billion', '$3 billion'),
                   (1, 'en', 'junior debt', 'unsecured junior debt'),
                   (1, 'en', 'junior debt', 'secured junior debt'),
                   (1, 'en', 'senior-secured', 'senior'),
                   (2, 'en', '$BX', 'Blackstone'),
                   (2, 'en', 'commit', 'invest in equity'),
                   (2, 'en', 'is expected to', 'plans to'),
                   (2, 'en', 'is expected to', 'has already'),
                   (2, 'en', 'the rest', '$7 billion'),
                   (2, 'en', 'the rest', '$1 billion'),
                   (2, 'en', 'itself', 'itself to the junior tranche'),
                   (2, 'en', 'and syndicate', 'and has syndicated'),
                   (0, 'en', 'The report says', 'Broadcom confirmed')]
        for index, language, old, new in changes:
            bad = deepcopy(original)
            bad['facts'][index][language] = bad['facts'][index][language].replace(old, new)
            self.assertNotEqual(bad, original)
            self.rejects_copy(FINANCE, bad)

    def test_policy_copy_counterexamples_reject_exactly(self):
        original = grammar.derive(POLICY)
        changes = [(0, 'ja', 'おおむね', ''), (0, 'en', 'characterized', 'forecast'),
                   (0, 'en', 'this jobs report', 'the September jobs report of 100,000 jobs'),
                   (1, 'en', 'Hassett said the president', 'president said he'),
                   (1, 'en', 'is committed to reducing', 'has reduced'),
                   (1, 'en', 'is committed to reducing', 'signed an agreement to reduce'),
                   (2, 'en', 'Hassett', 'Kevin Hassett'),
                   (2, 'en', 'Hassett', 'economic adviser Hassett'),
                   (2, 'en', 'We do not want', 'We want'),
                   (2, 'en', 'We do not want', 'We cannot'),
                   (2, 'en', 'We do not want', 'The White House does not want'),
                   (2, 'en', 'inflate our way out of debt', 'cancel debt'),
                   (2, 'en', 'inflate our way out of debt', 'default on debt')]
        for index, language, old, new in changes:
            bad = deepcopy(original)
            bad['facts'][index][language] = bad['facts'][index][language].replace(old, new)
            self.assertNotEqual(bad, original)
            self.rejects_copy(POLICY, bad)
        for action in ('fourth-fact', 'drop-fact', 'drop-context', 'context-first-only', 'swap-claims'):
            bad = deepcopy(original)
            if action == 'fourth-fact':
                bad['facts'].append({'ja': 'ホワイトハウスのハセット氏', 'en': 'White House Hassett'})
            elif action == 'drop-fact':
                bad['facts'].pop()
            elif action == 'drop-context':
                bad['contextOnly'] = []
            elif action == 'context-first-only':
                bad['facts'][1]['contextEvidence'] = []
                bad['facts'][2]['contextEvidence'] = []
            else:
                bad['facts'][0], bad['facts'][1] = bad['facts'][1], bad['facts'][0]
            self.rejects_copy(POLICY, bad)

    def test_only_policy_adapter_imports_closed_grammars(self):
        root = Path(__file__).resolve().parents[1]
        name = 'financing_policy_source'
        callers = [str(p.relative_to(root)) for p in (root / 'scripts').rglob('*.py')
                   if p.name != name + '.py' and name in p.read_text()]
        self.assertEqual(callers, ['scripts/research/attributed_policy_publication.py'])


if __name__ == '__main__':
    unittest.main()
