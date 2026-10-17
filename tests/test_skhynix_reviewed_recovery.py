"""Synthetic SK source/category and closed-call evidence for audited recovery."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import official_research_editorial_recovery as recovery
import feed_category_admission as category
import test_skhynix_service_routing as service_fixture

signals = research.signals


class SkhynixReviewedRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fx = service_fixture.SkhynixServiceRoutingTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.db, self.path, self.now = self.fx.db, self.fx.path, self.fx.now
        body = ('SK hynix announced a semiconductor research platform for collaborative technology evaluation.\n'
                + 'Synthetic background about semiconductor research and technology collaboration. ' * 18)
        self.assertEqual(self.fx.poll(body=self.fx.feed(body=body))[0]['status'], 'ok')
        with self.db:
            self.db.execute('UPDATE signal_events SET id=1139')
        row = self.fx.row()
        body = self.db.execute('SELECT text FROM signal_documents').fetchone()[0]
        body_sha = recovery.digest(body)
        at = self.now.isoformat()
        with self.db:
            self.db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,NULL)',
                            (1139, row['sha'], body_sha, body, at, self.now.timestamp() + 900))
            self.db.execute('INSERT INTO official_story_body_proofs VALUES(?,?,?,?,?,?,?,?,?)',
                            (1139, row['sha'], body_sha, at, row['url'], row['title'], None,
                             'synthetic-extractor', recovery.digest('synthetic raw response')))
            self.db.execute("INSERT INTO official_research_jobs VALUES(?,?,3,?,'attempt-3','retry','changed-action-capacity')",
                            (1139, row['sha'], self.now.timestamp() + 3600))
            for attempt in range(1, 4):
                failed = (self.now + timedelta(seconds=attempt)).isoformat()
                rejected = json.dumps({'rejectedSyntheticAttempt': attempt})
                self.db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                                (f'attempt-{attempt}', 1139, row['sha'], failed,
                                 'changed-action-capacity', 'summary', rejected))
                self.db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                                (f'attempt-{attempt}', row['sha'], body_sha))
                self.db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                                (self.now.timestamp(), 'research:skhynix-news', row['sha'],
                                 'synthetic-model', 'failed', '{}', f'attempt-{attempt}'))
        self.reference = self.now + timedelta(seconds=5)
        part = {'ja': 'SK hynixが半導体研究基盤を発表した。',
                'en': 'SK hynix announced a semiconductor research platform.',
                'anchors': ['SK hynix announced a semiconductor research platform']}
        pin = {'eventId': 1139, 'sourceId': row['source_id'], 'ticker': 'SKHY', 'url': row['url'],
               'title': row['title'], 'publishedOn': row['published_on'], 'publishedAt': row['published_at'],
               'observedAt': row['observed_at'], 'eventSha': row['sha'], 'sourceRevision': row['sha'],
               'bodyTextSha': body_sha, 'bodyChars': len(body), 'provenance': 'signal-document',
               'requireFreshCategory': True,
               'copy': {**{key: deepcopy(part) for key in ('title', 'summary', 'purpose')},
                        'facts': [deepcopy(part) for _ in range(3)]}}
        failure = self.db.execute("SELECT * FROM official_research_attempt_failures WHERE lease='attempt-3'").fetchone()
        pin['reviewedFailure'] = {'reason': failure['reason'], 'failedAt': failure['failed_at'],
                                  'payloadSha': recovery.digest(failure['payload'])}
        pin['failure'] = {**pin['reviewedFailure'], 'attempts': 3}
        self.body, self.pin = body, pin
        pin['reviewedPayloadSha'] = recovery.digest(json.dumps(recovery.retained_note({'body': body}, pin), ensure_ascii=False))
        self.manifest = Path(self.fx.tmp.name) / 'reviewed.json'
        self.enterContext(patch.object(recovery, 'RETAINED_COPY_PATH', self.manifest))
        self.enterContext(patch.object(recovery, 'RETAINED_COPY_SHA', 'temporary'))
        self.write_manifest()
        self.enterContext(patch.object(research, 'prepare_story_body', side_effect=AssertionError('body polling')))
        self.enterContext(patch.object(research.brief_generator, 'request_response', side_effect=AssertionError('provider call')))

    def write_manifest(self):
        value = {'policy': 'reviewed-retained-announcement-v1',
                 'startsAt': (self.now - timedelta(hours=1)).isoformat(),
                 'expiresAt': (self.now + timedelta(hours=1)).isoformat(),
                 'announcements': [], 'retryArticles': [self.pin]}
        self.manifest.write_text(json.dumps(value, ensure_ascii=False))
        recovery.RETAINED_COPY_SHA = recovery.digest(self.manifest.read_text())

    def publish(self, validator=research.validate):
        return recovery.publish_retained(self.db, self.reference, validator)

    def test_zero_call_recovery_preserves_all_source_failure_and_call_clocks(self):
        history = recovery.retry_history(self.db, self.pin)
        source = recovery.retry_source_snapshot(self.db, self.pin)
        self.assertEqual(research.run_once(self.path, lambda *_: self.fail('provider'), {},
                         self.reference.timestamp()), 'done')
        audit = dict(self.db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone())
        self.assertEqual(json.loads(audit['previous_history']), history)
        self.assertEqual(recovery.retry_history(self.db, self.pin),
                         {**history, 'job': {**history['job'], 'state': 'done'}})
        self.assertEqual(recovery.retry_source_snapshot(self.db, self.pin), source)
        self.assertEqual(audit['failure_lease'], 'attempt-3')
        self.assertEqual(audit['failure_payload_sha'], self.pin['failure']['payloadSha'])
        rows = research.candidates(self.db, self.reference, read_only=True)
        self.assertEqual(len(research.validated_publications(self.db, rows)), 1)
        self.assertFalse(self.publish())

    def test_later_running_or_changed_attempt_is_never_replaced(self):
        for sql in ("UPDATE official_research_jobs SET attempts=4",
                    "UPDATE official_research_jobs SET state='running'",
                    "UPDATE official_research_jobs SET lease='other'",
                    "UPDATE official_research_attempt_failures SET payload=payload||' ' WHERE lease='attempt-3'",
                    "UPDATE signal_headline_translation_calls SET state='running' WHERE lease='attempt-3'",
                    "DELETE FROM official_research_attempt_body_proofs WHERE lease='attempt-3'"):
            with self.subTest(sql=sql):
                self.db.execute('SAVEPOINT denied')
                self.db.execute(sql)
                self.assertIsNone(recovery.retry_failure(self.db, self.pin, self.reference))
                self.db.execute('ROLLBACK TO denied'); self.db.execute('RELEASE denied')
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_media_withdrawal_source_disable_and_revision_change_prevent_recovery(self):
        for mutation in ('media', 'article-media', 'withdrawn', 'disabled', 'body', 'primary'):
            with self.subTest(mutation=mutation):
                case = SkhynixReviewedRecoveryTests(); case.setUp()
                try:
                    if mutation == 'media':
                        case.fx.poll(categories=('Media',), body=case.fx.feed(categories=('Media',), body=case.body))
                    elif mutation in ('article-media', 'withdrawn'):
                        with case.db:
                            case.db.execute('BEGIN IMMEDIATE')
                            category.persist_article(case.db, case.fx.source, case.fx.app.tickers,
                                case.fx.row(), {'state': 'valid' if mutation == 'article-media' else 'article-withdrawn',
                                                'terms': ['Media'] if mutation == 'article-media' else []},
                                case.pin['bodyTextSha'], recovery.digest('negative article proof'),
                                case.reference.isoformat())
                    elif mutation == 'disabled':
                        case.fx.source['enabled'] = False
                    elif mutation == 'body':
                        with case.db: case.db.execute("UPDATE official_story_bodies SET body=body||' changed'")
                    else:
                        research.monitor.add_source(case.db, 'SKHY', case.pin['url'], '2026-10-04', case.pin['title'])
                    self.assertFalse(case.publish())
                finally:
                    case.doCleanups()

    def test_category_denial_during_validation_is_rechecked_before_publish(self):
        def validate(*args):
            result = research.validate(*args)
            self.fx.poll(categories=('Media',), body=self.fx.feed(categories=('Media',), body=self.body))
            return result
        self.assertFalse(self.publish(validate))
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_consumed_recovery_does_not_recreate_a_withdrawn_publication(self):
        self.assertTrue(self.publish())
        with self.db:
            self.db.execute('DELETE FROM official_research_publications')
            self.db.execute("UPDATE official_research_jobs SET state='retry'")
        self.assertFalse(self.publish())
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_stale_category_waits_for_existing_source_refresh(self):
        expired = self.now + timedelta(seconds=901)
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return expired.astimezone(tz or timezone.utc)
        self.reference = expired
        with patch.object(research.bridge, 'datetime', Clock):
            self.assertFalse(self.publish())
            self.assertEqual(self.fx.poll(at=expired, body=self.fx.feed(body=self.body))[0]['status'], 'ok')
            self.assertTrue(self.publish())

    def test_category_expiry_during_validation_prevents_publication(self):
        current = [self.now]
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return current[0].astimezone(tz or timezone.utc)
        def validate(*args):
            result = research.validate(*args)
            current[0] = self.now + timedelta(seconds=901)
            return result
        with patch.object(research.bridge, 'datetime', Clock):
            self.assertFalse(self.publish(validate))
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_reviewed_payload_hash_blocks_deployment_and_entity_mutations(self):
        # Exact reviewed payload binding is a scoped acceptance check. Generic
        # free-text validators are not claimed to detect these semantic changes.
        original = deepcopy(self.pin)
        for text, lang in (("Both SHG and RPM have been deployed in production.", 'en'),
                           ('SHGとRPMは量産工程に導入済み。', 'ja'),
                           ('Infinitesimaの高速原子間力顕微鏡技術を採用した。', 'ja'),
                           ('SK hynix uses Infinitesima atomic force microscopy.', 'en')):
            with self.subTest(text=text):
                self.pin = deepcopy(original)
                self.pin['copy']['facts'][1][lang] = text
                self.write_manifest()
                self.assertEqual(self.publish(), 'blocked')
                self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)


class SkhynixReviewedManifestTests(unittest.TestCase):
    def test_actual_pin_keeps_exact_retry_and_reviewed_equipment_status(self):
        manifest = json.loads(Path(recovery.__file__).with_name('reviewed_retained_announcements.json').read_text())
        pins = [pin for pin in manifest['retryArticles'] if pin['eventId'] == 1139]
        self.assertEqual(len(pins), 1)
        pin = pins[0]
        self.assertEqual(pin['sourceId'], 'skhynix-news')
        self.assertIs(pin['requireFreshCategory'], True)
        self.assertEqual(pin['failure'], {**pin['reviewedFailure'], 'attempts': 3})
        self.assertEqual(pin['failure']['failedAt'], '2026-10-04T17:33:50.008628+00:00')
        self.assertEqual(pin['failure']['payloadSha'],
                         'd006318238c1a9cfedde0422dc3c22daf991337d6eb06764307db392fba84223')
        self.assertEqual(pin['reviewedPayloadSha'],
                         '61daadb4f9dc5998d39bb59f886ec0bd783af108c5068fdf15f5b8d69110d02a')
        self.assertEqual(manifest['expiresAt'], '2026-10-05T00:00:00+00:00')
        fact = pin['copy']['facts'][1]
        self.assertIn('decided to install multiple tools per fab', fact['en'])
        self.assertIn('confirmed plans to deploy multiple systems', fact['en'])
        self.assertIn('Rapid Probe Microscope（RPM）', fact['ja'])
        self.assertIn('設置することを決定した', fact['ja'])
        self.assertIn('導入計画を確定した', fact['ja'])
        self.assertNotIn('deployed in', fact['en'])
        self.assertNotIn('原子間力', fact['ja'])
        self.assertEqual(pin['copy']['facts'][0]['en'],
            "SK hynix’s venture investment activities have evolved from 'tech sensing,' focused on early identification of emerging technologies and companies, to 'path finding,' which seeks ways to connect those technologies to products and businesses.")


if __name__ == '__main__':
    unittest.main()
