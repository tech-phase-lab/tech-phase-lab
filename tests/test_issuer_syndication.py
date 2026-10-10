import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts/research'))
import issuer_syndication as issuer
import official_research
import headline_translation
import signals
from test_headline_translation import ENV

NOW = datetime(2026,10,3,8,0,tzinfo=timezone.utc)
PUBLISHED = '2026-09-30T12:17:00Z'
OBSERVED = '2026-09-30T12:19:12.432+00:00'
SOURCE = next(s for s in signals.SOURCES if s['id']=='globenewswire-public')
URL = 'https://www.globenewswire.com/news-release/2026/09/30/1234567/0/en/delta-contracts-nebius.html'
TITLE = 'Delta Data Centers Signs Contract with Nebius for AI Data Center Capacity'
# Synthetic fixture uses different issuer, source URL, capacities and durations.
BODY = '\n'.join([
 'NEW YORK, Sept. 30, 2026 (GLOBE NEWSWIRE) -- Delta Data Centers Inc. (NYSE American: DTA), a developer and operator of data centers, today announced that it has entered into a binding agreement with Nebius (Nasdaq: NBIS), the AI cloud company, for 64 MW of critical IT capacity at Delta’s facility located in the southeastern United States.',
 'Delta expects the customer prepayments under the initial 11-year term, together with project-level debt and preferred equity, to fund a substantial portion of the initial development costs for the 64 MW project, significantly reducing Delta’s anticipated need for corporate-level common equity and limiting potential dilution to shareholders.',
 "The contracted capacity is supported by Delta's previously announced 14-year Electric Service Agreement for 80 MW of utility load at the site, which requires no significant additional electrical infrastructure upgrades. Delta expects to deliver the capacity in two data halls.",
 'About Delta Data Centers',
 'Delta Data Centers builds data center facilities. These plans remain subject to normal development risks.',
])


def markup(body=BODY, title=TITLE, url=URL, issuer_name='Delta Data Centers Inc.', published=PUBLISHED):
    record = {'@type':'NewsArticle','url':url,'headline':title,'datePublished':published,
      'author':{'name':issuer_name},'sourceOrganization':[{'name':issuer_name}]}
    return ('<html><head><meta name="author" content="'+issuer_name+'"><link rel="canonical" href="'+url+'">'
      '<script type="application/ld+json">'+json.dumps(record)+'</script></head><body><h1>'+title+'</h1>'
      '<div class="article-body">'+''.join('<p>'+p+'</p>' for p in body.split('\n'))+'</div>'
      '<aside>Unrelated sidebar NVDA 900 MW private text</aside></body></html>').encode()


class IssuerSyndicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'issuer.sqlite'
        with official_research.connect(self.path) as db:
            issuer.schema(db)
            signals.save(db,SOURCE,[{'url':URL,'title':TITLE,'text':TITLE,'matches':{'NBIS':['Nebius']},
              'publishedAt':PUBLISHED,'truncated':False}],{},OBSERVED,'fixture',1)
            db.execute("UPDATE signal_events SET event_kind='new'")
            self.event = db.execute('SELECT id FROM signal_events').fetchone()[0]

    def run_body(self, raw=None, when=NOW, request=None):
        return issuer.run_once(self.path,when,request=request or (lambda *_:{'body':markup() if raw is None else raw,'etag':'"version1"'}))

    def public(self, when=NOW):
        with official_research.connect(self.path) as db:
            return signals.public_official_updates(db, reference=when)

    def test_source_bound_bilingual_capacity_contract_uses_no_paid_calls(self):
        self.assertEqual(self.public(),[])
        self.assertEqual(self.run_body(),'done')
        item = self.public()[0]
        self.assertEqual(item['publisher'],'Delta Data Centers Inc. / GlobeNewswire')
        self.assertEqual(item['tickers'],['NBIS'])
        self.assertIn('64 MW',item['bodyJa']);self.assertIn('64 MW',item['bodyEn'])
        self.assertIn('11年',item['bodyJa']);self.assertIn('11 years',item['bodyEn'])
        self.assertIn('14年間・80 MW',item['bodyJa'])
        self.assertIn('予定',item['bodyJa']);self.assertIn('expects to deliver',item['bodyEn'])
        self.assertNotIn('already delivered',item['bodyEn'])
        for word in ('evidenceQuote','Unrelated sidebar','sourceOrganization','body_sha'):
            self.assertNotIn(word,json.dumps(item))
        with official_research.connect(self.path) as db:
            self.assertEqual(official_research.candidates(db,NOW),[])
            self.assertIsNone(headline_translation.claim(db,signals.SOURCES,50,'test',NOW.timestamp()))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
            self.assertEqual(issuer.diagnostics(db,NOW)['counts'],{'published':1})
        self.assertIsNot(SOURCE.get('officialUpdates'),True)

    def test_original_feed_revision_and_clocks_never_rewritten_or_refreshed_as_new(self):
        with official_research.connect(self.path) as db:
            events = list(db.execute('SELECT * FROM signal_events'))
            docs = list(db.execute('SELECT * FROM signal_documents'))
        self.run_body()
        with official_research.connect(self.path) as db:
            self.assertEqual(events,list(db.execute('SELECT * FROM signal_events')))
            self.assertEqual(docs,list(db.execute('SELECT * FROM signal_documents')))
            row=db.execute('SELECT * FROM issuer_syndication_bodies').fetchone()
            self.assertEqual(row['fetched_at'],NOW.isoformat())
            self.assertEqual(db.execute('SELECT public_at FROM issuer_syndication_publications').fetchone()[0],NOW.isoformat())
        self.assertEqual(self.public()[0]['observedAt'],OBSERVED)
        self.assertEqual(self.public()[0]['publishedAt'],PUBLISHED)
        self.assertEqual(self.public(NOW+timedelta(days=8)),[])

    def test_same_feed_repoll_cannot_overwrite_enriched_body(self):
        self.run_body()
        with official_research.connect(self.path) as db:
            signals.save(db,SOURCE,[{'url':URL,'title':TITLE,'text':TITLE,'matches':{'NBIS':['Nebius']},
              'publishedAt':PUBLISHED,'truncated':False}],{},NOW.isoformat(),'fixture',1)
        self.assertEqual(len(self.public()),1)
        self.assertEqual(self.run_body(request=lambda *_:self.fail('not due')),'idle')

    def test_304_keeps_body_ready_and_public_clocks(self):
        self.run_body()
        with official_research.connect(self.path) as db:
            before = tuple(db.execute('SELECT fetched_at,body_sha FROM issuer_syndication_bodies').fetchone())
            public_before = db.execute('SELECT public_at FROM issuer_syndication_publications').fetchone()[0]
        def unchanged(source,validators):
            self.assertEqual(validators['etag'],'"version1"');return {'not_modified':True}
        self.assertEqual(self.run_body(when=NOW+timedelta(hours=2),request=unchanged),'ready')
        with official_research.connect(self.path) as db:
            self.assertEqual(tuple(db.execute('SELECT fetched_at,body_sha FROM issuer_syndication_bodies').fetchone()),before)
            self.assertEqual(db.execute('SELECT public_at FROM issuer_syndication_publications').fetchone()[0],public_before)

    def test_headline_only_missing_issuer_and_article_identity_fail_closed(self):
        variants=[markup(body=TITLE),markup(title='Different release'),markup(url=URL.replace('1234567','9999999')),
                  markup(issuer_name='Other Company'),markup(published='2026-10-01T12:17:00Z'),
                  markup().replace(b'"sourceOrganization":',b'"notSourceOrganization":')]
        for raw in variants:
            with self.subTest(raw=raw[:60]):
                with official_research.connect(self.path) as db:db.execute('DELETE FROM issuer_syndication_bodies')
                self.assertEqual(self.run_body(raw),'retry');self.assertEqual(self.public(),[])

    def test_negated_unsupported_and_boilerplate_mentions_do_not_publish(self):
        for body in (BODY.replace('binding agreement','non-binding agreement'),
                     BODY.replace('Nebius (Nasdaq: NBIS)','Other Company (Nasdaq: NBIS)'),
                     BODY.replace('for 64 MW','for approximately 64 MW',1),
                     BODY+'\nCorrection: The contract was canceled.'):
            with self.subTest(body=body[:80]):
                with official_research.connect(self.path) as db:db.execute('DELETE FROM issuer_syndication_bodies')
                self.assertNotEqual(self.run_body(markup(body=body)),'done');self.assertEqual(self.public(),[])

    def test_stale_feed_and_tampered_body_or_copy_withdraw_publication(self):
        self.run_body()
        changes=[("UPDATE signal_documents SET text='changed'",()),
          ("UPDATE signal_documents SET sha='new'",()),
          ("UPDATE issuer_syndication_bodies SET body=body||' changed'",()),
          ("UPDATE issuer_syndication_publications SET payload='{}'",()),
          ("UPDATE issuer_syndication_bodies SET metadata=?",(json.dumps({'issuer':'Fake'}),))]
        for sql,params in changes:
            with self.subTest(sql=sql),official_research.connect(self.path) as db:
                db.execute('SAVEPOINT invalid');db.execute(sql,params)
                self.assertEqual(issuer.public_items(db,NOW),[])
                db.execute('ROLLBACK TO invalid');db.execute('RELEASE invalid')

    def test_failed_refetch_withdraws_copy_respects_backoff_and_recovers(self):
        self.run_body()
        from urllib.error import HTTPError
        def forbidden(*_):raise HTTPError(URL,403,'denied',{},None)
        later=NOW+timedelta(hours=2)
        self.assertEqual(self.run_body(when=later,request=forbidden),'retry')
        self.assertEqual(self.public(later),[])
        self.assertEqual(self.run_body(when=later+timedelta(minutes=5),request=lambda *_:self.fail('backoff')),'idle')
        self.assertEqual(self.run_body(when=later+timedelta(hours=7)),'ready')
        self.assertEqual(len(self.public(later+timedelta(hours=7))),1)

    def test_network_revision_race_never_persists_fetched_old_body(self):
        def race(*_):
            with official_research.connect(self.path) as db:db.execute("UPDATE signal_documents SET sha='replacement'")
            return {'body':markup()}
        self.assertEqual(self.run_body(request=race),'stale')
        with official_research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM issuer_syndication_bodies').fetchone()[0],0)

    def test_future_date_truncation_financing_and_wrong_url_never_admitted(self):
        for sql,params in [("UPDATE signal_events SET published_at='2026-10-04T12:17:00Z'",()),
                           ('UPDATE signal_events SET truncated=1',())]:
            with official_research.connect(self.path) as db:
                db.execute('SAVEPOINT invalid');db.execute(sql,params)
                self.assertEqual(issuer.candidates(db,NOW),[])
                db.execute('ROLLBACK TO invalid');db.execute('RELEASE invalid')
        for url in ('https://evil.example/release','https://www.globenewswire.com/news-release/2026/09/30/123/0/en/test.html?key=secret',URL+'#fragment'):
            with self.assertRaises(ValueError):issuer.release_url(url,SOURCE)

    def test_retry_state_is_not_evicted_when_queue_is_full(self):
        from urllib.error import HTTPError
        with official_research.connect(self.path) as db:
            for index in range(2):
                url=URL.replace('1234567',str(7654321+index))
                signals.save(db,SOURCE,[{'url':url,'title':TITLE,'text':TITLE,'matches':{'NBIS':['Nebius']},
                  'publishedAt':PUBLISHED,'truncated':False}],{},OBSERVED,'fixture',1)
        calls=[]
        def denied(source,_validators):
            calls.append(source['url']);raise HTTPError(source['url'],403,'denied',{},None)
        with patch.object(issuer,'QUEUE_CAPACITY',2):
            for index in range(6):
                self.run_body(when=NOW+timedelta(seconds=5*index),request=denied)
        self.assertEqual(len(calls),2)
        self.assertEqual(len(set(calls)),2)
        with official_research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM issuer_syndication_bodies').fetchone()[0],2)

    def test_corrupt_cached_body_cannot_be_blessed_by_304(self):
        self.run_body()
        with official_research.connect(self.path) as db:
            db.execute("UPDATE issuer_syndication_bodies SET body=replace(body,'64 MW','65 MW')")
        def unchanged(_source,validators):
            self.assertEqual(validators,{})
            return {'not_modified':True}
        self.assertEqual(self.run_body(when=NOW+timedelta(hours=2),request=unchanged),'retry')
        self.assertEqual(self.public(),[])

    def test_malformed_and_changed_metadata_isolated_on_public_read(self):
        self.run_body()
        with official_research.connect(self.path) as db:
            original=json.loads(db.execute('SELECT metadata FROM issuer_syndication_bodies').fetchone()[0])
            for value in ([],None,{'issuer':'Fake'}, {**original,'distributor':'Unverified'},
                          {**original,'publishedAt':'2026-09-30T12:16:00Z'}, {**original,'issuerShort':'Fake'}):
                db.execute('SAVEPOINT invalid')
                db.execute('UPDATE issuer_syndication_bodies SET metadata=?',(json.dumps(value),))
                self.assertEqual(issuer.public_items(db,NOW),[])
                db.execute('ROLLBACK TO invalid');db.execute('RELEASE invalid')

    def test_spelled_data_hall_count_preserves_both_languages(self):
        import factual_validation
        factual_validation.validate_numbers('2つのデータホール','capacity in two data halls')
        factual_validation.validate_pair('2つのデータホール','two data halls')
        with self.assertRaises(ValueError):factual_validation.validate_numbers('3つのデータホール','two data halls')

if __name__=='__main__':unittest.main()
