"""Public saved-copy quarantine and real related-news selector regression."""
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts/research'))
import official_research as research
import signals
import monitor
from test_inline_article_enrichment import BODY, HTML, NOW, source
import test_inline_article_enrichment as inline_fixture

BAD=json.loads((Path(__file__).parent/'fixtures/nvidia-wrong-related-news-public.json').read_text())['row']


def wrong_note():
    quote=BAD['bodyEn']
    ja=BAD['bodyJa'].split('\n\n');en=quote.split('\n\n')
    item=lambda j,e:{'ja':j,'en':e,'evidenceQuote':quote}
    return {'title':item(BAD['translationJa'],BAD['title']),
            'summary':item(ja[0],en[0]),
            'facts':[item(j,e) for j,e in zip(ja[1:],en[1:])],
            'purpose':item(ja[0],en[0])}


class ArticleIdentityContainmentTests(unittest.TestCase):
    def setUp(self):
        inline_fixture.InlineArticleEnrichmentTests.setUp(self)

    def test_actual_public_wrong_pair_is_withheld_and_cannot_claim_paid_retry(self):
        body=BAD['bodyEn'];sha=hashlib.sha256(body.encode()).hexdigest()
        with patch.object(research,'validate_source_event'):
            research.validate(wrong_note(),body,source.TITLE)
        with research.connect(self.path) as db:
            row=dict(db.execute('SELECT * FROM signal_events').fetchone())
            before=dict(db.execute('SELECT * FROM sources').fetchone())
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],sha,body,NOW.isoformat(),NOW.timestamp()+900,None))
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],sha,json.dumps(wrong_note()),'[]',NOW.isoformat(),NOW.isoformat(),1))
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            items=signals.public_official_updates(db,reference=NOW)
            self.assertEqual(items[0]['title'],source.TITLE)
            self.assertEqual(items[0]['translationJa'],source.TITLE_JA)
            self.assertNotIn('bodyJa',items[0]);self.assertNotIn('bodyEn',items[0])
            self.assertEqual(research.feed(db,NOW),[])
            self.assertIsNone(research.claim(db,NOW,'no-provider',1000))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),saved)
            self.assertEqual(dict(db.execute('SELECT * FROM sources').fetchone()),before)
            db.execute('UPDATE official_story_bodies SET body=?,body_sha=?',(BODY,hashlib.sha256(BODY.encode()).hexdigest()))
            self.assertIsNone(research.claim(db,NOW,'no-provider',1000))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
        import service  # Avoid import during unittest discovery.
        public=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json').public_news()
        item=next(item for item in public['officialUpdates'] if item['url']==source.URL)
        self.assertEqual(item['title'],source.TITLE)
        self.assertEqual(item['publishedOn'],'2026-09-28')
        self.assertNotIn('bodyJa',item)
        self.assertEqual(public['officialResearch'],[])

    def test_good_body_cannot_license_unrelated_generated_title_or_summary(self):
        with self.assertRaisesRegex(ValueError,'source-event-identity-mismatch'):
            research.validate(wrong_note(),BODY,source.TITLE)
        # Even with no stored publication, the wrong cache must be held.
        with research.connect(self.path) as db:
            row=db.execute('SELECT * FROM signal_events').fetchone()
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],'bad',BAD['bodyEn'],NOW.isoformat(),NOW.timestamp()+900,None))
            self.assertIsNone(research.claim(db,NOW,'no-provider',1000))

    def test_explicit_article_precedes_related_semantic_article_tiles(self):
        # Real publisher structure: div.article is the release; later semantic
        # article elements are related-news teasers, not the requested story.
        related=''.join('<article><p>'+text+'</p></article>' for text in BAD['bodyEn'].split('\n\n')[1:])
        document=HTML.replace(b'</body>',related.encode()+b'</body>')
        self.assertEqual(research.prepare_story_body(self.path,NOW,lambda *_:{'body':document}),'ready')
        with research.connect(self.path) as db:
            cached=db.execute('SELECT * FROM official_story_bodies').fetchone()
            self.assertEqual(cached['body'],BODY)
            self.assertEqual(cached['body_sha'],'f34631ef55ea4e22b1b01fda91db238c6f23966f899d6bafebc630a68220b07b')
            self.assertNotIn('CUDA-Q',cached['body'])

    def test_unrelated_article_body_is_rejected_before_persistence(self):
        document=('<article>'+BAD['bodyEn']+'</article>').encode()
        self.assertEqual(research.prepare_story_body(self.path,NOW,lambda *_:{'body':document}),'retry')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT body FROM official_story_bodies').fetchone()[0],'')
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],0)


if __name__=='__main__':unittest.main()
