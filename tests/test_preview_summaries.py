"""Bilingual one-line summary + detail for original-preview stories (no live calls)."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import preview_summaries
import test_original_preview_news as fixtures

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
       'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'synthetic-model', 'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '5'}
GOOD = {'titleJa': 'Unfamiliar Industries、世界の顧客向けに新システムを導入',
        'titleEn': 'Unfamiliar Industries introduces a new system for customers around the world',
        'bodyJa': 'Unfamiliar Industriesは、世界中の顧客向けに新しいシステムを導入したと発表した。発表はPR Newswire経由。',
        'bodyEn': 'Unfamiliar Industries announced a new system for customers around the world. The release was distributed by PR Newswire.'}


def reply(copy):
    return lambda payload, key: {'status': 'completed', 'output_text': json.dumps(copy, ensure_ascii=False)}


class PreviewSummaryTests(unittest.TestCase):
    setUp = fixtures.OriginalPreviewTests.setUp
    article = fixtures.OriginalPreviewTests.article
    publish = fixtures.OriginalPreviewTests.publish
    feed = fixtures.OriginalPreviewTests.feed

    def run_summary(self, transport, now=None):
        now = fixtures.NOW.timestamp() if now is None else now
        with patch('builtins.print'):
            return preview_summaries.run_once(self.path, transport, ENV, now=now)

    def test_checked_summary_is_attached_to_the_original_card(self):
        self.article()
        self.publish()
        seen = []

        def provider(payload, key):
            seen.append(json.loads(payload['input']))
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_summary(provider), 'done')
        self.assertIn('Retained full source body', seen[0]['text'])
        [item] = self.feed()
        self.assertEqual(item['summaryPolicy'], preview_summaries.POLICY_ID)
        self.assertEqual({key: item[key] for key in preview_summaries.FIELDS}, GOOD)
        self.assertEqual(self.run_summary(lambda *_: self.fail('no second call')), 'idle')

    def test_reversed_or_invented_copy_is_held_and_retried_with_the_reason(self):
        self.article()
        self.publish()
        bad = {**GOOD, 'bodyJa': GOOD['bodyJa'] + '売上高は10%減少した。', 'bodyEn': GOOD['bodyEn'] + ' Revenue fell 10%.'}
        self.assertEqual(self.run_summary(reply(bad)), 'retry')
        [item] = self.feed()
        self.assertNotIn('summaryPolicy', item)  # The original stays, marked pending.
        seen = []

        def provider(payload, key):
            seen.append(json.loads(payload['input']))
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_summary(provider, fixtures.NOW.timestamp() + 15), 'done')
        self.assertEqual(seen[0]['previousRejection'], 'unsupported-number')

    def test_shared_daily_budget_stops_new_calls(self):
        self.article()
        self.publish()
        with headline_translation.connect(self.path) as db:
            for index in range(5):
                db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)",
                           (fixtures.NOW.timestamp() - 60, 's', 'x', 'm', 'done', f'lease-{index}'))
        self.assertEqual(self.run_summary(lambda *_: self.fail('over budget')), 'idle')


if __name__ == '__main__':
    unittest.main()


class PreviewSummaryBudgetTests(unittest.TestCase):
    setUp = fixtures.OriginalPreviewTests.setUp
    article = fixtures.OriginalPreviewTests.article
    publish = fixtures.OriginalPreviewTests.publish
    feed = fixtures.OriginalPreviewTests.feed
    run_summary = PreviewSummaryTests.run_summary

    def test_summaries_use_at_most_their_share_of_the_daily_limit(self):
        self.article()
        self.publish()
        with headline_translation.connect(self.path) as db:
            preview_summaries.schema(db)
            for index in range(2):  # 40% of the limit of 5.
                db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)",
                           (fixtures.NOW.timestamp() - 60, preview_summaries.LEDGER_PREFIX + 's', 'x', 'm', 'failed', f'p-{index}'))
        self.assertEqual(self.run_summary(lambda *_: self.fail('over lane share')), 'idle')

    def test_truncated_output_is_classified_and_retried_with_reason(self):
        self.article()
        self.publish()
        truncated = lambda *_: {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}}
        self.assertEqual(self.run_summary(truncated), 'retry')
        with headline_translation.connect(self.path) as db:
            job = db.execute('SELECT failure_kind FROM preview_summary_jobs').fetchone()
        self.assertEqual(job['failure_kind'], 'output-token-limit')

    def test_stored_summary_is_validated_once_per_revision(self):
        self.article()
        self.publish()
        self.assertEqual(self.run_summary(reply(GOOD)), 'done')
        preview_summaries._ATTACH_RESULTS.clear()
        with patch.object(preview_summaries, 'validate', wraps=preview_summaries.validate) as checked:
            for _ in range(3):
                [item] = self.feed()
                self.assertEqual(item['summaryPolicy'], preview_summaries.POLICY_ID)
        self.assertEqual(checked.call_count, 1)
