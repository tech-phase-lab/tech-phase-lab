import json
import unittest

import test_official_research as base
from test_official_research import NOTE, QUOTES, copy, research


def reply(note):
    return lambda *_: {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps(note, ensure_ascii=False)}]}]}


class FactSalvageTests(unittest.TestCase):
    """Owner, Oct 11: one wrong fact must not hold back the whole story."""

    setUp = base.OfficialResearchTests.setUp
    feed = base.OfficialResearchTests.feed
    run_note = base.OfficialResearchTests.run_note

    def note_with(self, *extra):
        note = json.loads(json.dumps(NOTE))
        note['facts'].extend(extra)
        return note

    def test_a_failing_fourth_fact_is_left_out_and_the_story_publishes(self):
        invented = copy('Inferizeを5億ドルで買収した。', 'Nebius acquired Inferize for $500 million.', QUOTES[0])
        self.assertEqual(self.run_note(reply(self.note_with(invented))), 'done')
        item = self.feed()[0]
        # Only the story's own wording: timing fields carry millisecond digits that can contain "500" by chance.
        text = json.dumps({key: item[key] for key in ('title', 'summary', 'facts', 'purpose') if key in item}, ensure_ascii=False)
        self.assertNotIn('5億', text)
        self.assertNotIn('500', text)
        self.assertIn('買収', item['title']['ja'])

    def test_fewer_than_three_checked_facts_still_holds_the_story(self):
        note = json.loads(json.dumps(NOTE))
        note['facts'][1] = copy('Inferizeを5億ドルで買収した。', 'Nebius acquired Inferize for $500 million.', QUOTES[0])
        self.assertEqual(self.run_note(reply(note)), 'retry')
        self.assertEqual(self.feed(), [])

    def test_a_failing_title_is_never_salvaged(self):
        note = self.note_with(copy('チームが加わった。', 'The team joined.', QUOTES[1]))
        note['title'] = copy('Nebius、Inferizeを5億ドルで買収', 'Nebius buys Inferize for $500 million', QUOTES[0])
        self.assertEqual(self.run_note(reply(note)), 'retry')
        self.assertEqual(self.feed(), [])

    def test_salvage_never_rewrites_kept_copy(self):
        invented = copy('Inferizeを5億ドルで買収した。', 'Nebius acquired Inferize for $500 million.', QUOTES[0])
        value = self.note_with(invented)
        row = {'body': ' '.join(QUOTES) + ' ' + 'Company announcement background. ' * 50, 'title': 'Nebius acquires Inferize'}
        kept = research.salvage(value, row)
        self.assertEqual(kept['facts'], NOTE['facts'])
        self.assertEqual(kept['title'], NOTE['title'])
        self.assertEqual(len(value['facts']), 4)


    def test_a_failing_purpose_points_to_the_release(self):
        note = json.loads(json.dumps(NOTE))
        note['purpose'] = copy('5億ドルの売上を目指す。', 'Nebius targets $500 million in revenue.', QUOTES[2])
        self.assertEqual(self.run_note(reply(note)), 'done')
        item = self.feed()[0]
        text = json.dumps(item, ensure_ascii=False)
        self.assertNotIn('5億', text)
        self.assertIn(research.PURPOSE_FALLBACK['ja'], text)

    def test_a_retry_keeps_what_passed_before_and_redoes_only_what_failed(self):
        first = json.loads(json.dumps(NOTE))
        first['summary'] = copy('Inferizeを5億ドルで買収した。', 'Nebius acquired Inferize for $500 million.', QUOTES[0])
        self.assertEqual(self.run_note(reply(first)), 'retry')
        second = json.loads(json.dumps(NOTE))
        second['title'] = copy('Nebius、Inferizeを2社買収', 'Nebius buys two Inferize units', QUOTES[0])
        with base.research.connect(self.path) as db:
            db.execute('UPDATE official_research_jobs SET next_at=0')
        self.assertEqual(self.run_note(reply(second)), 'done')
        item = self.feed()[0]
        self.assertEqual(item['title']['en'], NOTE['title']['en'])
        self.assertEqual(item['summary']['en'], NOTE['summary']['en'])

    def test_a_retry_never_reuses_an_answer_for_another_source_revision(self):
        row = {'body': 'Totally different body text about something else entirely. ' * 30, 'title': 'Other'}
        value = json.loads(json.dumps(NOTE))
        value['title'] = copy('別の見出し', 'Another headline', 'not in the body at all, so it fails')
        kept = research.salvage(value, row, [json.loads(json.dumps(NOTE))])
        self.assertEqual(kept['title'], value['title'])


class SpelledCountTests(unittest.TestCase):
    def test_a_spelled_count_supports_its_digit_only_for_the_same_object(self):
        fv = research.factual_validation
        source = 'Google will build three Google data centers in Texas.'
        fv.validate_numbers('3つのGoogleデータセンターを建設する。', source)
        fv.validate_numbers('Google will build 3 Google data centers.', source)
        fv.validate_numbers('3社が参加した。', 'Three companies joined.')
        for text, evidence in (('4つのデータセンター', source), ('2社が参加', 'Two of the partners joined.'),
                               ('1社を買収', 'It bought one company.'), ('3日間', 'across three targets'),
                               ('3月', 'three targets'), ('3 proteins', 'three targets'), ('$3', 'three targets'),
                               ('3人が参加', 'Three companies joined.'), ('3社', 'three data centers'),
                               ('3 sites', source)):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                fv.validate_numbers(text, evidence)


class AdditiveNotTests(unittest.TestCase):
    def test_not_just_is_not_a_negation(self):
        fv = research.factual_validation
        self.assertFalse(fv.negated('This is not just a chip, it is a full platform.'))
        self.assertFalse(fv.negated('It is not merely faster.'))
        self.assertTrue(fv.negated('The company will not raise output.'))
        self.assertTrue(fv.negated('It is not justified.'))


if __name__ == '__main__':
    unittest.main()
