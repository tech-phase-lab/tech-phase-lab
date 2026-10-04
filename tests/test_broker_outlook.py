"""Offline broker-led outlook regressions with source-bound claim scopes.

The retained WallStEngine source below is the full original 421-character post,
not a reconstructed headline. Its title-plus-body SHA was independently matched
against the retained revision. The source/first-observation clocks are the
reported UI-second values, preserving the observed 13-second acquisition gap.
All provider responses are mocked; no model or X endpoint may be contacted.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
from test_general_semantic_assessment import result
import general_source_news as news
import headline_translation
import official_research as research


NOW = datetime(2026, 10, 3, 13, 40, tzinfo=timezone.utc)
URL = 'https://x.com/wallstengine/status/2106377353018626530'
SOURCE_SHA = '3ad5a464caa5848b6fb0e4c0211b3218795275b1ed871ba6f8089ea7b0d3a8b3'
BODY_SHA = 'c97c55946afbdaa2122b526c779c77bb621f03669bfa2930fc4e5b3af2677149'
PUBLISHED = '2026-10-03T13:34:30Z'
FIRST = '2026-10-03T13:34:43Z'
LAST = FIRST
BODY = (
    'JPMorgan sees memory supply remaining tight through 2028, with customer order discussions already extending into 2031.\n\n'
    'Its estimates point to:\n\n'
    '• HBM bit demand growth: +63%\n'
    '• Non-HBM server DRAM: +37%\n'
    '• CY27 HBM blended ASP: +54% YoY\n\n'
    'JPM also believes Micron’s >35% revenue coverage under long-term supply agreements through 2030 could prove conservative, '
    'noting Asian memory peers have LTAs covering 50%+ of capacity.'
)
COPY = [
    {
        'ja': 'メモリー供給は2028年まで逼迫が続くと見込む。',
        'en': 'Memory supply is expected to stay constrained through 2028.',
        'evidenceId': '0',
    },
    {
        'ja': '顧客との受注協議はすでに2031年分にまで及んでいる。',
        'en': 'Customer order talks already reach into 2031.',
        'evidenceId': '1',
    },
    {
        'ja': 'HBMのビット需要は+63%の伸びを見込む。',
        'en': 'HBM bit demand is forecast to expand by +63%.',
        'evidenceId': '2',
    },
    {
        'ja': '非HBMのサーバーDRAMは+37%と予測する。',
        'en': 'Non-HBM server DRAM is estimated at +37%.',
        'evidenceId': '3',
    },
    {
        'ja': 'CY27のHBM混合平均販売単価（ASP）は前年比+54%と見込む。',
        'en': 'The blended HBM ASP for CY27 is forecast at +54% YoY.',
        'evidenceId': '4',
    },
    {
        'ja': 'Micronの長期供給契約による売上高カバー率>35%（2030年まで）は保守的な可能性があるとみる。',
        'en': 'Micron’s long-term supply agreements cover >35% of revenue through 2030, a level that may be conservative.',
        'evidenceId': '5',
    },
    {
        'ja': 'アジアのメモリー同業他社は長期契約で生産能力の50%+をカバーしている。',
        'en': 'Asian memory peers have long-term agreements covering 50%+ of capacity.',
        'evidenceId': '6',
    },
]


class BrokerOutlookTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden in broker outlook tests'))
            guard.start()
            self.addCleanup(guard.stop)

    def database(self):
        case = fixture.RetainedBusinessAdmissionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def raw(self, case, body=BODY, number=2106377353018626530, **changes):
        return case.raw(body, number=number, published_at=PUBLISHED,
                        first_seen_at=changes.pop('first_seen_at', FIRST),
                        last_seen_at=changes.pop('last_seen_at', LAST), **changes)

    def admit(self, case):
        with research.connect(case.path) as db:
            return news.admit_retained(db, NOW)

    def run_once(self, case, transport, env=fixture.ENV):
        with patch.object(research, 'prepare_story_body', return_value='idle'), \
                patch.object(research, 'datetime') as clock:
            clock.fromtimestamp.side_effect = datetime.fromtimestamp
            clock.now.return_value = NOW
            return research.run_once(case.path, transport, env, NOW.timestamp())

    def candidate(self, case, body=BODY):
        self.assertEqual(self.admit(case)['inserted'], 1)
        with research.connect(case.path) as db:
            rows = news.candidates(db, NOW)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertTrue(row['semantic_assessment'])
        self.assertEqual(row['category'], 'broker-commentary')
        self.assertEqual(row['body'], body)
        self.assertEqual(row['body_sha'], news.digest(body))
        self.assertEqual(row['body_at'], FIRST)
        self.assertEqual(len(row['units']), 7)
        self.assertEqual([unit['brokerCommentary']['scope'] for unit in row['units']],
                         ['sector'] * 5 + ['company', 'peer'])
        for unit in row['units']:
            binding = unit['brokerCommentary']
            self.assertEqual(body[binding['sourceStart']:binding['sourceEnd']], unit['quote'])
            if 'context' in binding:
                context = binding['context']
                self.assertEqual(body[context['sourceStart']:context['sourceEnd']], context['quote'])
            self.assertIn(unit['quote'], body, 'evidence units must be exact contiguous source spans')
            self.assertNotIn('target', unit)
            self.assertNotIn('rating', unit)
        return row

    def assert_review(self, facts, *, body=BODY, decision='publish', reason='unsubstantiated-model-output'):
        case = self.database()
        raw = self.raw(case, body)
        row = self.candidate(case, body)
        calls = []

        def model(payload, key):
            calls.append(payload)
            return result(decision, 'material-company-development' if decision == 'publish' else reason, facts)

        self.assertEqual(self.run_once(case, model), 'review')
        self.assertEqual(len(calls), 1)
        with research.connect(case.path) as db:
            import general_source_briefs as briefs
            partial=briefs.publications(db,NOW)
            if decision!='publish':self.assertEqual(partial,[])
            invalid=set()
            for fact,unit in zip(facts,row['units']):
                try:news.validate_pair(fact,unit)
                except (ValueError,TypeError,KeyError):invalid.add(unit['id'])
            if decision=='publish':self.assertTrue(invalid)
            for _,_,note in partial:
                selected={fact['evidenceId'] for fact in note['facts']}
                self.assertTrue(selected.isdisjoint(invalid),'an invalid claim must never enter a brief')
                for fact in note['facts']:
                    unit=next(unit for unit in row['units'] if unit['id']==fact['evidenceId'])
                    news.validate_pair(fact,unit)
                    if note['scope']=='sector':self.assertEqual(unit['brokerCommentary']['scope'],'sector')
                for bad_id in invalid:
                    bad=facts[int(bad_id)]
                    for item in news.public_items(db,NOW):
                        self.assertNotIn(bad['ja'],item['bodyJa'])
                        self.assertNotIn(bad['en'],item['bodyEn'])
            self.assertEqual(news.candidates(db, NOW), [])
            saved = db.execute('SELECT * FROM general_source_semantic_reviews').fetchall()
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]['reason'], reason)
            self.assertEqual(saved[0]['sha'], raw['sha'])
            self.assertEqual(saved[0]['body_sha'], news.digest(body))
            self.assertEqual(saved[0]['event_id'], row['id'])
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0], 'review')
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), raw)
            if decision == 'publish':
                failure = db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()
                self.assertIsNotNone(failure)
                self.assertEqual(json.loads(failure[0])['facts'], facts)
                self.assertEqual(db.execute('SELECT count(*) FROM official_research_attempt_body_proofs').fetchone()[0], 1)
        for _ in range(2):
            self.assertEqual(self.run_once(case, lambda *_: self.fail('terminal broker review repeated')), 'idle')
        self.assertEqual(self.admit(case)['restored'], 0)
        return case

    def test_actual_retained_source_is_one_bound_call_with_original_revision_and_clocks(self):
        case = self.database()
        raw = self.raw(case)
        self.assertEqual(len(BODY), 421)
        self.assertEqual(raw['url'], URL)
        self.assertEqual(raw['sha'], SOURCE_SHA)
        self.assertEqual(news.digest(BODY), BODY_SHA)
        self.assertEqual((datetime.fromisoformat(FIRST.replace('Z', '+00:00')) -
                          datetime.fromisoformat(PUBLISHED.replace('Z', '+00:00'))).total_seconds(), 13)
        row = self.candidate(case)
        self.assertEqual(row['sha'], SOURCE_SHA)
        self.assertEqual(row['current_sha'], SOURCE_SHA)
        self.assertEqual([unit['actor'] for unit in row['units']], ['JPMorgan'] * 7)
        calls = []

        def model(payload, key):
            calls.append(payload)
            self.assertEqual(payload['model'], fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'])
            self.assertEqual(payload['max_output_tokens'], 2400)
            self.assertFalse(payload['store'])
            self.assertIn('disposition', payload['text']['format']['schema']['required'])
            evidence = json.loads(payload['input'])
            self.assertEqual(evidence['evidenceExcerpts'], news.evidence_excerpts(row))
            self.assertEqual([v['actor'] for v in evidence['evidenceContext'].values()], ['JPMorgan'] * 7)
            self.assertEqual([v['brokerCommentary']['scope'] for v in evidence['evidenceContext'].values()],
                             ['sector'] * 5 + ['company', 'peer'])
            return result(facts=COPY)

        self.assertEqual(self.run_once(case, model), 'done')
        self.assertEqual(len(calls), 1)
        with research.connect(case.path) as db:
            items = news.public_items(db, NOW)
            self.assertEqual(len(items), 1)
            item = items[0]
            self.assertEqual(item['url'], URL)
            self.assertEqual(item['publishedAt'], PUBLISHED)
            self.assertEqual(item['observedAt'], FIRST)
            for language in ('ja', 'en'):
                text = item['body' + language.title()]
                self.assertEqual(text.count('JPMorgan'), 7)
                for fact in COPY:
                    self.assertIn(fact[language], text)
                self.assertNotIn('FY27', text)
                self.assertNotIn('price target', text)
                self.assertNotIn('目標株価', text)
            self.assertNotIn('brokerCommentary', json.dumps(item))
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), raw)
            event = db.execute('SELECT * FROM signal_events').fetchone()
            self.assertEqual(event['sha'], SOURCE_SHA)
            self.assertEqual(event['published_at'], PUBLISHED)
            self.assertEqual(event['observed_at'], FIRST)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
        self.assertEqual(self.run_once(case, lambda *_: self.fail('published source called again')), 'idle')

    def test_other_known_brokers_and_unrelated_post_ids_use_same_route(self):
        for index, (firm, canonical) in enumerate((('Morgan Stanley','Morgan Stanley'),
                ('Goldman Sachs','Goldman Sachs'),('UBS','UBS'),
                ('J.P. Morgan','JPMorgan'),('B. Riley','B. Riley'))):
            with self.subTest(firm=firm):
                case = self.database()
                body = BODY.replace('JPMorgan', firm).replace('JPM also', firm + ' also')
                self.raw(case, body, number=3200000000000000000 + index)
                row = self.candidate(case, body)
                self.assertEqual([unit['actor'] for unit in row['units']], [canonical] * 7)
                self.assertEqual(self.run_once(case, lambda *_: result(facts=COPY)), 'done')
                with research.connect(case.path) as db:
                    item = news.public_items(db, NOW)[0]
                    self.assertIn(canonical, item['bodyEn'])
                    if canonical != 'JPMorgan':
                        self.assertNotIn('JPMorgan', item['bodyEn'])

    def test_modal_retention_cannot_hide_an_inverted_claim(self):
        for index, language, inverted in [
            (0, 'en', 'Memory supply is expected not to stay constrained through 2028.'),
            (0, 'ja', 'メモリー供給は2028年まで逼迫しないと見込む。'),
            (5, 'en', 'Micron’s long-term supply agreements cover >35% of revenue through 2030, a level that may not be conservative.'),
            (5, 'ja', 'Micronの長期供給契約による売上高カバー率>35%（2030年まで）は保守的ではない可能性があるとみる。'),
        ]:
            with self.subTest(index=index, language=language):
                facts = deepcopy(COPY)
                facts[index][language] = inverted
                self.assert_review(facts)

    def test_paraphrased_known_broker_source_and_forecast_header_are_not_fixture_grammar(self):
        body = (
            'Morgan Stanley expects memory supply to stay tight through 2028, with customer order discussions now reaching into 2031.\n\n'
            'Its forecasts indicate:\n\n'
            '• HBM bit demand growth: +63%\n'
            '• Non-HBM server DRAM: +37%\n'
            '• CY27 HBM blended ASP: +54% YoY\n\n'
            'Morgan Stanley believes Micron’s >35% revenue coverage under long-term supply agreements through 2030 may be conservative, '
            'while Asian memory peers have LTAs covering 50%+ of capacity.'
        )
        facts = deepcopy(COPY)
        facts[1]['en'] = facts[1]['en'].replace('already', 'currently')
        facts[1]['ja'] = facts[1]['ja'].replace('すでに', '現在')
        case = self.database()
        self.raw(case, body, number=3500000000000000000)
        row = self.candidate(case, body)
        self.assertEqual([unit['actor'] for unit in row['units']], ['Morgan Stanley'] * 7)
        self.assertEqual(self.run_once(case, lambda *_: result(facts=facts)), 'done')
        with research.connect(case.path) as db:
            self.assertEqual(len(news.public_items(db, NOW)), 1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)

    def test_sector_forecasts_and_percentages_cannot_be_transferred_to_micron(self):
        wrong = [
            (0, 'ja', COPY[0]['ja'].replace('メモリー供給', 'Micronのメモリー供給')),
            (0, 'en', COPY[0]['en'].replace('Memory supply', 'Micron memory supply')),
            (2, 'ja', COPY[2]['ja'].replace('HBMのビット需要', 'MicronのHBMのビット需要')),
            (2, 'en', COPY[2]['en'].replace('HBM bit demand', 'Micron HBM bit demand')),
            (3, 'en', COPY[3]['en'].replace('Non-HBM', 'Micron non-HBM')),
            (4, 'ja', COPY[4]['ja'].replace('HBM混合平均販売単価', 'MicronのHBM混合平均販売単価')),
        ]
        for index, language, text in wrong:
            with self.subTest(index=index, language=language):
                facts = deepcopy(COPY)
                facts[index][language] = text
                self.assert_review(facts)

    def test_company_and_peer_metrics_cannot_swap_revenue_capacity_or_subject(self):
        wrong = [
            (5, 'en', COPY[5]['en'].replace('of revenue', 'of capacity')),
            (5, 'ja', COPY[5]['ja'].replace('売上高カバー率', '生産能力カバー率')),
            (6, 'en', COPY[6]['en'].replace('50%+ of capacity', '50%+ of revenue')),
            (6, 'ja', COPY[6]['ja'].replace('生産能力の50%+', '売上高の50%+')),
            (6, 'en', COPY[6]['en'].replace('Asian memory peers', 'Micron')),
            (6, 'ja', COPY[6]['ja'].replace('アジアのメモリー同業他社', 'Micron')),
        ]
        for index, language, text in wrong:
            with self.subTest(language=language, text=text):
                facts = deepcopy(COPY)
                facts[index][language] = text
                self.assert_review(facts)

    def test_each_percentage_retains_its_product_and_metric(self):
        wrong = [
            (2, 'en', COPY[2]['en'].replace('HBM bit demand', 'Server DRAM demand')),
            (2, 'ja', COPY[2]['ja'].replace('ビット需要', '需要')),
            (3, 'en', COPY[3]['en'].replace('Non-HBM', 'HBM')),
            (3, 'ja', COPY[3]['ja'].replace('サーバー', '携帯電話')),
            (4, 'en', COPY[4]['en'].replace('blended ', '')),
            (4, 'ja', COPY[4]['ja'].replace('混合平均販売単価（ASP）', 'ビット需要')),
        ]
        for index, language, text in wrong:
            with self.subTest(index=index, language=language):
                facts = deepcopy(COPY)
                facts[index][language] = text
                self.assert_review(facts)

    def test_equivalent_natural_language_inequalities_are_valid_paraphrases(self):
        facts = deepcopy(COPY)
        facts[5]['en'] = facts[5]['en'].replace('>35%', 'more than 35%')
        facts[5]['ja'] = facts[5]['ja'].replace('>35%', '35%超')
        facts[6]['en'] = facts[6]['en'].replace('50%+', 'at least 50%')
        facts[6]['ja'] = facts[6]['ja'].replace('50%+', '50%以上')
        case = self.database()
        self.raw(case)
        self.assertEqual(self.run_once(case, lambda *_: result(facts=facts)), 'done')
        with research.connect(case.path) as db:
            self.assertEqual(len(news.public_items(db, NOW)), 1)

    def test_order_discussions_cannot_become_signed_orders_or_completed_contracts(self):
        wrong = [
            ('en', 'Customer orders are already secured through 2031.'),
            ('ja', '顧客との受注はすでに2031年分まで確定している。'),
            ('en', COPY[1]['en'].replace('already reach', 'may reach')),
            ('ja', COPY[1]['ja'].replace('すでに', '').replace('及んでいる', '及ぶ可能性がある')),
        ]
        for language, text in wrong:
            with self.subTest(language=language):
                facts = deepcopy(COPY)
                facts[1][language] = text
                self.assert_review(facts)

    def test_calendar_basis_percent_units_signs_periods_and_comparisons_are_preserved(self):
        wrong = [
            (4, 'en', COPY[4]['en'].replace('CY27', 'FY27')),
            (4, 'ja', COPY[4]['ja'].replace('CY27', 'FY27')),
            (4, 'en', COPY[4]['en'].replace('CY27', '27')),
            (4, 'ja', COPY[4]['ja'].replace('前年比', '')),
            (4, 'en', COPY[4]['en'].replace(' YoY', '')),
            (2, 'en', COPY[2]['en'].replace('+63%', '+63')),
            (4, 'ja', COPY[4]['ja'].replace('+54%', '-54%')),
            (0, 'en', COPY[0]['en'].replace('2028', '2029')),
            (1, 'ja', COPY[1]['ja'].replace('2031年分にまで', '先まで')),
            (5, 'en', COPY[5]['en'].replace('>35%', '35%')),
            (5, 'ja', COPY[5]['ja'].replace('>35%', '35%')),
            (5, 'en', COPY[5]['en'].replace('>35%', '>=35%')),
            (5, 'ja', COPY[5]['ja'].replace('>35%', '35%以上')),
            (6, 'en', COPY[6]['en'].replace('50%+', '50%')),
            (6, 'ja', COPY[6]['ja'].replace('50%+', '50%')),
            (6, 'en', COPY[6]['en'].replace('50%+', '>50%')),
            (6, 'ja', COPY[6]['ja'].replace('50%+', '50%超')),
        ]
        for index, language, text in wrong:
            with self.subTest(index=index, language=language, text=text):
                facts = deepcopy(COPY)
                facts[index][language] = text
                self.assert_review(facts)

    def test_forecasts_cannot_become_reported_results_in_either_language(self):
        wrong = [
            (0, 'en', COPY[0]['en'].replace('is expected to stay', 'remained')),
            (0, 'ja', COPY[0]['ja'].replace('逼迫が続くと見込む', '逼迫が続いている')),
            (2, 'en', COPY[2]['en'].replace('is forecast to expand', 'expanded')),
            (3, 'en', COPY[3]['en'].replace('is estimated at', 'was')),
            (4, 'ja', COPY[4]['ja'].replace('と見込む', 'となった')),
            (5, 'en', COPY[5]['en'].replace('may be conservative', 'was conservative')),
            (5, 'ja', COPY[5]['ja'].replace('保守的な可能性があるとみる', '保守的だった')),
        ]
        for index, language, text in wrong:
            with self.subTest(index=index, language=language):
                facts = deepcopy(COPY)
                facts[index][language] = text
                self.assert_review(facts)

    def test_wrong_broker_attribution_and_invented_rating_or_target_are_rejected(self):
        additions = [
            ('en', ' Morgan Stanley expects this outlook.'),
            ('ja', 'これはMorgan Stanleyの予想だ。'),
            ('en', ' JPMorgan rates Micron Overweight.'),
            ('ja', 'JPMorganのMicronの投資判断はOverweight。'),
            ('en', ' JPMorgan raised its price target.'),
            ('ja', 'JPMorganは目標株価を引き上げた。'),
        ]
        for language, addition in additions:
            with self.subTest(language=language, addition=addition):
                facts = deepcopy(COPY)
                facts[5][language] += addition
                self.assert_review(facts)

    def test_true_and_ambiguous_financial_actions_never_enter_commentary_assessment(self):
        bodies = [
            'JPMorgan upgrades Micron $MU to Overweight from Neutral.',
            'Micron $MU price target raised to $250 from $200 at JPMorgan.',
            'JPMorgan sees Micron $MU at $250, up from $200, with memory supply remaining tight.',
            'JPMorgan puts Micron $MU at 250 from 200, citing tight memory supply.',
            'JPMorgan rates Micron $MU Overweight and sees memory supply remaining tight through 2028.',
            'JPMorgan sees memory supply remaining tight through 2028. Micron $MU is a top pick.',
            BODY + '\n\nJPMorgan maintains an Overweight rating on Micron.',
            BODY + '\n\nJPMorgan price objective: 250.',
        ]
        for index, body in enumerate(bodies):
            with self.subTest(body=body):
                case = self.database()
                self.raw(case, body, number=3300000000000000000 + index)
                self.admit(case)
                with research.connect(case.path) as db:
                    self.assertEqual(news.candidates(db, NOW), [])
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_explicit_model_review_is_terminal_without_publication_or_extra_calls(self):
        self.assert_review([], decision='review', reason='insufficient-source-evidence')

    def test_source_revision_change_during_publish_or_review_is_stale(self):
        for decision in ('publish', 'review'):
            with self.subTest(decision=decision):
                case = self.database()
                self.raw(case)

                def revise(*_):
                    self.raw(case, 'Correction: the earlier memory outlook is withdrawn and should not be relied upon.',
                             first_seen_at='2026-10-03T13:39:00Z', last_seen_at='2026-10-03T13:39:00Z')
                    return result(facts=COPY) if decision == 'publish' else result('review', 'insufficient-source-evidence', [])

                self.assertEqual(self.run_once(case, revise), 'stale')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db, NOW), [])
                    self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0], 0)
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)

    def test_revision_after_terminal_review_can_be_assessed_once(self):
        case = self.assert_review([], decision='review', reason='insufficient-source-evidence')
        body = BODY.replace('2031', '2032')
        raw = self.raw(case, body, first_seen_at='2026-10-03T13:39:00Z', last_seen_at='2026-10-03T13:39:00Z')
        facts = deepcopy(COPY)
        for language in ('ja', 'en'):
            facts[1][language] = facts[1][language].replace('2031', '2032')
        self.assertEqual(self.run_once(case, lambda *_: result(facts=facts)), 'done')
        with research.connect(case.path) as db:
            self.assertEqual(len(news.public_items(db, NOW)), 1)
            self.assertEqual(news.candidates(db, NOW)[0]['sha'], raw['sha'])
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 2)

    def test_shared_budget_and_existing_headline_reserve_are_reused(self):
        case = self.database()
        self.raw(case)
        with research.connect(case.path) as db:
            db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                          [(NOW.timestamp(), 'existing', 'sha', 'approved', 'failed', str(i)) for i in range(199)])
        with patch.object(headline_translation, 'diagnostics', return_value={'pending': 1}):
            self.assertEqual(self.run_once(case, lambda *_: self.fail('headline reserve consumed')), 'idle')
        self.assertEqual(self.run_once(case, lambda *_: result(facts=COPY)), 'done')
        self.raw(case, BODY.replace('2031', '2032'), number=3400000000000000000)
        self.assertEqual(self.run_once(case, lambda *_: self.fail('shared cap exceeded')), 'idle')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 200)

    def test_original_body_integrity_and_clock_gates_are_not_relaxed(self):
        for changes in (
            {'sha': 'wrong-sha'}, {'truncated': 1},
            {'first_seen_at': '2026-10-03'}, {'last_seen_at': '2026-10-03T13:34:00Z'},
        ):
            with self.subTest(changes=changes):
                case = self.database()
                self.raw(case, **changes)
                self.assertEqual(self.run_once(case, lambda *_: self.fail('invalid original evidence reached provider')), 'idle')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db, NOW), [])
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_public_read_revalidates_saved_claim_scope_and_source(self):
        case = self.database()
        self.raw(case)
        self.assertEqual(self.run_once(case, lambda *_: result(facts=COPY)), 'done')
        with research.connect(case.path) as db:
            saved = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            saved['facts'][2]['en'] = COPY[2]['en'].replace('HBM bit demand', 'Micron HBM bit demand')
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(saved),))
            self.assertEqual(news.public_items(db, NOW), [])
            db.execute("UPDATE signal_documents SET text='Tampered original source without a matching SHA.'")
            self.assertEqual(news.public_items(db, NOW), [])


if __name__ == '__main__':
    unittest.main()
