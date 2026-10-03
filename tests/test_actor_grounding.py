"""Synthetic actor-led assessment acceptance tests; every transport is offline.

Wrong publish decisions are intentional: a cooperative model review does not
prove publication safety. These fixtures test source-bound publication, terminal
private review, and the existing one-call/revision boundaries without X calls.
"""
from copy import deepcopy
from datetime import timedelta
import json
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
from test_general_semantic_assessment import result
import general_source_news as news
import official_research as research


BODY = ('Reporter Dana Vale says Micron $MU has begun sending next-generation '
        'memory samples to industrial customers.')
COPY = {
    'ja': 'Micronは産業分野の顧客に次世代メモリーサンプルを送り始めた。',
    'en': 'Micron has started providing next-generation memory samples to customers in industry.',
    'evidenceId': '0',
}
ENTREPRENEUR = ('Entrepreneur Dana Vale said Micron is sending trial memory '
                'devices to industrial customers.')
ENTREPRENEUR_COPY = {
    'ja': 'Micronは産業分野の顧客に試用メモリー機器を送っている。',
    'en': 'Micron is providing trial memory devices to customers in industry.',
    'evidenceId': '0',
}
TALKS = ('Reporter Dana Vale says Micron $MU is discussing a possible agreement '
         'to supply memory devices to industrial customers.')
TALKS_COPY = {
    'ja': 'Micronは産業分野の顧客にメモリー機器を供給する合意の可能性について協議している。',
    'en': 'Micron is in talks about a possible agreement to supply memory devices to industrial customers.',
    'evidenceId': '0',
}


def assessment(body, changes=None, head=None):
    """One synthetic, exact-body current revision with the original clocks."""
    title = ' '.join(body.split())[:500]
    row = {
        'id': 1, 'source_id': fixture.SOURCE['id'],
        'url': 'https://x.com/wallstengine/status/1044',
        'title': title, 'document_title': title, 'body': body,
        'truncated': False, 'event_kind': 'new', 'tickers_json': '["MU"]',
        'published_at': fixture.PUBLISHED, 'observed_at': fixture.FIRST,
    }
    row['sha'] = row['current_sha'] = news.digest(title + '\n' + body)
    row.update(changes or {})
    heads = {row['url'].casefold(): head or row['sha']}
    return news.assess(row, fixture.SOURCE, fixture.NOW, heads)


class ActorGroundingTests(unittest.TestCase):
    def setUp(self):
        # These tests must never fall through to a real provider or X endpoint.
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden in actor tests'))
            guard.start()
            self.addCleanup(guard.stop)

    def database(self):
        case = fixture.RetainedBusinessAdmissionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def candidate(self, case, body):
        self.assertEqual(case.admit()['inserted'], 1)
        with research.connect(case.path) as db:
            rows = news.candidates(db, fixture.NOW)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertTrue(row['semantic_assessment'])
        self.assertEqual(row['body'], body)
        self.assertEqual(news.evidence_excerpts(row), {'0': body})
        self.assertEqual(row['units'][0]['actor'], 'report')
        return row

    def assert_terminal_review(self, body, facts=None,
                               reason='unsubstantiated-model-output', decision='publish'):
        case = self.database()
        raw = case.raw(body)
        row = self.candidate(case, body)
        calls = []

        def model(payload, key):
            calls.append(payload)
            return result(decision, 'material-company-development' if decision == 'publish' else reason,
                          [facts] if facts is not None else [])

        state = case.run_once(model)
        self.assertEqual(len(calls), 1)
        payload = calls[0]
        evidence = json.loads(payload['input'])
        self.assertEqual(evidence['evidenceExcerpts'], {'0': body})
        self.assertEqual(evidence['evidenceContext']['0']['actor'], 'report')
        self.assertEqual(payload['model'], fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'])
        self.assertEqual(payload['max_output_tokens'], 2400)
        self.assertFalse(payload['store'])
        self.assertEqual(state, 'review')
        with research.connect(case.path) as db:
            self.assertEqual(news.public_items(db, fixture.NOW), [])
            self.assertEqual(news.candidates(db, fixture.NOW), [])
            saved = db.execute('SELECT * FROM general_source_semantic_reviews').fetchall()
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]['reason'], reason)
            self.assertEqual(saved[0]['sha'], raw['sha'])
            self.assertEqual(saved[0]['body_sha'], news.digest(body))
            self.assertEqual(saved[0]['event_id'], row['id'])
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0], 'review')
            if decision == 'publish':
                failure = db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()
                self.assertIsNotNone(failure, 'a rejected publish decision must retain its audit output')
                self.assertEqual(json.loads(failure[0])['facts'], [facts])
        for _ in range(2):
            self.assertEqual(case.run_once(lambda *_: self.fail('completed assessment called again')), 'idle')
        self.assertEqual(case.admit()['restored'], 0)
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0], 1)
        self.assertEqual(case.intake()['records'][0]['reason'], reason)
        return case, row

    def test_full_source_actor_led_positive_is_one_bound_call(self):
        for body, copy in [
            (BODY, COPY),
            (BODY.replace(' $MU', ''), COPY),
            (ENTREPRENEUR, ENTREPRENEUR_COPY),
            ('According to a field report by Rowan Hale, Micron is now sending trial memory devices to industrial customers.',
             {'ja': 'Micronは産業分野の顧客へ試用メモリー機器を送っている。',
              'en': 'Micron is currently sending trial memory devices to customers in industry.',
              'evidenceId': '0'}),
            (TALKS, TALKS_COPY),
            ('Reporter Dana Vale says Micron $MU will sign an agreement to supply memory devices to industrial customers.',
             {'ja': 'Micronは産業分野の顧客にメモリー機器を供給する契約を締結する予定だ。',
              'en': 'Micron plans to sign a memory supply agreement with industrial customers.',
              'evidenceId': '0'}),
        ]:
            with self.subTest(body=body):
                case = self.database()
                raw = case.raw(body)
                row = self.candidate(case, body)
                calls = []

                def model(payload, key):
                    calls.append(payload)
                    return result(facts=[copy])

                state = case.run_once(model)
                self.assertEqual(len(calls), 1)
                evidence = json.loads(calls[0]['input'])
                self.assertEqual(evidence['evidenceExcerpts'], {'0': body})
                self.assertEqual(evidence['evidenceContext']['0']['actor'], 'report')
                binding = evidence['evidenceContext']['0']['actorGrounding']
                self.assertTrue(binding['supported'])
                self.assertNotIn('claimScope', binding, 'context must not duplicate source text')
                self.assertIs(type(binding['claimStart']), int)
                self.assertIs(type(binding['claimEnd']), int)
                self.assertGreaterEqual(binding['claimStart'], 0)
                self.assertLessEqual(binding['claimEnd'], len(body))
                self.assertLess(binding['claimStart'], binding['claimEnd'])
                scope = body[binding['claimStart']:binding['claimEnd']]
                self.assertEqual(scope, row['units'][0]['actorGrounding']['claimScope'])
                self.assertEqual(state, 'done')
                with research.connect(case.path) as db:
                    items = news.public_items(db, fixture.NOW)
                    self.assertEqual(len(items), 1)
                    self.assertIn(copy['ja'], items[0]['bodyJa'])
                    self.assertIn(copy['en'], items[0]['bodyEn'])
                    speaker = 'Rowan Hale' if 'Rowan Hale' in body else 'Dana Vale'
                    self.assertEqual(items[0]['bodyJa'].count(speaker), 1)
                    self.assertEqual(items[0]['bodyEn'].count(speaker), 1)
                    self.assertNotIn('actorGrounding', json.dumps(items[0]))
                    self.assertNotIn('claimScope', json.dumps(items[0]))
                    self.assertIn(row['units'][0]['actorGrounding']['claimScope'], body)
                    self.assertEqual(items[0]['publishedAt'], fixture.PUBLISHED)
                    self.assertEqual(items[0]['observedAt'], fixture.FIRST)
                    self.assertEqual(row['sha'], raw['sha'])
                    self.assertEqual(row['current_sha'], raw['sha'])
                    self.assertEqual(row['body_at'], fixture.FIRST)
                    self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), raw)
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
                self.assertEqual(case.run_once(lambda *_: self.fail('successful assessment repeated')), 'idle')

    def test_company_first_control_keeps_existing_publication_route(self):
        body = 'Micron $MU has begun sending next-generation memory samples to industrial customers.'
        copy = {'ja': 'Micronは産業分野の顧客に次世代メモリーサンプルを送り始めた。',
                'en': 'Industrial customers are now being sent next-generation memory samples by Micron.',
                'evidenceId': '0'}
        case = self.database()
        case.raw(body)
        self.assertEqual(case.run_once(lambda *_: result(facts=[copy])), 'done')
        with research.connect(case.path) as db:
            self.assertEqual(len(news.public_items(db, fixture.NOW)), 1)

    def test_non_latin_speaker_prefix_cannot_bypass_actor_grounding(self):
        # The former ASCII-only punctuation prefix consumed this entire speaker
        # clause. Test both fallback wording and a recognized fast-path verb.
        for prefix in ['田中記者によると、', '据报道，']:
            for claim in ['is sending trial memory devices to industrial customers.',
                          'launched trial memory devices for industrial customers.']:
                with self.subTest(prefix=prefix, claim=claim):
                    body = prefix + 'Micron $MU ' + claim
                    row, reason = assessment(body)
                    self.assertEqual(reason, 'eligible-semantic-assessment')
                    self.assertIn('actorGrounding', row['units'][0])
                    self.assertFalse(row['units'][0]['actorGrounding']['supported'])
                    self.assert_terminal_review(body, ENTREPRENEUR_COPY)

    def test_leading_punctuation_does_not_turn_company_into_an_actor_clause(self):
        for prefix in ['🚨 ', '“', '【速報】']:
            body = prefix + 'Micron $MU is sending trial memory devices to industrial customers.'
            row, _ = assessment(body)
            self.assertIsNotNone(row)
            # Letters inside a bracketed label need review, unlike plain emoji
            # or quotation punctuation. Nothing is silently dropped.
            self.assertEqual('actorGrounding' in row['units'][0], prefix == '【速報】')

    def test_invented_ceo_employee_and_affiliations_are_rejected(self):
        relationships = [
            ('CEO', 'CEO'), ('employee', '従業員'), ('adviser', '顧問'),
            ('customer', '顧客'), ('supplier', '供給業者'),
        ]
        for role, ja_role in relationships:
            with self.subTest(role=role):
                self.assert_terminal_review(ENTREPRENEUR, {
                    'ja': f'Micronの{ja_role}であるDana Valeによると、産業分野の顧客に試用メモリー機器が送られている。',
                    'en': f'Micron {role} Dana Vale says industrial customers are receiving trial memory devices from the company.',
                    'evidenceId': '0',
                })

    def test_one_language_cannot_invent_a_company_role(self):
        for lang, bad in [
            ('ja', 'MicronのCEOであるDana Valeによると、産業分野の顧客に試用メモリー機器が送られている。'),
            ('en', 'Micron adviser Dana Vale says industrial customers are receiving trial memory devices from the company.'),
        ]:
            with self.subTest(lang=lang):
                self.assert_terminal_review(ENTREPRENEUR, {**ENTREPRENEUR_COPY, lang: bad})

    def test_implicit_speaker_employment_cannot_be_invented(self):
        # The immutable attribution names Dana Vale before this claim. Referring
        # to that speaker indirectly must not create an unspoken employment link.
        for language, text in [
            ('ja', 'Micronは同氏を雇い、産業分野の顧客に試用メモリー機器を送っている。'),
            ('ja', 'Micronは同氏の勤務先であり、産業分野の顧客に試用メモリー機器を送っている。'),
            ('en', 'Micron employs him and sends trial memory devices to industrial customers.'),
            ('en', 'Micron hired him and is sending trial memory devices to industrial customers.'),
        ]:
            with self.subTest(language=language, text=text):
                self.assert_terminal_review(ENTREPRENEUR, {**ENTREPRENEUR_COPY, language: text})

    def test_japanese_claim_cannot_invent_a_secondary_person(self):
        self.assert_terminal_review(ENTREPRENEUR, {
            **ENTREPRENEUR_COPY,
            'ja': 'MicronはRowan Haleの助言で産業分野の顧客に試用メモリー機器を送っている。',
        })

    def test_japanese_adjacent_text_cannot_hide_an_invented_person(self):
        self.assert_terminal_review(ENTREPRENEUR, {
            **ENTREPRENEUR_COPY,
            'ja': 'Micronは産業界のRowan Haleの助言で試用メモリー機器を顧客に送っている。',
        })

    def test_employment_without_person_pronoun_is_rejected(self):
        self.assert_terminal_review(ENTREPRENEUR, {
            **ENTREPRENEUR_COPY,
            'en': 'Micron employs a consultant and provides trial memory devices to customers in industry.',
        })

    def test_unrecognized_company_action_cannot_transfer_to_monitored_company(self):
        for body, copy in [
            ('Dana Vale described a new laboratory at Orion Works. Micron $MU appeared on an unrelated background sign.',
             {'ja': 'Dana Valeによると、Micronには新しい研究所がある。Orion Worksは別件の背景表示に登場した。',
              'en': 'Dana Vale described a new laboratory at Micron, with Orion Works appearing on a separate background sign.',
              'evidenceId': '0'}),
            ('Reporter Dana Vale says Orion Works is sending trial memory devices to industrial customers. Micron $MU appeared on a background sign.',
             {'ja': '記者Dana Valeによると、Micronは産業分野の顧客に試用メモリー機器を送っている。Orion Worksは背景表示に登場した。',
              'en': 'Dana Vale reports that industrial customers are receiving trial memory devices from Micron; Orion Works appeared on a background sign.',
              'evidenceId': '0'}),
        ]:
            with self.subTest(body=body):
                self.assert_terminal_review(body, copy)

    def test_tentative_talks_cannot_become_signed_or_completed_agreement(self):
        for en_status, ja_status in [('signed', '締結した'), ('completed', '完了した')]:
            with self.subTest(status=en_status):
                self.assert_terminal_review(TALKS, {
                    'ja': f'Micronは産業分野の顧客にメモリー機器を供給する契約を{ja_status}。',
                    'en': f'Micron {en_status} an agreement to supply memory devices to industrial customers.',
                    'evidenceId': '0',
                })

    def test_tentative_talks_cannot_become_a_definite_future_signature(self):
        self.assert_terminal_review(TALKS, {
            'ja': 'Micronは産業分野の顧客にメモリー機器を供給する契約を締結する予定だ。',
            'en': 'Micron will sign a memory supply agreement with industrial customers.',
            'evidenceId': '0',
        })

    def test_each_language_preserves_agreement_stage(self):
        for lang, bad in [
            ('ja', 'Micronは産業分野の顧客にメモリー機器を供給する契約を締結した。'),
            ('en', 'Micron signed an agreement to supply memory devices to industrial customers.'),
        ]:
            with self.subTest(lang=lang):
                self.assert_terminal_review(TALKS, {**TALKS_COPY, lang: bad})

    def test_future_agreement_cannot_become_completed_with_modal_padding(self):
        body = ('Reporter Dana Vale says Micron $MU will sign an agreement '
                'to supply memory devices to industrial customers.')
        self.assert_terminal_review(body, {
            'ja': 'Micronはメモリー供給契約を締結済みで、産業分野の顧客向け供給拡大を見込む。',
            'en': 'Micron signed the memory supply agreement and expects to supply industrial customers.',
            'evidenceId': '0',
        })

    def test_generated_speaker_attribution_cannot_replace_source_attribution(self):
        changed = {**COPY, 'ja': 'Rowan Haleによると、' + COPY['ja'],
                   'en': 'According to Rowan Hale, ' + COPY['en']}
        for label, copy in [('changed', changed),
                            ('changed-ja-only', {**COPY, 'ja': changed['ja']}),
                            ('changed-en-only', {**COPY, 'en': changed['en']})]:
            with self.subTest(label=label):
                self.assert_terminal_review(BODY, copy)

    def test_omitting_speaker_from_generated_claim_cannot_erase_public_attribution(self):
        case = self.database()
        case.raw(BODY)
        self.assertNotIn('Dana Vale', COPY['ja'])
        self.assertNotIn('Dana Vale', COPY['en'])
        self.assertEqual(case.run_once(lambda *_: result(facts=[COPY])), 'done')
        with research.connect(case.path) as db:
            item = news.public_items(db, fixture.NOW)[0]
            self.assertIn('Dana Vale', item['bodyJa'])
            self.assertIn('Dana Vale', item['bodyEn'])
            self.assertNotIn('Rowan Hale', item['bodyJa'])
            self.assertNotIn('Rowan Hale', item['bodyEn'])

    def test_explicit_negative_decisions_are_terminal_one_call_reviews(self):
        for body, reason in [
            ('Reporter Dana Vale discussed a local sports match while wearing a Micron $MU cap.',
             'not-material-business-news'),
            ('Entrepreneur Dana Vale said the project is progressing. Micron $MU is a company mentioned in the conversation.',
             'ambiguous-actor-or-action'),
            (BODY, 'insufficient-source-evidence'),
        ]:
            with self.subTest(reason=reason):
                self.assert_terminal_review(body, reason=reason, decision='review')

    def test_missing_company_claim_remains_private_despite_publish_response(self):
        body = ('Entrepreneur Dana Vale said the project is progressing. '
                'Micron $MU is a company mentioned in the conversation.')
        self.assert_terminal_review(body, {
            'ja': '起業家Dana Valeによると、Micronのプロジェクトは進んでいる。',
            'en': 'According to entrepreneur Dana Vale, the project at Micron is making progress.',
            'evidenceId': '0',
        })

    def test_existing_number_validation_still_rejects_actor_led_copy(self):
        self.assert_terminal_review(BODY, {
            'ja': '産業分野の顧客にMicronの次世代メモリーサンプルが9個送られ始めた。',
            'en': 'Industrial customers have started receiving 9 next-generation memory samples from Micron.',
            'evidenceId': '0',
        })

    def test_current_head_body_clock_account_and_event_gates_are_preserved(self):
        cases = [
            ({'current_sha': 'newer-sha'}, 'newer-sha', 'superseded-or-missing-revision'),
            ({'truncated': True}, None, 'truncated-or-input-limit'),
            ({'sha': 'bad', 'current_sha': 'bad'}, 'bad', 'evidence-integrity-mismatch'),
            ({'document_title': 'a different title'}, None, 'evidence-integrity-mismatch'),
            ({'published_at': '2026-09-20T00:00:00Z'}, None, 'invalid-source-clock'),
            ({'published_at': '2026-10-01T08:00:00'}, None, 'invalid-source-clock'),
            ({'observed_at': '2026-10-04T00:00:00Z'}, None, 'invalid-source-clock'),
            ({'url': 'https://x.com/unapproved/status/1044'}, None, 'source-not-approved'),
            ({'event_kind': 'deleted'}, None, 'event-kind-not-published'),
            ({'tickers_json': '{"MU":true}'}, None, 'invalid-subject-evidence'),
            ({'tickers_json': '["MSFT"]'}, None, None),
        ]
        for changes, head, expected in cases:
            with self.subTest(changes=changes):
                row, reason = assessment(BODY, changes, head)
                self.assertIsNone(row)
                if expected is not None:
                    self.assertEqual(reason, expected)

    def test_financial_multi_company_and_correction_holds_spend_no_call(self):
        case = self.database()
        for number, body in enumerate([
            'Reporter Dana Vale says Micron $MU price objective is now 250 from 200 at Northstar Research.',
            'Reporter Dana Vale says Micron $MU and Microsoft are discussing memory requirements for industrial customers.',
            'Reporter Dana Vale says Micron $MU and $MSFT are discussing memory requirements for industrial customers.',
            'Correction: Reporter Dana Vale says the earlier claim about Micron $MU trial memory devices was incorrect.',
        ], 1):
            case.raw(body, number=number)
        self.assertEqual(case.run_once(lambda *_: self.fail('preflight exclusion reached provider')), 'idle')
        with research.connect(case.path) as db:
            self.assertEqual(news.candidates(db, fixture.NOW), [])
            self.assertEqual(news.public_items(db, fixture.NOW), [])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_cashtag_without_company_alias_can_only_receive_private_review(self):
        body = 'Reporter Dana Vale says $MU is sending trial memory devices to industrial customers.'
        self.assert_terminal_review(body, reason='ambiguous-actor-or-action', decision='review')
        self.assert_terminal_review(body, {
            'ja': 'Micronは産業分野の顧客に試用メモリー機器を送っている。',
            'en': 'Industrial customers are being sent trial memory devices by Micron.',
            'evidenceId': '0',
        })

    def test_source_revision_change_during_publish_or_review_is_stale(self):
        for decision in ('publish', 'review'):
            with self.subTest(decision=decision):
                case = self.database()
                case.raw(BODY)

                def revise(payload, key):
                    case.raw('Correction: the earlier report is withdrawn and should not be relied upon.',
                             first_seen_at=(fixture.NOW - timedelta(minutes=1)).isoformat(),
                             last_seen_at=(fixture.NOW - timedelta(minutes=1)).isoformat())
                    return result(facts=[COPY]) if decision == 'publish' else result('review', 'insufficient-source-evidence', [])

                self.assertEqual(case.run_once(revise), 'stale')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db, fixture.NOW), [])
                    self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0], 0)
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
                self.assertEqual(case.run_once(lambda *_: self.fail('stale correction reassessed')), 'idle')

    def test_terminal_review_binds_revision_but_new_sha_can_be_assessed(self):
        case, old = self.assert_terminal_review(BODY, reason='insufficient-source-evidence', decision='review')
        fresh = case.raw(BODY + ' Customers are evaluating the samples.',
                         first_seen_at=(fixture.NOW - timedelta(minutes=2)).isoformat(),
                         last_seen_at=(fixture.NOW - timedelta(minutes=2)).isoformat())
        self.assertNotEqual(fresh['sha'], old['sha'])
        self.assertEqual(case.run_once(lambda *_: result('review', 'insufficient-source-evidence', [])), 'review')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0], 2)
            self.assertEqual(news.candidates(db, fixture.NOW, include_review=True)[0]['sha'], fresh['sha'])
        self.assertEqual(case.run_once(lambda *_: self.fail('fresh terminal review repeated')), 'idle')

    def test_duplicate_body_and_origin_cannot_repeat_completed_review(self):
        case, _ = self.assert_terminal_review(BODY, reason='insufficient-source-evidence', decision='review')
        case.raw(BODY, number=2000)
        case.raw(BODY, source=fixture.TIP, account='TipRanks', number=2001)
        self.assertEqual(case.run_once(lambda *_: self.fail('duplicate body assessed again')), 'idle')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
            self.assertEqual(news.public_items(db, fixture.NOW), [])

    def test_public_read_revalidates_speaker_and_later_correction(self):
        case = self.database()
        case.raw(BODY)
        self.assertEqual(case.run_once(lambda *_: result(facts=[COPY])), 'done')
        with research.connect(case.path) as db:
            saved = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            altered = deepcopy(saved)
            altered['facts'][0]['en'] = 'According to Rowan Hale, ' + COPY['en']
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(altered),))
            self.assertEqual(news.public_items(db, fixture.NOW), [])
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(saved),))
            self.assertEqual(len(news.public_items(db, fixture.NOW)), 1)
        case.raw('Correction: the earlier report is withdrawn and should not be relied upon.',
                 first_seen_at=(fixture.NOW - timedelta(minutes=1)).isoformat(),
                 last_seen_at=(fixture.NOW - timedelta(minutes=1)).isoformat())
        with research.connect(case.path) as db:
            self.assertEqual(news.public_items(db, fixture.NOW), [])


if __name__ == '__main__':
    unittest.main()
