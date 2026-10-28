"""Real collector/service/worker/public replay with fake network/provider only."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import unittest
from unittest.mock import patch

import test_macro_fresh_service as harness
import test_attributed_policy_publication as fixture
from test_attributed_policy_publication import BODY, NOW, policy, grammar, news, research, response


def replay(order,**kwargs):
    return harness.replay(BODY,order,adapter=policy,grammar_module=grammar,**kwargs)


class PolicyServiceTests(unittest.TestCase):
    def test_fresh_both_worker_orders_and_restarts_one_assessment_full_copy(self):
        for order in (['results','official','official'],['official','results','official']):
            with self.subTest(order=order):
                value=replay(order,restart=True)
                self.assertEqual(value['final'],{'rawUnchanged':True,'callCount':1,'apiReservationCount':1})
                self.assertEqual(value['public']['resultBriefs'],[])
                self.assertEqual(len(value['public']['officialUpdates']),1)
                item=value['public']['officialUpdates'][0];raw=value['collectedRaw'][0];copy=grammar.derive(BODY)
                self.assertEqual(item['bodyJa'],'\n\n'.join(f['ja'] for f in copy['facts']))
                self.assertEqual(item['bodyEn'],'\n\n'.join(f['en'] for f in copy['facts']))
                self.assertEqual(item['title'],copy['titleEn']);self.assertEqual(item['translationJa'],copy['titleJa'])
                self.assertEqual(item['publishedAt'],raw['published_at']);self.assertEqual(item['observedAt'],raw['first_seen_at'])
                self.assertEqual(item['tickers'],[]);self.assertEqual(value['steps'][-1]['auditCount'],1)
                self.assertEqual(len(value['postExpiryRead']['fullPublicItems']),1)

    def test_source_or_parser_withdrawal_no_retry_or_flash_fallback(self):
        for option in ('withdraw','corrupt_body','parser_change'):
            with self.subTest(option=option):
                value=replay(['official','results'],**{option:True})
                self.assertEqual(value['final']['callCount'],1)
                self.assertEqual(value['public']['officialUpdates'],[]);self.assertEqual(value['public']['resultBriefs'],[])

    def test_negative_source_and_concurrent_result_worker_stays_bounded(self):
        for negative in (False,True):
            value=replay(['official','results','official'],negative=negative,during_assessment=True)
            self.assertEqual(value['final']['callCount'],1)
            self.assertEqual(value['public']['resultBriefs'],[])
            self.assertEqual(len(value['public']['officialUpdates']),int(not negative))

    def test_missing_raw_proof_makes_no_assessment(self):
        value=replay(['results','official'],missing_raw=True)
        self.assertEqual(value['final']['callCount'],0);self.assertEqual(value['public']['officialUpdates'],[])

    def test_old_1247_raw_shape_real_service_recovers_without_provider(self):
        case=fixture.PolicyPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
        row=case.hold()
        with research.connect(case.path) as db:before=policy.artifacts(db,row)
        app=harness.service.AutomaticMonitor(case.path,Path(case.temp.name)/'snapshot.json');app.news_stale_seconds=0  # next-read withdrawal check
        app.stop_event.clear();wake=app.publication_wakes['official']
        original=research.run_once
        def worker(path,*args,**kwargs):
            with patch.object(research,'datetime') as clock:
                clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=NOW
                return original(path,lambda *_:self.fail('paid recovery'),{},NOW.timestamp())
        with patch.object(wake,'wait',side_effect=lambda *_:app.stop_event.set()),patch.object(research,'run_once',side_effect=worker):
            app.run_official_research()
        with patch.object(harness.service,'datetime') as clock:
            clock.now.return_value=NOW
            public=app.public_news()
        self.assertEqual(len(public['officialUpdates']),1);self.assertEqual(public['resultBriefs'],[])
        self.assertEqual(public['officialUpdates'][0]['observedAt'],row['observed_at'])
        with research.connect(case.path) as db:self.assertEqual(policy.artifacts(db,row),before)
