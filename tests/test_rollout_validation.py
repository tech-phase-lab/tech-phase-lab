"""Current rollout, later audience expansion and retirement are distinct."""
from copy import deepcopy
from datetime import timedelta
import json
import unittest
from unittest.mock import patch

import test_official_research as fixture
import official_research as research
import rollout_validation as guard

# Literal official Google release, September 30, 2026. These are source
# passages, not a claim to have exported the live retained database body.
ROLLOUT=("Skills are already available in Gemini Spark, and they will soon replace Gems as the tool for tailoring instructions for specific tasks. "
         "Today, we’re rolling out skills directly into Gemini chat globally, and bringing this functionality to Google Workspace business, enterprise, nonprofit, and education customers in the coming weeks.")
REMOVAL=("As we bring more functionality to skills, we will remove support for Gems starting in November for individuals with personal accounts, "
         "March 2027 for Workspace business, enterprise, and nonprofit customers, and June 2027 for Workspace education customers.")
WRONG_JA='スキルはGemini Sparkですでに利用可能で、まもなくGemsに代わる機能としてGeminiチャットに全世界で提供される。'
WRONG_EN='Skills are already available in Gemini Spark and will soon replace Gems globally in Gemini chat.'
WRONG_LEAD='Gemini chat introduces skills allowing users to save and reuse instructions for automating repetitive tasks, replacing Gems starting November with phased support removal.'


class RolloutValidationTests(unittest.TestCase):
    def test_actual_global_rollout_future_and_november_replacement_errors_fail(self):
        for text in (WRONG_JA,WRONG_EN,WRONG_LEAD):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,guard.FAILURE):
                guard.validate(text,ROLLOUT+' '+REMOVAL)

    def test_current_rollout_and_later_workspace_or_removal_keep_their_scope(self):
        for text in (
            'Geminiチャットでは本日から世界中でスキルの展開を始め、Workspace向けには今後数週間で提供する。',
            'Skills start rolling out globally in Gemini chat today; Workspace customers will get them in the coming weeks.',
            'Skills are already available in Gemini Spark and will soon replace Gems.',
            'Geminiチャットにスキル機能を導入し、11月からGemsのサポートを段階的に終了する。',
            'Google is introducing skills in Gemini chat. Personal Gems support removal begins in November.',
            'Geminiチャットでの展開は始まった。Workspaceではまもなく利用可能になる。',
            'Skills will soon become available globally in Gemini chat for Workspace business customers.',
            'Workspace利用者向けにはGeminiチャットのスキルが全世界でまもなく提供される。',
        ):
            with self.subTest(text=text):guard.validate(text,ROLLOUT+' '+REMOVAL)

    def test_other_surface_and_future_source_do_not_borrow_current_rollout(self):
        guard.validate('New Chat will soon become available worldwide.',ROLLOUT)
        guard.validate(WRONG_JA,'Skills will roll out into Gemini chat globally next month.')
        guard.validate(WRONG_EN,'Today we are rolling out skills into Gemini Spark globally.')
        guard.validate(WRONG_LEAD,'Skills will replace Gems starting November.')
        guard.validate('Skills replace Gems starting November.',REMOVAL+' Skills replace Gems starting November.')
        # The proof is a named surface relation, not a Google-specific URL/id.
        with self.assertRaisesRegex(ValueError,guard.FAILURE):
            guard.validate('Tools will soon become available globally in Example chat.',
                           'Today, we are rolling out tools directly into Example chat globally.')
        for text in ('Workspace was mentioned: Gemini chat will soon become available globally.',
                     'Gemini chat will soon become available globally for all users including Workspace customers.',
                     'Workspaceにも言及しGeminiチャットは全世界でまもなく提供される。'):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,guard.FAILURE):
                guard.validate(text,ROLLOUT)

    def test_saved_invalid_body_holds_without_mutation_retry_or_headline_loss(self):
        case=fixture.OfficialResearchTests();case.setUp();self.addCleanup(case.doCleanups)
        body=fixture.BODY+' '+ROLLOUT+' '+REMOVAL
        note=deepcopy(fixture.NOTE)
        note['facts'][2]=fixture.copy(WRONG_JA,WRONG_EN,ROLLOUT)
        with research.connect(case.path) as db:
            db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?',(body,len(body)))
        def transport(*_):
            result=fixture.response();result['output'][0]['content'][0]['text']=json.dumps(note)
            return result
        with patch.object(guard,'validate'):
            self.assertEqual(case.run_note(transport),'done')
        later=fixture.NOW+timedelta(minutes=10)
        with research.connect(case.path) as db:
            row=research.candidates(db,later)[0]
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],row['body_sha'],row['body'],row['body_at'],0,None))
            before={table:[tuple(r) for r in db.execute('SELECT * FROM '+table)] for table in
                    ('sources','source_revisions','official_research_publications','official_research_jobs','signal_headline_translation_calls')}
            with patch.object(guard,'validate'):
                original=research.signals.public_official_updates(db,reference=later)
                self.assertIn('bodyJa',original[0])
            public=research.signals.public_official_updates(db,reference=later)
            self.assertEqual(public,[{k:v for k,v in item.items() if k not in ('bodyJa','bodyEn')} for item in original])
            self.assertEqual(research.publication_hold_reason(db,row,later),guard.FAILURE)
            state=research.delivery_diagnostics(db,later,[row],set())
            self.assertEqual((state['automaticPending'],state['publicationHeld'],state['reviewOverdue']),(0,1,1))
            self.assertEqual(state['publicationHoldReasons'],{guard.FAILURE:1})
            self.assertIsNone(research.claim(db,later,fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],200))
            self.assertEqual(before,{table:[tuple(r) for r in db.execute('SELECT * FROM '+table)] for table in before})
        with patch.object(research.signals,'fetch',side_effect=AssertionError('external fetch')):
            self.assertEqual(case.run_note(lambda *_:self.fail('paid retry')),'idle')


if __name__=='__main__':unittest.main()
