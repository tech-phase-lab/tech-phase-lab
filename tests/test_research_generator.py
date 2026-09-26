import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("brief_generator_unit", ROOT / "scripts/research/brief_generator.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class BriefGeneratorTests(unittest.TestCase):
    def source(self):
        return {"url": "https://example.com/release", "ticker": "TEST", "title": "Release", "sha256": "a" * 64,
                "extracted_text": "Capacity will increase in 2027. Execution remains subject to demand."}

    def test_unconfigured_generator_fails_before_network(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(g.GenerationUnavailable):
                g.generate_draft(self.source(), transport=lambda *_: self.fail("network must not be called"))
        with self.assertRaises(g.GenerationUnavailable):
            g.configuration({"OPENAI_API_KEY": "replace-only-after-explicitly-enabling-generation", "RESEARCH_SUMMARY_MODEL": "choose-an-approved-model"})

    def test_structured_response_is_parsed_without_publishing(self):
        draft = {"summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。", "impactLabel": "mixed",
                 "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。", "confidence": "medium",
                 "evidence": {"summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."]}}
        captured = {}
        def transport(payload, key):
            captured.update(payload)
            self.assertEqual(key, "k" * 24)
            return {"id": "resp_1", "model": "test-model", "usage": {
                "input_tokens": 321, "output_tokens": 123, "total_tokens": 444,
            }, "output": [{"content": [{"type": "output_text", "text": json.dumps(draft)}]}]}
        result = g.generate_draft(self.source(), transport=transport,
                                  env={"OPENAI_API_KEY": "k" * 24, "RESEARCH_SUMMARY_MODEL": "test-model"})
        self.assertEqual(result["draft"], draft)
        self.assertEqual(result["audit"]["responseId"], "resp_1")
        self.assertEqual(result["audit"]["inputTokens"], 321)
        self.assertEqual(result["audit"]["outputTokens"], 123)
        self.assertEqual(result["audit"]["totalTokens"], 444)
        self.assertGreaterEqual(g.token_reservation(self.source()["extracted_text"]), g.MAX_OUTPUT_TOKENS)
        self.assertTrue(captured["text"]["format"]["strict"])
        self.assertIn("summaryJa must appear in evidence.summary", captured["instructions"])
        self.assertIn("impactJa must appear in evidence.impact", captured["instructions"])
        self.assertNotIn("publish", json.dumps(captured))

    def test_refusal_and_malformed_evidence_are_rejected(self):
        env = {"OPENAI_API_KEY": "k" * 24, "RESEARCH_SUMMARY_MODEL": "test-model"}
        with self.assertRaises(g.GenerationFailed):
            g.generate_draft(self.source(), lambda *_: {"output": [{"content": [{"type": "refusal", "refusal": "no"}]}]}, env)
        malformed = {"summaryJa": "日本語の十分に長い要約文章をここへ記録します。", "impactLabel": "neutral",
                     "impactJa": "日本語の十分に長い影響文章をここへ記録します。", "confidence": "low", "evidence": {"summary": [], "impact": []}}
        with self.assertRaises(g.GenerationFailed):
            g.generate_draft(self.source(), lambda *_: {"output_text": json.dumps(malformed)}, env)

    def test_invalid_or_missing_usage_is_not_invented(self):
        self.assertEqual(g.token_usage({}), {"inputTokens": None, "outputTokens": None, "totalTokens": None})
        self.assertEqual(g.token_usage({"usage": {"input_tokens": True, "output_tokens": -1, "total_tokens": "8"}}),
                         {"inputTokens": None, "outputTokens": None, "totalTokens": None})
        self.assertEqual(g.token_usage({"usage": {"input_tokens": 10, "output_tokens": 5}})["totalTokens"], 15)

    def test_retry_after_defers_without_repeating_request(self):
        calls = []
        error = HTTPError(g.RESPONSES_URL, 429, "limit", {"Retry-After": "7200"}, None)

        def blocked(*_args, **_kwargs):
            calls.append(True)
            raise error

        with patch.object(g, "urlopen", blocked), patch.object(g.time, "sleep") as sleep:
            with self.assertRaises(g.GenerationFailed) as raised:
                g.request_response({"model": "test"}, "k" * 24)
        self.assertEqual(raised.exception.retry_after_seconds, 7200)
        self.assertEqual(len(calls), 1)
        sleep.assert_not_called()

    def test_retry_after_http_date_and_ceiling_are_bounded(self):
        current = datetime(2026, 9, 25, tzinfo=timezone.utc)
        dated = HTTPError(g.RESPONSES_URL, 503, "busy", {
            "Retry-After": "Fri, 25 Sep 2026 02:00:00 GMT",
        }, None)
        excessive = HTTPError(g.RESPONSES_URL, 429, "limit", {
            "Retry-After": str(30 * 24 * 60 * 60),
        }, None)
        self.assertEqual(g.retry_after_seconds(dated, current), 7200)
        self.assertEqual(g.retry_after_seconds(excessive, current), g.MAX_RETRY_AFTER_SECONDS)


if __name__ == "__main__":
    unittest.main()
