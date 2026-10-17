"""Source work is reused only for an exact successful current-copy validation."""
from copy import deepcopy
import unittest
from unittest.mock import patch

import test_official_research as fixture
import test_rollout_validation as rollout_fixture
import official_research as research
import rollout_validation as rollout


class ValidationSourceContextTests(unittest.TestCase):
    def setUp(self):
        self.reuse = patch.object(research, '_validation_success', research.ValidationSuccess())
        self.reuse.start(); self.addCleanup(self.reuse.stop)

    def test_body_is_analyzed_once_then_exact_success_reuses_it(self):
        with patch.object(rollout,'source_context',wraps=rollout.source_context) as parse:
            with patch.object(research,'normalized',wraps=research.normalized) as normalize:
                for _ in range(2):
                    self.assertEqual(research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE),fixture.NOTE)
                self.assertEqual(parse.call_count,1)
                self.assertEqual(sum(call.args[0] is fixture.BODY for call in normalize.call_args_list),1)
                research.validate(deepcopy(fixture.NOTE),fixture.BODY+' More background.',fixture.TITLE)
                research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE+' update')
                changed=deepcopy(fixture.NOTE);changed['title']['en']+='.'
                research.validate(changed,fixture.BODY,fixture.TITLE)
                self.assertEqual(parse.call_count,4)
                research._validation_success.clear()
                research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                with patch.object(research,'VALIDATION_REUSE_VERSION',research.VALIDATION_REUSE_VERSION+1):
                    research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                self.assertEqual(parse.call_count,7)

    def test_note_context_and_standalone_field_checks_have_the_same_outcomes(self):
        cases=[(deepcopy(fixture.NOTE),fixture.BODY)]
        for mutation in ('number','quote','rollout'):
            note=deepcopy(fixture.NOTE);body=fixture.BODY
            if mutation=='number':note['facts'][0]['en']+=' Revenue was $999 billion.'
            elif mutation=='quote':note['facts'][0]['evidenceQuote']='This source statement was never retained.'
            else:
                body+=' '+rollout_fixture.ROLLOUT
                note['facts'][0]=fixture.copy(rollout_fixture.WRONG_JA,rollout_fixture.WRONG_EN,rollout_fixture.ROLLOUT)
            cases.append((note,body))
        def outcome(action):
            try:action();return 'valid'
            except ValueError as exc:return str(exc)
        def separately(note,body):
            for name,item in [('title',note['title']),('summary',note['summary']),
                              *[('fact',f) for f in note['facts']],('purpose',note['purpose'])]:
                research.validate_item(name,item,body,fixture.TITLE)
        for note,body in cases:
            with self.subTest(body=body[-40:]):
                self.assertEqual(outcome(lambda:research.validate(deepcopy(note),body,fixture.TITLE)),
                                 outcome(lambda:separately(deepcopy(note),body)))

    def test_context_from_another_source_does_not_authorize_copy_or_quote(self):
        earlier='Skills will replace Gems starting November.'
        stale=rollout.source_context(earlier)
        with self.assertRaisesRegex(ValueError,rollout.FAILURE):
            rollout.validate('Skills replace Gems starting November.',rollout_fixture.REMOVAL,stale)
        context=(fixture.BODY,research.normalized(fixture.BODY),rollout.source_context(fixture.BODY))
        with self.assertRaisesRegex(ValueError,'unsupported-quote'):
            research.validate_item('fact',deepcopy(fixture.NOTE['facts'][0]),
                                   'A different current source body with no acquisition statement.',fixture.TITLE,context)


if __name__=='__main__':unittest.main()
