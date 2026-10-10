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
        text = json.dumps(item, ensure_ascii=False)
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
        kept = research.salvage_facts(value, row)
        self.assertEqual(kept['facts'], NOTE['facts'])
        self.assertEqual(kept['title'], NOTE['title'])
        self.assertEqual(len(value['facts']), 4)


class AdditiveNotTests(unittest.TestCase):
    def test_not_just_is_not_a_negation(self):
        fv = research.factual_validation
        self.assertFalse(fv.negated('This is not just a chip, it is a full platform.'))
        self.assertFalse(fv.negated('It is not merely faster.'))
        self.assertTrue(fv.negated('The company will not raise output.'))
        self.assertTrue(fv.negated('It is not justified.'))


if __name__ == '__main__':
    unittest.main()
