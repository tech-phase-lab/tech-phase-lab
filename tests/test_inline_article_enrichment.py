"""Replay real RSS teaser bytes through the existing article enrichment worker.

HTML markup is synthetic; its article text is the independently verified
scoped release fixture. No live DB, provider or network access is used.
"""
from datetime import datetime, timezone, timedelta
from html import escape
from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import official_research as research
import official_research_editorial_recovery as recovery
import official_headline_corrections as source
import signals
from test_headline_translation import ENV

NOW=datetime(2026,10,4,1,50,tzinfo=timezone.utc)
OBSERVED='2026-09-28T11:05:29.215+00:00'
BODY=(Path(__file__).parent/'fixtures/nvidia-buyback-scoped-20260928.txt').read_text()
TEASER=next(line for line in BODY.splitlines() if line.startswith('NVIDIA today announced'))
HTML=('<html><head><link rel="canonical" href="'+source.URL+'"><meta property="og:title" content="'+source.TITLE+'"></head><body><div class="article">'
      '<h1>'+source.TITLE+'</h1><div class="article-date">September 28, 2026</div>'
      +''.join('<p>'+escape(line)+'</p>' for line in BODY.splitlines()[2:])+'</div></body></html>').encode()
RSS=('<rss><channel><item><title>'+source.TITLE+'</title><link>'+source.URL+'</link>'
     '<pubDate>Mon, 28 Sep 2026 11:05:00 +0000</pubDate><description>'+escape(TEASER)+'</description>'
     '</item></channel></rss>').encode()
RESULT={'status':'ok','candidates':1,'error':None,'sourceUrl':monitor.INDEXES['NVDA']}


class InlineArticleEnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'db.sqlite'
        with research.connect(self.path) as db,patch.object(monitor,'now',return_value=OBSERVED):
            self.links=monitor.feed_links(RSS,'NVDA','text/xml',monitor.INDEXES['NVDA'])
            monitor.save_discovery(db,'NVDA',RESULT,self.links)
            monitor.add_release_events(db,'NVDA',[source.URL])
            signals.public_official_updates(db,reference=NOW)

    def source(self,db):
        return dict(db.execute('SELECT * FROM sources WHERE url=?',(source.URL,)).fetchone())

    def test_real_213_character_feed_is_valid_inline_evidence_not_a_failed_fetch(self):
        self.assertEqual((len(TEASER),len(TEASER.encode())),(213,215))
        self.assertEqual(hashlib.sha256(TEASER.encode()).hexdigest(),
                         '8cea7fc31642fee2b17ce4ad78fcd7ed2b863fd50aae93f0611fa7aa66063db8')
        with research.connect(self.path) as db:
            row=self.source(db)
            self.assertEqual(row['source_mode'],'inline')
            self.assertEqual(row['content_type'],'text/xml')
            self.assertEqual(row['extracted_text'],TEASER)
            self.assertIsNone(row['error'])
            self.assertEqual(db.execute('SELECT count(*) FROM article_response_rechecks').fetchone()[0],0)
            self.assertEqual(len(signals.public_official_updates(db,reference=NOW)),1)

    def test_63_headlines_due_and_fresh_caches_do_not_starve_never_enriched_inline_story(self):
        with research.connect(self.path) as db:
            before=self.source(db)
            for index in range(62):
                url='https://nvidianews.nvidia.com/news/enrichment-fixture-'+str(index)
                title='NVIDIA announces a developer platform '+str(index)
                sha=hashlib.sha256(str(index).encode()).hexdigest()
                monitor.add_source(db,'NVDA',url,'2026-10-03',title)
                db.execute("UPDATE sources SET sha256=?,source_mode='inline',content_type='text/xml',extracted_text='Fixture teaser',extracted_chars=14 WHERE url=?",(sha,url))
                db.execute('INSERT INTO source_revisions VALUES(?,?,?,?,?,?,?)',
                           (url,sha,'2026-10-03T12:00:00+00:00','text/xml',14,'Fixture teaser',14))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                           (url,'NVDA','2026-10-03T12:00:00+00:00'))
            items=signals.public_official_updates(db,reference=NOW,limit=100)
            self.assertEqual(len(items),63)
            self.assertEqual(items[-1]['url'],source.URL)
            for item in items[:-1]:
                row=db.execute('SELECT * FROM signal_events WHERE id=?',(item['id'],)).fetchone()
                db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                           (row['id'],row['sha'],'cached','Already enriched fixture body.',
                            '2026-10-03T12:05:00+00:00',0 if int(item['id'])%2 else NOW.timestamp()+900,None))
        requests=[]
        def request(item,validators):
            requests.append(item['url']);self.assertEqual(item['url'],source.URL)
            return {'body':HTML}
        with patch.object(signals,'fetch',side_effect=request):
            self.assertEqual(research.run_once(self.path,lambda *_:self.fail('paid model call'),ENV,NOW.timestamp()),'done')
        self.assertEqual(requests,[source.URL])
        with research.connect(self.path) as db:
            self.assertEqual(self.source(db),before)
            proof=db.execute('SELECT * FROM official_story_body_proofs').fetchone()
            self.assertEqual(proof['source_url'],source.URL)
            self.assertEqual(proof['published_on'],'2026-09-28')
            self.assertEqual(proof['body_sha'],hashlib.sha256(BODY.encode()).hexdigest())
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
            audit=db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone()
            self.assertEqual(audit['source_revision'],before['sha256'])
            self.assertEqual(audit['source_body_at'],NOW.isoformat())
            public_at=db.execute('SELECT public_at FROM official_research_publications').fetchone()[0]
            # A repeated RSS observation leaves independently acquired body proof
            # and its successful acquisition clock intact.
            with patch.object(monitor,'now',return_value=(NOW+timedelta(minutes=1)).isoformat()):
                monitor.save_discovery(db,'NVDA',RESULT,self.links)
            self.assertEqual(dict(db.execute('SELECT * FROM official_story_body_proofs').fetchone()),dict(proof))
        import service  # Defer until test execution; discovery reloads signals.
        app=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json')
        public=app.public_news()
        item=next(item for item in public['officialUpdates'] if item['url']==source.URL)
        self.assertIn('1500億ドル',item['bodyJa']);self.assertIn('2350億ドル',item['bodyJa'])
        self.assertIn('through fiscal year 2028',item['bodyEn'])
        self.assertEqual(item['publishedOn'],'2026-09-28')
        self.assertEqual(item['observedAt'],datetime.fromisoformat(OBSERVED).isoformat())
        self.assertEqual(len(public['officialResearch']),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT public_at FROM official_research_publications').fetchone()[0],public_at)
            self.assertEqual(len(research.validated_publications(db,research.candidates(db,NOW))),1)

    def test_missing_or_changed_article_proof_cannot_authorize_reviewed_recovery(self):
        self.assertEqual(research.prepare_story_body(self.path,NOW,lambda *_:{'body':HTML}),'ready')
        with research.connect(self.path) as db:
            pin=json.loads(recovery.RETAINED_COPY_PATH.read_text())['announcements'][0]
            self.assertIsNotNone(recovery.retained_candidate(db,pin,NOW))
            for field,value in [('sha','other'),('body_sha','other'),('published_on','2026-10-03'),
                                ('extractor_version','old'),('source_url',source.URL+'-other'),('source_title','Other')]:
                db.execute('SAVEPOINT changed')
                db.execute('UPDATE official_story_body_proofs SET '+field+'=?',(value,))
                self.assertIsNone(recovery.retained_candidate(db,pin,NOW),field)
                db.execute('ROLLBACK TO changed')
            db.execute('DELETE FROM official_story_body_proofs')
            self.assertIsNone(recovery.retained_candidate(db,pin,NOW))


if __name__=='__main__':unittest.main()
