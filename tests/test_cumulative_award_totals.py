"""Synthetic regression and adversarial bounds for an awards-total paraphrase."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import amount_relations as amounts
import factual_validation as factual
import official_research as research


FIXTURE = Path(__file__).parent / 'fixtures/cumulative-award-minimal.json'


class CumulativeAwardTests(unittest.TestCase):
    def fixture(self):
        value = json.loads(FIXTURE.read_text())
        self.assertEqual(hashlib.sha256(value['body'].encode()).hexdigest(), value['bodySha'])
        self.assertEqual(value['kind'], 'synthetic-minimal-reproducer')
        self.assertLess(len(value['body']), 1000)
        for note in value['notes'].values():
            for item in [note['title'], note['summary'], *note['facts'], note['purpose']]:
                start, end = item.pop('evidenceRange')
                item['evidenceQuote'] = value['body'][start:end]
                self.assertTrue(16 <= len(item['evidenceQuote']) <= research.MAX_EVIDENCE_CHARS)
        return value

    def test_synthetic_saved_copy_validates_without_rewriting_fields(self):
        value = self.fixture()
        note = value['notes']['saved']
        before = copy.deepcopy(note)
        research.validate(note, value['body'], value['title'])
        self.assertEqual(note, before)
        fact = note['facts'][2]
        self.assertIn('totaling $4.2 million', fact['evidenceQuote'])
        self.assertIn('since 2022 to date', fact['evidenceQuote'])
        self.assertEqual(factual.number_checks(fact), [])

    def test_synthetic_rejected_draft_stays_rejected_and_is_not_rewritten(self):
        value = self.fixture()
        note = value['notes']['failed']
        before = copy.deepcopy(note)
        self.assertIn('800時間以上', note['facts'][1]['ja'])
        self.assertIn('over 800', note['facts'][1]['en'])
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            research.validate(note, value['body'], value['title'])
        self.assertEqual(note, before)

    def test_completed_cumulative_awards_can_paraphrase_an_explicit_total(self):
        for predicate in ('provided', 'awarded', 'disbursed', 'donated'):
            for noun in ('bursaries', 'scholarships', 'grants', 'financial aid'):
                source = f'The company has {predicate} comprehensive {noun} totaling $8.7 million since 2020.'
                text = f'Since 2020, the company has {predicate} $8.7 million in {noun}.'
                with self.subTest(text=text):
                    amounts.validate_amount_relations(text, source)
        factual.validate_pair('会社は2020年以降、合計870万ドルの奨学金を提供した。',
                              'Since 2020, the company has provided $8.7 million in bursaries.')

    def test_implicit_phrase_does_not_create_new_source_requirements(self):
        source = 'Since 2020, the company has provided $8.7 million in bursaries.'
        self.assertEqual(amounts.monetary_relations(source), set())
        amounts.validate_amount_relations('The company provided $8.7 million in bursaries.', source)

    def test_increment_remaining_currency_and_magnitudes_remain_guarded(self):
        cumulative = 'Since 2020, the company has provided $8.7 million in bursaries.'
        for source in ('The company provided an additional $8.7 million.',
                       'The company increased funding by $8.7 million.',
                       'The company provided grants totaling EUR8.7 million.'):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                amounts.validate_amount_relations(cumulative, source)
        for text, source in (
            ('The company increased authorization to $150 billion.', 'The company approved an additional $150 billion.'),
            ('The company approved an additional $235 billion.', 'The company has $235 billion in remaining capacity.'),
            ('The company approved an additional $8.7 million.', 'The company provided grants totaling $8.7 million.'),
        ):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                amounts.validate_amount_relations(text, source)
        for wrong in ('Since 2020, the company has provided $87 million in bursaries.',
                      'Since 2021, the company has provided $8.7 million in bursaries.'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                factual.validate_numbers(wrong, cumulative)


    def test_source_total_requires_matching_completed_award_period_and_kind(self):
        output = 'Since 2020, GE Vernova has provided $8.7 million in bursaries.'
        bad_sources = (
            'Since 2020, GE Vernova plans future bursaries totaling $8.7 million.',
            'Since 2020, GE Vernova has a remaining budget totaling $8.7 million.',
            'Since 2020, GE Vernova has provided annual bursaries totaling $8.7 million.',
            'Since 2020, GE Vernova has not provided bursaries totaling $8.7 million.',
            'Since 2021, GE Vernova has provided bursaries totaling $8.7 million. It was founded in 2020.',
            'GE Vernova has operated since 2020 while another organization has provided bursaries totaling $8.7 million.',
            'Since 2020, no organization has provided bursaries totaling $8.7 million.',
            'Since 2020, GE Vernova has provided grants totaling $8.7 million.',
            'Since 2020, GE Vernova has awarded bursaries totaling $8.7 million.',
            'GE Vernova has provided bursaries totaling $8.7 million to students who have studied since 2020.',
            'GE Vernova has provided bursaries totaling $8.7 million to students enrolled since 2020.',
            'GE Vernova has provided bursaries totaling $8.7 million to a program established since 2020.',
            'Since 2020, PROTEC has provided bursaries totaling $8.7 million.',
        )
        for source in bad_sources:
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                amounts.validate_amount_relations(output, source)

    def test_period_status_rate_and_actor_cannot_be_borrowed(self):
        source = 'The company provided grants totaling $8.7 million.'
        invalid = (
            'Since 2020, A has provided $8.7 million in annual bursaries.',
            'Since 2020, A has provided $8.7 million more in bursaries.',
            'A has provided $8.7 million in bursaries. It has operated since 2020.',
            'Since 2020, A has not provided $8.7 million in bursaries.',
            'Since 2020, no organization has provided $8.7 million in bursaries.',
            'Since 2020, A has provided $8.7 million remaining in bursary funds.',
            'Since 2020, A has provided $8.7 million in planned bursaries.',
            'Since 2020, A has provided $8.7 million in bursaries annually.',
            'Since 2020, A has provided $8.7 million in bursaries per year.',
            'Since 2020, A has provided $8.7 million in bursaries and $1 million in grants annually.',
            'A has operated since 2020 while B has provided $8.7 million in bursaries.',
            'Since 2020 or earlier A has provided $8.7 million in bursaries.',
            'Since 2020, A has provided $8.7 million in bursaries as an additional allocation.',
            'Since 2020, A has provided $8.7 million in bursaries remaining in its accounts.',
            'Since 2020, A has provided $8.7 million in bursaries budgeted for future distribution.',
            'Since 2020, A has budgeted $8.7 million in bursaries.',
            'Since 2020, A plans to provide $8.7 million in bursaries.',
            'Since 2020, A has provided $8.7 million in repurchase authorization.',
            'Since 2020, A has provided $8.7 million in remaining grants.',
            'Since 2020, A has provided another $8.7 million in grants.',
            'Since 2020, A has provided $8.7 million in bursaries scheduled for next year.',
            'Since 2020, A has provided $8.7 million in bursaries intended for future payments.',
            'Since 2020, A has provided $8.7 million in bursaries to be paid next year.',
            'Since 2020, A has provided $8.7 million in bursaries awaiting disbursement.',
            'Since 2020, A has provided $8.7 million in bursaries subject to approval.',
            'Since 2020, A has provided $8.7 million in bursaries with an unknown modifier.',
        )
        for text in invalid:
            with self.subTest(text=text):
                self.assertEqual(amounts.cumulative_award_claims(text), set())
                with self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                    amounts.validate_amount_relations(text, source)

    def test_japanese_award_predicate_cannot_borrow_a_later_completed_aspect(self):
        en = 'Since 2020, the company has provided $8.7 million in bursaries.'
        for ending in ('提供しない方針としている', '提供できるとしている',
                       '提供することを検討している', '提供する方針としている',
                       '提供を来年実施するとしている', '提供する予定としている'):
            ja = '会社は2020年以降、合計870万ドルの奨学金を' + ending + '。'
            with self.subTest(ja=ja), self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                factual.validate_pair(ja, en)


if __name__ == '__main__':
    unittest.main()
