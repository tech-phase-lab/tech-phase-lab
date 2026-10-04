"""Current terminal assessments are inspectable without becoming retry jobs."""
from copy import deepcopy
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_broker_outlook as broker
import official_research as research
import official_research_diagnostics as diagnostics


class TerminalReviewDiagnosticsTests(unittest.TestCase):
    def failed(self, *, explicit_review=False):
        fixture=broker.BrokerOutlookTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        case=fixture.database()
        fixture.raw(case)
        row=fixture.candidate(case)
        facts=deepcopy(broker.COPY)
        facts[2]['en']=facts[2]['en'].replace('bit demand','demand')
        value={'disposition':'publish','reason':'material-company-development','facts':facts}
        if explicit_review:
            value={'disposition':'review','reason':'ambiguous-actor-or-action','facts':[]}
        response={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(value)}]}]}
        self.assertEqual(fixture.run_once(case,lambda *_:response),'review')
        return case,row,value

    def queue(self,case,**kwargs):
        return diagnostics.queue(case.path,reference=broker.NOW,**kwargs)

    def context(self,item):
        return [check for issue in item['latestFailure']['validation']['issues']
                for check in issue['checks'] if check.get('check')=='editor-only-current-failed-output']

    def test_zero_pending_retains_separate_exact_failed_copy_and_proof(self):
        case,row,value=self.failed()
        before=sqlite3.connect(case.path)
        original=list(before.iterdump());before.close()
        with patch.object(research,'run_once',side_effect=AssertionError('no generation')):
            result=self.queue(case)
        self.assertEqual(result['counts'],{'candidates':0,'validatedPublications':0,'pending':0})
        self.assertEqual(result['items'],[])
        self.assertEqual(result['filteredTotal'],0)
        terminal=result['terminalReviews']
        self.assertEqual((terminal['total'],terminal['omitted']),(1,0))
        item=terminal['items'][0]
        self.assertEqual(item['eventId'],row['id'])
        self.assertEqual(item['status'],'terminal-review')
        self.assertEqual(item['review']['reason'],'unsubstantiated-model-output')
        self.assertEqual(item['job']['state'],'review')
        self.assertIsNone(item['job']['nextRetryAt'])
        self.assertEqual(item['job']['attempts'],1)
        self.assertEqual(item['latestFailure']['reason'],'changed-broker-metric')
        self.assertEqual(item['latestFailure']['validation']['issues'][0]['issue'],'changed-broker-metric')
        context=self.context(item)[0]
        self.assertTrue(context['generationBodyVerified'])
        self.assertEqual(context['sourceSha'],broker.SOURCE_SHA)
        self.assertEqual(context['currentBodySha'],broker.BODY_SHA)
        self.assertEqual(context['recordedGenerationBodySha'],broker.BODY_SHA)
        self.assertEqual(len(context['fields']),7)
        for index,field in enumerate(context['fields']):
            self.assertEqual(field['ja'],value['facts'][index]['ja'])
            self.assertEqual(field['en'],value['facts'][index]['en'])
            self.assertIn(field['selectedEvidence'],broker.BODY)
        with sqlite3.connect(case.path) as db:
            self.assertEqual(list(db.iterdump()),original)
        self.assertEqual(self.queue(case,view='all')['terminalReviews'],terminal)

    def test_model_review_without_failed_output_is_honest_and_empty(self):
        case,_,_=self.failed(explicit_review=True)
        result=self.queue(case)
        item=result['terminalReviews']['items'][0]
        self.assertEqual(item['review']['reason'],'ambiguous-actor-or-action')
        self.assertIsNone(item['latestFailure'])
        self.assertFalse(result['rawCopyIncluded'])

    def test_missing_or_wrong_generation_proof_never_exposes_terminal_copy(self):
        for sql in (
            'DELETE FROM official_research_attempt_body_proofs',
            "UPDATE official_research_attempt_body_proofs SET source_sha='different'",
            "UPDATE official_research_attempt_body_proofs SET body_sha='different'",
            "UPDATE official_research_attempt_failures SET payload=NULL",
        ):
            with self.subTest(sql=sql):
                case,_,_=self.failed()
                with sqlite3.connect(case.path) as db:db.execute(sql)
                result=self.queue(case)
                self.assertFalse(result['rawCopyIncluded'])
                item=result['terminalReviews']['items'][0]
                self.assertEqual(self.context(item),[])
                self.assertEqual(item['latestFailure']['failedCopyContext'],'unavailable')

    def test_stale_decision_lease_source_body_or_supersession_is_not_current_review(self):
        for sql in (
            "UPDATE general_source_semantic_reviews SET lease='different'",
            "UPDATE general_source_semantic_reviews SET sha='different'",
            "UPDATE general_source_semantic_reviews SET body_sha='different'",
            "UPDATE official_research_jobs SET lease='different'",
            "UPDATE official_research_jobs SET sha='different'",
            "UPDATE official_research_jobs SET state='running'",
            "UPDATE signal_documents SET sha='different'",
            "UPDATE signal_documents SET text=text || ' source changed'",
            "UPDATE signal_x_acquisition SET sha='newer-source',last_seen_at='2026-10-03T13:39:00+00:00'",
        ):
            with self.subTest(sql=sql):
                case,_,_=self.failed()
                with sqlite3.connect(case.path) as db:db.execute(sql)
                result=self.queue(case)
                self.assertEqual(result['terminalReviews']['items'],[])
                self.assertFalse(result['rawCopyIncluded'])

    def test_unknown_fields_secrets_and_long_copy_are_bounded(self):
        case,_,value=self.failed()
        value['provider']={'headers':'SECRET-HEADER','systemPrompt':'SECRET-SYSTEM'}
        value['facts'][0].update(ja='長'*900,en='x'*900,secret='SECRET-ITEM')
        with sqlite3.connect(case.path) as db:
            db.execute('UPDATE official_research_attempt_failures SET payload=?',(json.dumps(value),))
        result=self.queue(case)
        context=self.context(result['terminalReviews']['items'][0])[0]
        first=context['fields'][0]
        self.assertEqual((len(first['ja']),len(first['en'])),(600,600))
        self.assertTrue(first['jaTruncated'] and first['enTruncated'])
        self.assertNotIn('SECRET-',json.dumps(result))
        self.assertLessEqual(len(json.dumps(context,ensure_ascii=False).encode()),48000)

    def test_terminal_context_obeys_shared_response_budget_and_record_limit(self):
        case,row,_=self.failed()
        with research.connect(case.path) as db:
            section,included=diagnostics.terminal_review_diagnostics(db,broker.NOW,50,1)
            self.assertFalse(included)
            self.assertEqual(section['items'][0]['latestFailure']['failedCopyContext'],'response-budget')
            job=dict(db.execute('SELECT * FROM official_research_jobs').fetchone())
            decision=dict(db.execute('SELECT * FROM general_source_semantic_reviews').fetchone())
            rows=[]
            for i in range(60):
                current={**row,'id':row['id']+100+i};rows.append(current)
                db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                           (current['id'],job['sha'],job['attempts'],job['next_at'],job['lease'],job['state'],job['failure_kind']))
            # The underlying current-revision proof is tested above. This
            # isolates response limits without manufacturing 60 model calls.
            with patch.object(research.general_source_news,'candidates',return_value=rows), \
                 patch.object(research.general_source_news,'semantic_review',return_value=decision), \
                 patch.object(research,'current_revision',return_value=True):
                section,_=diagnostics.terminal_review_diagnostics(db,broker.NOW,50,200000)
                self.assertEqual((len(section['items']),section['total'],section['omitted']),(50,60,10))
                self.assertTrue(all(item['status']=='terminal-review' for item in section['items']))
                continuation,_=diagnostics.terminal_review_diagnostics(db,broker.NOW,50,200000,
                    section['pagination']['nextBeforeEventId'])
                ids=[item['eventId'] for item in section['items']+continuation['items']]
                self.assertEqual(ids,sorted([row['id'] for row in rows],reverse=True))
                self.assertEqual(len(set(ids)),60)
                self.assertEqual(continuation['pagination']['remaining'],0)
                self.assertIsNone(continuation['pagination']['nextBeforeEventId'])
                self.assertEqual(continuation['total'],60)


if __name__=='__main__':unittest.main()
