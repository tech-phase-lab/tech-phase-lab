"""Adversarial retained-evidence checks; no network or provider requests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import general_source_news as news
import official_research as research
import signals

NOW = datetime(2026, 10, 3, 8, 0, tzinfo=timezone.utc)
SOURCE = next(s for s in signals.SOURCES if s['id'] == 'x-wallstengine')
OUTLOOK = ('Micron $MU CEO: \n\n“We expect fiscal 2027 to be even better. '
           'Industry demand has strengthened since our last earnings call, and we expect memory '
           'and storage supply-demand conditions to be much tighter in fiscal 2027 and 2028 '
           'than they were in 2026.”')
BROKERS = ('Micron’s $MU Q4 reinforced the same story across Wall Street – AI memory demand '
           'remains strong, supply is tightening, and earnings durability may still be underestimated.\n\n'
           'TD Cowen: Buy | $1,600\nDemand durability keeps improving, with revenue guidance '
           'well above expectations and AI memory upside beyond signed long-term agreements.\n\n'
           'JPMorgan: Overweight | $1,540\nCalled Q4 a “decisive beat-and-raise,” highlighting '
           'tighter supply-demand conditions and stronger multi-year earnings power.\n\n'
           'RBC: Outperform | $1,500\nSees supply-demand tightening further into 2027-28 and '
           'believes floor-pricing agreements still receive little credit in the stock.\n\n'
           'Morgan Stanley: Overweight | $1,200\nSays the business continues to show strength, '
           'with Micron’s earnings durability still underappreciated despite more normalized beats.')


def assessment(body, **changes):
    title = ' '.join(body.split())[:500]
    row = {'id': 100, 'source_id': SOURCE['id'], 'url': 'https://x.com/TipRanks/status/123',
           'title': title, 'document_title': title, 'body': body, 'truncated': False,
           'event_kind': 'new', 'tickers_json': '["MU"]',
           'published_at': '2026-10-03T07:00:00Z', 'observed_at': '2026-10-03T07:00:01Z'}
    row['sha'] = row['current_sha'] = news.digest(title + '\n' + body)
    row.update(changes)
    return news.x_assess(row, SOURCE, NOW, {row['url'].casefold(): row['sha']})


class GeneralSourceAdversarialTests(unittest.TestCase):
    def assert_rejects_pair(self, quote, ja, en, **unit):
        with self.assertRaises(ValueError):
            news.validate_pair({'ja': ja, 'en': en}, {'quote': quote, 'actor': 'report', **unit})

    def test_retained_management_and_four_broker_examples_are_supported(self):
        for body, category in [(OUTLOOK, 'management-outlook'), (BROKERS, 'broker-commentary')]:
            with self.subTest(category=category):
                row, reason = assessment(body)
                self.assertEqual(reason, 'eligible')
                self.assertEqual(row['category'], category)
        row, _ = assessment(BROKERS)
        self.assertEqual([(u['actor'], u['target']) for u in row['units'] if 'target' in u],
                         [('TD Cowen', '$1,600'), ('JPMorgan', '$1,540'),
                          ('RBC', '$1,500'), ('Morgan Stanley', '$1,200')])
        self.assertTrue(all('target' not in u or u['target'] not in u['quote'] for u in row['units']))

    def test_cashtag_cannot_override_a_different_company_actor(self):
        cases = [
            'Microsoft $MU CEO: We expect semiconductor demand to expand next year.',
            'Microsoft launched a new cloud product today. Micron $MU was mentioned separately in background.',
            'The acquisition of Company A by Company B is complete. $MU is not involved in the transaction.',
        ]
        for body in cases:
            with self.subTest(body=body):
                row, reason = assessment(body)
                self.assertIsNone(row, reason)

    def test_ticker_evidence_is_a_list_of_strings(self):
        for tickers in ['{"MU": true}', '"MU"', 'null', '["MU", 7]']:
            with self.subTest(tickers=tickers):
                row, reason = assessment(OUTLOOK, tickers_json=tickers)
                self.assertIsNone(row, reason)

    def test_bound_business_categories_and_other_configured_companies(self):
        for sentence, category in [
            ('signed an agreement to supply memory for a new industrial project.', 'contract'),
            ('plans to acquire SensorWorks following regulatory approval.', 'acquisition'),
            ('launched a memory product for industrial customers.', 'product'),
            ('will expand capacity at its existing manufacturing facility.', 'capacity'),
        ]:
            with self.subTest(category=category):
                row, reason = assessment('Micron $MU ' + sentence)
                self.assertEqual(reason, 'eligible')
                self.assertEqual(row['category'], category)
        row, reason = assessment('NVIDIA $NVDA CEO: We expect stronger infrastructure demand next year.',
                                 tickers_json='["NVDA"]')
        self.assertEqual(reason, 'eligible')
        self.assertEqual(row['ticker'], 'NVDA')

    def test_source_clock_requires_exact_aware_timestamp_and_seven_day_window(self):
        for published in ['2026-10-03 07:00:00+00:00', '20261003T070000Z', '2026-10-03',
                          '2026-09-26T07:59:59Z', '2026-10-03T08:00:01Z']:
            with self.subTest(published=published):
                row, reason = assessment(OUTLOOK, published_at=published)
                self.assertIsNone(row, reason)
        row, reason = assessment(OUTLOOK, published_at='2026-09-26T08:00:00Z')
        self.assertEqual(reason, 'eligible')

    def test_duplicate_origin_order_uses_instants_not_iso_string_order(self):
        base, _ = assessment(OUTLOOK)
        earlier = {**base, 'id': 2, 'published_at': '2026-10-03T00:30:00+02:00',
                   'observed_at': '2026-10-03T00:31:00+02:00'}
        later = {**base, 'id': 3, 'published_at': '2026-10-02T23:00:00Z',
                 'observed_at': '2026-10-02T23:01:00Z'}
        with patch.object(news, 'assessments', return_value=[({},later,'eligible'),({},earlier,'eligible')]):
            rows = news.candidates(None,NOW)
        self.assertEqual([row['id'] for row in rows], [2])

    def test_publication_clock_is_aware_ordered_and_not_in_the_future(self):
        row, _ = assessment(OUTLOOK)
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        db.execute('CREATE TABLE official_research_publications(event_id,sha,body_sha,payload,started_at,public_at)')
        db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?)',
                   (row['id'],row['sha'],row['body_sha'],'{}','2026-10-03T07:30:00Z','2026-10-03T07:31:00Z'))
        with patch.object(news,'candidates',return_value=[row]), patch.object(news,'validate_note',return_value={}):
            self.assertEqual(len(news.publications(db,NOW)),1)
            for start,public in [
                ('2026-10-03T06:00:00Z','2026-10-03T07:31:00Z'),
                ('2026-10-03T07:30:00Z','2026-10-03T07:29:00Z'),
                ('2026-10-03T07:30:00','2026-10-03T07:31:00Z'),
                ('2026-10-03T07:30:00Z','2026-10-03T08:00:01Z'),
            ]:
                with self.subTest(start=start,public=public):
                    db.execute('UPDATE official_research_publications SET started_at=?,public_at=?',(start,public))
                    self.assertEqual(news.publications(db,NOW),[])
            self.assertEqual(len(news.publications(db,NOW+timedelta(seconds=2))),1)

    def test_retracted_duplicate_origin_does_not_revoke_an_independent_report(self):
        copies = {'facts': [
            {'ja':'経営陣はFY2027が一段と好調になると見込む。',
             'en':'Management forecasts a stronger fiscal 2027.','evidenceId':'0'},
            {'ja':'前回の決算説明会以降、業界の需要は強まった。メモリーとストレージの需給はFY2027と2028に、2026よりも逼迫すると見込む。',
             'en':'Since the prior earnings call, industry demand has increased. Memory and storage markets are expected to be tighter in fiscal 2027 and 2028 than in 2026.','evidenceId':'1'},
        ]}
        with tempfile.TemporaryDirectory() as directory:
            with research.connect(Path(directory)/'test.sqlite') as db:
                originals=[]
                for number,account in [(1,'wallstengine'),(2,'TipRanks')]:
                    item={'url':f'https://x.com/{account}/status/{number}',
                          'title':' '.join(OUTLOOK.split())[:500],'text':OUTLOOK,
                          'publishedAt':'2026-10-03T07:00:00Z','matches':{'MU':['$MU']},'truncated':False}
                    originals.append(item)
                    signals.save(db,SOURCE,[item],{},f'2026-10-03T07:0{number}:00Z','synthetic',1)
                rows=[row for _,row,_ in news.assessments(db,NOW) if row]
                self.assertEqual(len(rows),2)
                for row in rows:
                    note=news.bind_note(copies,row)
                    db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                               (row['id'],row['sha'],row['body_sha'],json.dumps(note),'[]',
                                '2026-10-03T07:30:00Z','2026-10-03T07:31:00Z',1))
                db.commit()
                self.assertEqual(news.public_items(db,NOW)[0]['url'],originals[0]['url'])
                for index,original in enumerate(originals):
                    correction={**original,'title':'Correction: this report is withdrawn.',
                                'text':'Correction: this report is withdrawn.'}
                    signals.save_evidence(db,SOURCE,[],{'_acquired_posts':[correction]},
                                          f'2026-10-03T07:4{index}:00Z')
                    db.commit()
                    feed=news.public_items(db,NOW)
                    if index==0:
                        self.assertEqual([item['url'] for item in feed],[originals[1]['url']])
                    else:
                        self.assertEqual(feed,[])

    def test_unapproved_account_cannot_use_an_approved_route(self):
        row, reason = assessment(OUTLOOK, url='https://x.com/FABYMETAL4/status/123')
        self.assertIsNone(row)
        self.assertEqual(reason, 'source-not-approved')

    def test_translation_cannot_change_the_company_actor(self):
        self.assert_rejects_pair('Micron expects stronger memory demand.',
                                 'Microsoftはメモリー需要の拡大を見込む。',
                                 'Microsoft anticipates an increase in memory demand.')

    def test_forecast_on_one_clause_cannot_cover_completed_second_clause(self):
        self.assert_rejects_pair('Micron expects demand to strengthen. Supply could tighten later.',
                                 'Micronは需要拡大を見込む。供給はすでに逼迫した。',
                                 'Micron forecasts expanding demand. Supply already tightened.')

    def test_possible_acquisition_cannot_become_completed_with_forecast_padding(self):
        self.assert_rejects_pair('Micron could acquire the memory business after approval.',
                                 'Micronはメモリー事業を買収済みで、利益拡大を見込む。',
                                 'Micron completed the acquisition and expects stronger profits.')

    def test_no_number_evidence_does_not_support_an_unrelated_claim(self):
        self.assert_rejects_pair('Micron reports growing memory demand.',
                                 'Micronは従業員を全員解雇した。',
                                 'Micron dismissed all its employees.')

    def test_modal_may_is_not_the_calendar_month(self):
        news.validate_pair({'ja': 'Micronはメモリー需要が一段と強まる可能性がある。',
                            'en': 'Micron could see stronger demand for memory.'},
                           {'quote': 'Micron may see stronger memory demand.', 'actor': 'report'})

    def test_comparison_year_order_and_fiscal_basis_are_preserved(self):
        quote = ('Micron expects conditions to be tighter in fiscal 2027 and 2028 '
                 'than they were in 2026.')
        self.assert_rejects_pair(quote,
                                 'Micronは2026年度と2028年度の需給が2027年度より逼迫すると予想する。',
                                 'Micron forecasts tighter conditions in fiscal 2026 and 2028 than in 2027.')
        self.assert_rejects_pair(quote,
                                 'Micronは2027年と2028年の需給が2026年より逼迫すると予想する。',
                                 'Micron forecasts tighter conditions in 2027 and 2028 than in 2026.')

    def test_no_raw_repost_or_cross_unit_target_borrowing(self):
        quote = 'Memory demand is increasing as customers expand infrastructure.'
        self.assert_rejects_pair(quote, '顧客のインフラ拡張に伴いメモリー需要が増加している。', quote)
        self.assert_rejects_pair(quote, '目標株価は$1,600。', 'The price target is $1,600.')

    def test_note_binding_and_revalidation_keep_exact_private_units(self):
        quote = 'Memory demand is increasing as customers expand infrastructure.'
        row = {'units': [{'id': '0', 'actor': 'report', 'quote': quote}]}
        value = {'facts': [{'ja': '顧客のインフラ拡張によりメモリー需要が増加している。',
                            'en': 'Customer infrastructure expansion is driving higher demand for memory.',
                            'evidenceId': '0'}]}
        note = news.bind_note(value, row)
        self.assertEqual(news.validate_note(note, row), note)
        bad = deepcopy(note)
        bad['facts'][0]['evidenceQuote'] += ' Changed.'
        with self.assertRaises(ValueError):
            news.validate_note(bad, row)
        bad = deepcopy(value)
        bad['facts'][0]['evidenceId'] = '1'
        with self.assertRaises(ValueError):
            news.bind_note(bad, row)


if __name__ == '__main__':
    unittest.main()
