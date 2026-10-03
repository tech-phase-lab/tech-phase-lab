import copy
import json
from pathlib import Path
import sys
import unittest
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import news_history
import signals
import monitor
import tempfile


def row(index,size=40):
    return {'id':str(index),'title':'Synthetic company update','url':'https://nebius.com/blog/history-'+str(index),
      'publisher':'Nebius','tickers':['NBIS'],'publishedAt':(datetime(2026,10,3,tzinfo=timezone.utc)-timedelta(minutes=index)).isoformat(),
      'observedAt':'2026-10-03T08:00:00Z','bodyJa':'あ'*size,'bodyEn':'a'*size}


class NewsHistoryTests(unittest.TestCase):
    def test_current_production_sized_history_preserves_all_rows_and_other_sections(self):
        payload={'ok':True,'enabled':False,'items':[],'officialUpdates':[row(i) for i in range(49)],
          'analystUpdates':[{'id':str(i)} for i in range(9)],'officialResearch':[{'id':'ir-result-1','summary':{'ja':'要点','en':'Facts'}}],
          'marketUpdates':[],'resultBriefs':[]}
        result=news_history.bounded(payload)
        self.assertEqual(result['officialUpdates'],payload['officialUpdates'])
        for key in ('analystUpdates','officialResearch','marketUpdates','resultBriefs'):
            self.assertEqual(result[key],payload[key])
        self.assertFalse(result['officialHistory']['hasMore'])
        self.assertEqual(result['officialHistory']['returned'],49)
        self.assertLess(news_history.encoded_size(result),450000)

    def test_count_cap_is_display_only_and_discloses_omitted_source_order(self):
        rows=[row(i) for i in range(150)]
        payload={'ok':True,'enabled':False,'items':[],'officialUpdates':rows}
        result=news_history.bounded(payload)
        self.assertEqual(result['officialUpdates'],rows[:100])
        self.assertEqual(result['officialHistory']['omitted'],50)
        self.assertTrue(result['officialHistory']['hasMore'])
        self.assertFalse(result['officialHistory']['byteLimited'])
        self.assertEqual(len(payload['officialUpdates']),150)

    def test_max_length_bilingual_articles_and_other_sections_cannot_poison_history(self):
        # Both language fields reach the existing 12,000-character story bound.
        payload={'ok':True,'enabled':False,'items':[],'officialUpdates':[row(i,12000) for i in range(100)],
          'officialResearch':[{'facts':[{'ja':'あ'*400,'en':'b'*400} for _ in range(5)]} for _ in range(20)],
          'analystUpdates':[{'bodyJa':'あ'*1000,'bodyEn':'c'*1000} for _ in range(9)],
          'marketUpdates':[{'titleJa':'あ'*1000,'titleEn':'d'*1000} for _ in range(20)],'resultBriefs':[]}
        preserved={key:json.dumps(payload[key],ensure_ascii=False) for key in payload if key!='officialUpdates'}
        result=news_history.bounded(payload)
        self.assertLessEqual(news_history.encoded_size(result),450000)
        self.assertTrue(result['officialHistory']['byteLimited'])
        self.assertTrue(result['officialHistory']['hasMore'])
        self.assertEqual(result['officialUpdates'],payload['officialUpdates'][:len(result['officialUpdates'])])
        for key,value in preserved.items():self.assertEqual(json.dumps(result[key],ensure_ascii=False),value)

    def test_preexisting_core_near_hard_guard_gets_no_added_history_not_a_new_503(self):
        core='あ'*160000  # 480,000 UTF-8 bytes, beneath the existing 500k guard.
        payload={'ok':True,'enabled':False,'items':[],'officialUpdates':[row(0,12000)],
                 'officialResearch':[{'fixture':core}]}
        result=news_history.bounded(payload)
        self.assertLess(news_history.encoded_size(result),500000)
        self.assertEqual(result['officialUpdates'],[])
        self.assertTrue(result['officialHistory']['hasMore'])
        self.assertTrue(result['officialHistory']['coreOverTarget'])
        self.assertEqual(result['officialResearch'],payload['officialResearch'])

    def test_exact_499900_byte_core_survives_new_diagnostics_overhead(self):
        payload={'ok':True,'enabled':False,'items':[],'officialUpdates':[],
                 'officialResearch':[{'fixture':''}]}
        payload['officialResearch'][0]['fixture']='x'*(499900-news_history.encoded_size(payload))
        self.assertEqual(news_history.encoded_size(payload),499900)
        with patch.object(news_history.logging,'warning') as warning:
            result=news_history.bounded(payload)
        self.assertEqual(result,payload)
        self.assertEqual(news_history.encoded_size(result),499900)
        self.assertNotIn('officialHistory',result)
        warning.assert_called_once_with('news-history-diagnostics-omitted-response-limit')

    def test_preexisting_core_over_old_hard_guard_still_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'news-core-response-limit'):
            news_history.bounded({'ok':True,'enabled':False,'items':[],'officialUpdates':[],
                                  'officialResearch':[{'fixture':'あ'*170000}]})

    def test_public_service_only_expands_display_lookup_not_worker_defaults(self):
        import service
        app=service.AutomaticMonitor.__new__(service.AutomaticMonitor)
        with tempfile.TemporaryDirectory() as tmp:
            app.db_path=Path(tmp)/'test.sqlite'
            def sync_headlines(db, **kwargs):
                db.execute("INSERT INTO news_intake_state(key,value) VALUES('sync','1')")
                return [row(i) for i in range(49)]
            with patch.object(service.news_drafts,'publication_enabled',return_value=True), \
                 patch.object(service.signals,'public_official_updates',side_effect=sync_headlines) as public, \
                 patch.object(service.x_market_news,'public_feed',return_value=[]), \
                 patch.object(service.analyst_news,'public_feed',return_value=[]), \
                 patch.object(service.market_results,'public_feed',return_value=[]), \
                 patch.object(service.official_research,'feed',return_value=[]):
                result=app.public_news()
                self.assertEqual(public.call_args.kwargs['limit'],500)
                self.assertIsInstance(public.call_args.kwargs['reference'],datetime)
                self.assertEqual(len(result['officialUpdates']),49)
                self.assertTrue(result['enabled'])
        self.assertEqual(signals.public_official_updates.__defaults__[2],20)

    def test_extended_history_still_excludes_future_and_older_than_seven_days(self):
        now=datetime(2026,10,3,8,tzinfo=timezone.utc)
        source=next(s for s in signals.SOURCES if s['id']=='nebius-blog')
        with tempfile.TemporaryDirectory() as tmp,monitor.connect(Path(tmp)/'time.sqlite') as db:
            signals.schema(db)
            for index,when in enumerate((now-timedelta(hours=2),now+timedelta(days=1),now-timedelta(days=8))):
                db.execute('''INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,matches_json,
                  event_kind,published_at,observed_at,excerpt,diff,truncated) VALUES(?,?,?,'',?,'["NBIS"]','{}','new',?,?, '','',0)''',
                  (source['id'],'https://nebius.com/blog/time-'+str(index),str(index),'News '+str(index),when.isoformat(),when.isoformat()))
            result=signals.public_official_updates(db,sources=[source],reference=now,limit=500)
            self.assertEqual([r['title'] for r in result],['News 0'])

if __name__=='__main__':unittest.main()
