"""Offline generic derivation, immutable history and short writer regressions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import buyback_structured as structured
import buyback_structured_publication as publication
import general_source_news as news
import official_research as research
import signals
from test_headline_translation import ENV

FIXTURES = Path(__file__).parent / 'fixtures'
RETAINED = json.loads((FIXTURES / 'trendspider-buyback-retained.json').read_text())
FAILED = json.loads((FIXTURES / 'buyback-retained-failed-observation.json').read_text())
NOW = datetime(2026, 10, 4, 6, 0, tzinfo=timezone.utc)
START = datetime(2026, 10, 4, 5, 31, 10, tzinfo=timezone.utc)
SOURCE = next(source for source in signals.SOURCES if source['id'] == 'x-trendspider')
AUTH = 'Microsoft $MSFT authorized an additional $7 billion for share repurchases.'


class StructuredBuybackPublicationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'db.sqlite'
        with research.connect(self.path):
            pass

    def seed(self, body=AUTH, number=101, ticker='MSFT', *, observed=None, event_id=None):
        title = ' '.join(body.split())[:500]
        raw = {'source_id': SOURCE['id'], 'url': f'https://x.com/TrendSpider/status/{number}',
               'sha': news.digest(title+'\n'+body), 'title': title, 'text': body,
               'published_at': RETAINED['publishedAt'],
               'first_seen_at': observed or RETAINED['firstSeenAt'],
               'last_seen_at': observed or RETAINED['firstSeenAt'],
               'truncated': 0, 'selected_for_processing': 0}
        with research.connect(self.path) as db:
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)', tuple(raw.values()))
            db.commit()
            news.admit_retained(db, NOW)
            if event_id is not None:
                db.execute('UPDATE signal_events SET id=? WHERE source_id=? AND url=?',
                           (event_id, raw['source_id'], raw['url']))
        return raw

    def rows(self):
        with research.connect(self.path) as db:
            return news.candidates(db, NOW, include_review=True)

    def failed_history(self, row, reason='unsubstantiated-model-output'):
        # Facts and failed clock are observed retained data. Lease/model/job and
        # call wrappers are explicitly synthetic; no provider response is run.
        facts = [{key: item[key] for key in ('ja', 'en', 'evidenceId')} for item in FAILED['facts']]
        payload = json.dumps({'disposition': 'publish', 'reason': 'material-company-development',
                              'facts': facts}, ensure_ascii=False, indent=2)
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], 1, NOW.timestamp()+900, 'synthetic-original-lease', 'review', FAILED['failure']))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       ('synthetic-original-lease', row['id'], row['sha'], FAILED['failedAt'], FAILED['failure'], 'facts[0]', payload))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                       ('synthetic-original-lease', row['sha'], row['body_sha']))
            db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                       (START.timestamp(), 'research:'+row['source_id'], row['sha'], 'synthetic-old-model', 'failed', 'synthetic-original-lease'))
            news.save_semantic_review(db, row, 'synthetic-original-lease', START.isoformat(), FAILED['failedAt'], reason)

    def run_worker(self):
        with patch.object(research, 'prepare_story_body', return_value='idle'), patch.object(research, 'datetime') as clock:
            clock.fromtimestamp.side_effect = datetime.fromtimestamp
            clock.now.return_value = NOW
            return research.run_once(self.path, lambda *_: self.fail('transport must not run'), ENV, NOW.timestamp())

    def publish(self):
        with research.connect(self.path) as db:
            return publication.publish(db, NOW, clock=lambda: NOW)

    @staticmethod
    def snapshot(db, table):
        return [dict(value) for value in db.execute('SELECT * FROM '+table)]

    def test_retained_actual_failure_is_preserved_and_clocks_are_new(self):
        self.seed(RETAINED['body'], 2106523440635363385, 'NVDA', event_id=1246)
        row = self.rows()[0]
        self.assertEqual(row['sha'], FAILED['sourceSha'])
        self.assertEqual(row['body_sha'], FAILED['bodySha'])
        for fact, unit in zip(FAILED['facts'], row['units']):
            self.assertEqual(fact['quote'], unit['quote'])
        with self.assertRaises(ValueError):
            news.validate_pair(FAILED['facts'][0], row['units'][0])
        self.failed_history(row)
        unchanged = ('signal_events', 'signal_documents', 'signal_x_acquisition', 'official_research_jobs',
                     'official_research_attempt_failures', 'official_research_attempt_body_proofs',
                     'general_source_semantic_reviews', 'signal_headline_translation_calls')
        with research.connect(self.path) as db:
            before = {table: self.snapshot(db, table) for table in unchanged}
        self.assertEqual(self.run_worker(), 'done')
        with research.connect(self.path) as db:
            for table in unchanged:
                self.assertEqual(self.snapshot(db, table), before[table], table)
            saved = dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(saved['started_at'], NOW.isoformat())
            self.assertEqual(saved['public_at'], NOW.isoformat())
            self.assertNotEqual(saved['started_at'], START.isoformat())
            self.assertTrue(publication.resolves(db, row, before['general_source_semantic_reviews'][0], NOW))
            item = news.public_items(db, NOW)[0]
            self.assertEqual(item['publishedAt'], RETAINED['publishedAt'])
            self.assertEqual(item['observedAt'], RETAINED['firstSeenAt'])
            self.assertIn('200億ドル弱', item['bodyJa'])
            self.assertIn('1500億ドル', item['bodyJa'])
            self.assertIn('追加', item['bodyJa'])
            self.assertIn('2350億ドル', item['bodyJa'])
        self.assertIsNone(self.publish())
        self.assertEqual(self.run_worker(), 'idle')

    def test_generic_issuers_amounts_publish_one_per_worker_and_zero_calls(self):
        self.seed()
        self.seed('Micron $MU authorized a new $3 billion share repurchase program.', 202, 'MU')
        self.assertEqual(self.run_worker(), 'done')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 1)
        self.assertEqual(self.run_worker(), 'done')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
            self.assertEqual({item['tickers'][0] for item in news.public_items(db, NOW)}, {'MSFT', 'MU'})
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_jobs').fetchone()[0], 0)
        self.assertEqual(self.run_worker(), 'idle')

    def test_unknown_structured_claim_is_explicit_review_without_paid_fallback(self):
        self.seed('Microsoft $MSFT plans $7 billion in share buybacks.')
        self.assertEqual(self.run_worker(), 'review')
        with research.connect(self.path) as db:
            reviews = self.snapshot(db, 'general_source_semantic_reviews')
            self.assertEqual(reviews[0]['reason'], structured.FAILURE)
            self.assertEqual(news.public_items(db, NOW), [])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
        self.assertEqual(self.run_worker(), 'idle')

    def test_source_correctable_qualifiers_publish_before_model_without_blocking_queue(self):
        # Unknown wording receives an explicit item-level review, while later
        # fully recognized sources keep flowing through the same worker.
        self.seed('Microsoft $MSFT plans $7 billion in share buybacks.',number=500)
        self.assertEqual(self.run_worker(),'review')
        for index,word in enumerate(('nearly','almost','just under','about','approximately','roughly','~')):
            self.seed(f'Microsoft $MSFT has repurchased {word} $20B during the previous quarter.',number=501+index)
            self.assertEqual(self.run_worker(),'done')
        with research.connect(self.path) as db:
            items=news.public_items(db,NOW)
            self.assertEqual(len(items),7)
            self.assertEqual(sum('200億ドル弱' in item['bodyJa'] for item in items),3)
            self.assertEqual(sum('約200億ドル' in item['bodyJa'] for item in items),4)
            self.assertTrue(all('前四半期' in item['bodyJa'] and 'recap' in item['title'] for item in items))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_jobs').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT reason FROM general_source_semantic_reviews').fetchone()[0],structured.FAILURE)
        self.assertEqual(self.run_worker(),'idle')

    def test_previously_unrecognized_wording_recovers_without_replacing_review(self):
        for index,word in enumerate(('nearly','approximately')):
            self.seed(f'Microsoft $MSFT buyback update.\n\n{word.capitalize()} $20B was repurchased in the last quarter.',number=700+index)
            row=next(row for row in self.rows() if row['url'].endswith(str(700+index)))
            with research.connect(self.path) as db:
                news.save_semantic_review(db,row,f'synthetic-syntax-review-{index}',START.isoformat(),
                                         (START+timedelta(seconds=1)).isoformat(),structured.FAILURE)
                before=publication.review_for(db,row)
            self.assertEqual(self.run_worker(),'done')
            with research.connect(self.path) as db:
                self.assertEqual(publication.review_for(db,row),before)
                self.assertTrue(publication.resolves(db,row,before,NOW))
                item=next(item for item in news.public_items(db,NOW) if item['id']==str(row['id']))
                self.assertIn('200億ドル弱' if word=='nearly' else '約200億ドル',item['bodyJa'])
                self.assertEqual(item['publishedAt'],row['published_at'])
                self.assertEqual(item['observedAt'],row['observed_at'])
                self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)

    def test_materiality_and_ambiguity_reviews_are_not_overridden(self):
        self.seed()
        row = self.rows()[0]
        for reason in ('not-material-business-news', 'ambiguous-actor-or-action', 'insufficient-source-evidence'):
            with self.subTest(reason=reason), research.connect(self.path) as db:
                news.save_semantic_review(db, row, 'synthetic-review', START.isoformat(), FAILED['failedAt'], reason)
            self.assertIsNone(self.publish())
        with research.connect(self.path) as db:
            news.save_semantic_review(db, row, 'synthetic-review', START.isoformat(), FAILED['failedAt'], structured.FAILURE)
            original = publication.review_for(db, row)
        self.assertEqual(self.publish(), 'done')
        with research.connect(self.path) as db:
            self.assertEqual(publication.review_for(db, row), original)
            self.assertTrue(publication.resolves(db, row, original, NOW))

    def test_running_job_and_source_or_duplicate_race_cannot_publish(self):
        self.seed()
        row = self.rows()[0]
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], 1, NOW.timestamp()+300, 'synthetic-running', 'running', None))
        self.assertIsNone(self.publish())
        with research.connect(self.path) as db:
            db.execute('DELETE FROM official_research_jobs')
        original = structured.validated_note
        def revise(value):
            note = original(value)
            with research.connect(self.path) as other:
                other.execute("UPDATE signal_documents SET text=text || ' Source changed.'")
            return note
        with patch.object(structured, 'validated_note', side_effect=revise):
            self.assertEqual(self.publish(), 'stale')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
            db.execute('UPDATE signal_documents SET text=?', (AUTH,))
        def duplicate(value):
            note = original(value)
            with research.connect(self.path) as other:
                columns = [key for key in dict(other.execute('SELECT * FROM signal_events').fetchone()) if key != 'id']
                event = dict(other.execute('SELECT * FROM signal_events').fetchone())
                event['observed_at'] = '2026-10-04T01:00:00+00:00'
                event['previous_sha'] = 'synthetic-earlier-origin'
                other.execute('INSERT INTO signal_events('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',
                              tuple(event[key] for key in columns))
            return note
        with patch.object(structured, 'validated_note', side_effect=duplicate):
            self.assertEqual(self.publish(), 'stale')
        self.assertEqual(self.publish(), 'done')
        with research.connect(self.path) as db:
            self.assertNotEqual(db.execute('SELECT event_id FROM official_research_publications').fetchone()[0], row['id'])

    def test_parser_and_broad_candidate_work_never_hold_the_writer(self):
        self.seed()
        with research.connect(self.path) as db:
            original_candidates = news.candidates
            original_derive = structured.validated_note
            def candidates(*args, **kwargs):
                self.assertFalse(db.in_transaction)
                return original_candidates(*args, **kwargs)
            def derive(*args, **kwargs):
                self.assertFalse(db.in_transaction)
                return original_derive(*args, **kwargs)
            with patch.object(news, 'candidates', side_effect=candidates), patch.object(structured, 'validated_note', side_effect=derive), \
                 patch.object(news, 'current_revision', side_effect=AssertionError('no broad commit-time validation')):
                self.assertEqual(publication.publish(db, NOW, clock=lambda: NOW), 'done')

    def test_read_only_resolution_rejects_tampered_audit_payload_proof_and_clocks(self):
        self.seed(RETAINED['body'], 2106523440635363385, 'NVDA', event_id=1246)
        row = self.rows()[0]
        self.failed_history(row)
        self.assertEqual(self.publish(), 'done')
        with sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON')
            before = db.total_changes
            self.assertTrue(publication.resolves(db, row, publication.review_for(db, row), NOW))
            self.assertEqual(len(news.public_items(db, NOW)), 1)
            self.assertEqual(db.total_changes, before)
            script = '\n'.join(db.iterdump())
        mutations = (
            "UPDATE official_research_publications SET public_at='2026-10-04T07:00:00+00:00'",
            "UPDATE official_research_publications SET started_at='2026-10-03T20:00:00+00:00'",
            "UPDATE official_research_publications SET generation_ms=-1",
            "UPDATE official_research_publications SET evidence='[]'",
            "UPDATE official_research_publications SET payload=json_remove(payload,'$.sourceStructuredBuyback')",
            "UPDATE official_research_publications SET payload=json_set(payload,'$.sourceStructuredBuyback.version',1.0)",
            "UPDATE official_research_publications SET payload=json_set(payload,'$.facts[0].en','NVIDIA approved a dividend.')",
            "UPDATE source_structured_buyback_derivations SET validated_payload_sha='tampered'",
            "UPDATE source_structured_buyback_derivations SET original_review='null'",
            "UPDATE source_structured_buyback_derivations SET source_snapshot='{}'",
            "UPDATE source_structured_buyback_derivations SET derived_at='2026-10-04T05:00:00+00:00'",
            "UPDATE official_research_attempt_body_proofs SET body_sha='changed'",
            "UPDATE official_research_attempt_failures SET payload='{}'",
            "UPDATE signal_headline_translation_calls SET state='completed'",
            "UPDATE general_source_semantic_reviews SET lease='changed'",
            "UPDATE signal_documents SET text=text || ' Correction: withdrawn.'",
            "UPDATE signal_documents SET sha='new-source-revision'",
            "UPDATE signal_documents SET last_seen_at='2026-10-04T07:00:00+00:00'",
            "UPDATE signal_events SET title='changed source title'",
            "UPDATE signal_events SET observed_at='2026-10-04T07:00:00+00:00'",
        )
        for index, sql in enumerate(mutations):
            with self.subTest(sql=sql):
                path = self.path.parent / f'tamper-{index}.sqlite'
                with sqlite3.connect(path) as db:
                    db.executescript(script)
                    db.execute(sql)
                with research.connect(path) as db:
                    self.assertFalse(publication.resolves(db, row, publication.review_for(db, row), NOW))
                    self.assertEqual(news.public_items(db, NOW), [])

    def test_newer_unselected_withdrawal_hides_publication(self):
        raw = self.seed()
        self.assertEqual(self.publish(), 'done')
        correction = 'Correction: this earlier report has been withdrawn.'
        title = correction
        with research.connect(self.path) as db:
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (raw['source_id'], raw['url'], news.digest(title+'\n'+correction), title, correction,
                        raw['published_at'], (NOW-timedelta(minutes=1)).isoformat(),
                        (NOW-timedelta(minutes=1)).isoformat(), 0, 0))
            self.assertEqual(news.public_items(db, NOW), [])

    def test_no_prior_review_cannot_downgrade_or_forge_derivation_types(self):
        self.seed()
        row = self.rows()[0]
        self.assertEqual(self.publish(), 'done')
        with research.connect(self.path) as db:
            original = dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertTrue(publication.publication_valid(db, row, original, NOW))
            note = json.loads(original['payload'])
            del note[structured.MARKER]
            db.execute('UPDATE official_research_publications SET payload=?', (publication.encoded(note),))
            self.assertEqual(news.public_items(db, NOW), [])
            # Updating both payload hashes is still insufficient: the freshly
            # derived typed claim/version must match exactly, not True == 1.
            for version in (True, 1.0):
                note = json.loads(original['payload'])
                note[structured.MARKER]['version'] = version
                saved = {**original, 'payload': publication.encoded(note)}
                db.execute('UPDATE official_research_publications SET payload=?', (saved['payload'],))
                db.execute('''UPDATE source_structured_buyback_derivations
                  SET publication_snapshot=?,validated_payload_sha=?''',
                           (publication.encoded(saved), news.digest(saved['payload'])))
                self.assertFalse(publication.publication_valid(db, row, saved, NOW))
                self.assertEqual(news.public_items(db, NOW), [])
            note = json.loads(original['payload'])
            del note[structured.MARKER]
            db.execute('UPDATE official_research_publications SET payload=?', (publication.encoded(note),))
            db.execute("UPDATE source_structured_buyback_derivations SET sha='tampered-source-proof'")
            self.assertTrue(publication.recorded(db, row))
            self.assertEqual(news.public_items(db, NOW), [])

    def test_audit_rollback_and_concurrent_workers_do_not_overwrite(self):
        self.seed()
        with research.connect(self.path) as db:
            db.execute('''CREATE TRIGGER reject_audit BEFORE INSERT ON source_structured_buyback_derivations
              BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END''')
        with self.assertRaises(sqlite3.IntegrityError):
            self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
            db.execute('DROP TRIGGER reject_audit')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.publish(), range(2)))
        self.assertEqual(results.count('done'), 1)
        with research.connect(self.path) as db:
            original = self.snapshot(db, 'official_research_publications')
        self.assertIsNone(self.publish())
        with research.connect(self.path) as db:
            self.assertEqual(self.snapshot(db, 'official_research_publications'), original)

    def test_damaged_fresh_derivation_stays_held_without_paid_regeneration(self):
        class FrozenDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW
        clocks = (patch.object(research, 'datetime', FrozenDateTime), patch.object(news, 'datetime', FrozenDateTime))
        for clock in clocks:
            clock.start()
            self.addCleanup(clock.stop)
        self.seed()
        self.assertEqual(self.publish(), 'done')
        with research.connect(self.path) as db:
            rows = news.candidates(db, NOW, include_review=True)
            self.assertEqual(len(research.validated_publications(db, rows)), 1)
            self.assertEqual(len(news.public_items(db, NOW)), 1)
            self.assertEqual(self.snapshot(db, 'general_source_semantic_reviews'), [])
            script = '\n'.join(db.iterdump())
        mutations = (
            "UPDATE official_research_publications SET payload=json_remove(payload,'$.sourceStructuredBuyback')",
            "UPDATE official_research_publications SET payload=json_set(payload,'$.sourceStructuredBuyback.version',99)",
            "UPDATE official_research_publications SET payload=json_set(payload,'$.facts[0].en','Microsoft paid a dividend.')",
            "UPDATE source_structured_buyback_derivations SET validated_payload_sha='tampered'",
            "UPDATE source_structured_buyback_derivations SET source_snapshot='{}'",
            "UPDATE source_structured_buyback_derivations SET sha='different-source-proof'",
            "UPDATE official_research_publications SET sha='different-source-proof'",
            "UPDATE official_research_publications SET body_sha='different-body-proof'",
            "UPDATE signal_documents SET text=text || ' Correction: withdrawn.'",
        )
        for index, sql in enumerate(mutations):
            with self.subTest(sql=sql):
                path = self.path.parent / f'claim-tamper-{index}.sqlite'
                with sqlite3.connect(path) as db:
                    db.executescript(script)
                    db.execute(sql)
                with patch.object(self, 'path', path):
                    with research.connect(path) as db:
                        unchanged = {table: self.snapshot(db, table) for table in (
                            'official_research_publications', publication.AUDIT_TABLE,
                            'official_research_jobs', 'general_source_semantic_reviews',
                            'official_research_attempt_failures', 'official_research_attempt_body_proofs',
                            'signal_headline_translation_calls')}
                        current = news.candidates(db, NOW, include_review=True)
                        self.assertEqual(news.public_items(db, NOW), [])
                        self.assertEqual(research.validated_publications(db, current), [])
                        self.assertEqual(research.diagnostics(db)['published'], 0)
                    self.assertEqual(self.run_worker(), 'idle')
                    with research.connect(path) as db:
                        for table, before in unchanged.items():
                            self.assertEqual(self.snapshot(db, table), before, table)


if __name__ == '__main__':
    unittest.main()
