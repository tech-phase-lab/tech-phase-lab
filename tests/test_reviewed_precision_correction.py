"""Small synthetic records preserve the source-reviewed replacement boundary."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import factual_validation as factual
import official_research as research
import official_research_editorial_recovery as recovery
import test_reviewed_rollout_correction as fixture


class ReviewedPrecisionCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.ReviewedRolloutCorrectionTests();self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.path=self.case.path;self.pin=self.case.pin
        self.pin['replacement']['reason']='reviewed-evidence-precision'
        with research.connect(self.path) as db:
            row=dict(recovery.retained_candidate(db,self.pin,fixture.NOW))
            # Synthetic old copy passes all generic checks. An explicit human
            # review, bound to its entire payload, requests a precise revision.
            old=recovery.retained_note(row,self.pin)
            old['summary']['en']='Skills are already available in Gemini Spark.'
            old['summary']['ja']='Gemini Sparkではスキルをすでに利用できる。'
            research.validate(old,row['body'],row['title'])
            payload=json.dumps(old,ensure_ascii=False)
            db.execute('UPDATE official_research_publications SET payload=?',(payload,))
            self.pin['replacement']['payloadSha']=recovery.digest(payload)
            self.old=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.history=self.case.snapshot(db)
        self.write_manifest()

    def write_manifest(self):
        raw=json.loads(recovery.RETAINED_COPY_PATH.read_text());raw['announcements']=[self.pin]
        recovery.RETAINED_COPY_PATH.write_text(json.dumps(raw,ensure_ascii=False))
        recovery.RETAINED_COPY_SHA=recovery.digest(recovery.RETAINED_COPY_PATH.read_text())

    def test_explicit_valid_copy_review_archives_old_publication_and_calls(self):
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('paid call'),{},fixture.NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            audit=dict(db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone())
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(audit['reason'],'reviewed-evidence-precision')
            self.assertEqual(json.loads(audit['previous_publication']),self.old)
            self.assertEqual(json.loads(audit['previous_job']),self.history['official_research_jobs'][0])
            self.assertEqual(json.loads(audit['previous_calls']),self.history['signal_headline_translation_calls'])
            self.assertEqual(self.case.snapshot(db),self.history)
            self.assertNotEqual(saved['public_at'],self.old['public_at'])
            self.assertEqual(saved['public_at'],audit['replaced_at'])
        self.assertFalse(self.case.publish())

    def test_valid_copy_cannot_be_replaced_without_exact_explicit_pin(self):
        for mutation in ('reason','payloadSha','startedAt','publicAt','generationMs','jobAttempts'):
            with self.subTest(mutation=mutation):
                original=deepcopy(self.pin['replacement'])
                self.pin['replacement'][mutation]=('unknown' if isinstance(original[mutation],str) else original[mutation]+1)
                self.write_manifest();self.assertFalse(self.case.publish())
                self.pin['replacement']=original
        self.pin.pop('replacement');self.write_manifest()
        self.assertFalse(self.case.publish())
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)

    def test_current_body_revision_and_nonrunning_closed_call_remain_required(self):
        for sql,restore in (
            ("UPDATE signal_headline_translation_calls SET state='running'","UPDATE signal_headline_translation_calls SET state='done'"),
            ("UPDATE official_research_jobs SET state='running'","UPDATE official_research_jobs SET state='done'"),
            ("UPDATE sources SET status='held'","UPDATE sources SET status='new'"),
            ("UPDATE official_story_body_proofs SET body_sha='changed'",'UPDATE official_story_body_proofs SET body_sha=?')):
            with self.subTest(sql=sql):
                with research.connect(self.path) as db:db.execute(sql)
                self.assertFalse(self.case.publish())
                with research.connect(self.path) as db:db.execute(restore,(self.pin['bodyTextSha'],) if '?' in restore else ())

    def test_concurrent_saved_copy_change_is_not_overwritten(self):
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute("UPDATE official_research_publications SET payload=payload||' '")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,fixture.NOW,validate))
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)

    def test_actual_precision_manifest_is_separate_from_retry_recovery(self):
        manifest=json.loads(Path(recovery.__file__).with_name('reviewed_retained_announcements.json').read_text())
        pins=manifest['announcements'];pin=next(p for p in pins if p.get('eventId')==1238)
        self.assertEqual({p['eventId'] for p in manifest['retryArticles']},{1089,1139,1184,1239,1250})
        self.assertNotIn(1238,{p['eventId'] for p in manifest['retryArticles']})
        self.assertEqual(pin['replacement']['reason'],'reviewed-evidence-precision')
        self.assertIn('3つのターゲット',pin['copy']['facts'][2]['ja'])
        self.assertIn('across three targets',pin['copy']['facts'][2]['en'])
        self.assertNotIn('did not affect',pin['copy']['facts'][2]['en'])


class TargetCountValidationTests(unittest.TestCase):
    SOURCE='Binding affinity, measured as KD, comparing watermarked and unwatermarked protein designs across three targets.'

    def test_literal_target_counts_match_in_both_languages(self):
        for ja in ('3つのターゲットでKDを比較した。','3個のタンパク質ターゲットでKDを比較した。'):
            for en in ('KD was compared across three targets.','KD was compared across 3 protein targets.'):
                with self.subTest(ja=ja,en=en):
                    factual.validate_numbers(ja,self.SOURCE);factual.validate_numbers(en,self.SOURCE)
                    factual.validate_pair(ja,en)

    def test_changed_target_count_or_borrowed_quantity_rejects(self):
        for wrong in ('4つのターゲット','30つのターゲット','-3つのターゲット',
                      'four targets','30 protein targets','-3 targets','3日間','3月','3 proteins','$3'):
            with self.subTest(wrong=wrong),self.assertRaisesRegex(ValueError,'unsupported-number'):
                factual.validate_numbers(wrong,self.SOURCE)
        for source in ('The experiment was conducted in March.','The study describes 3 proteins.',
                       'The chart compares twenty-three targets.', 'The chart compares 1,003 targets.',
                       'The chart compares twenty–three targets.', 'The chart compares twenty−three targets.',
                       'The chart compares 1,003つのターゲット.', '$3 targets', '$ 3 targets'):
            with self.subTest(source=source),self.assertRaisesRegex(ValueError,'unsupported-number'):
                factual.validate_numbers('3つのターゲット',source)
        with self.assertRaisesRegex(ValueError,'unsupported-number'):
            factual.validate_pair('3つのターゲット','four targets')


if __name__=='__main__':unittest.main()
