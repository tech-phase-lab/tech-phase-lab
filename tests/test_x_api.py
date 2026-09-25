"""Synthetic tests for the disabled-by-default X adapter; no live X requests."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import monitor
import signals
import x_api


class XApiTests(unittest.TestCase):
    def setUp(self):
        self.source = next(s for s in signals.SOURCES if s["id"] == "x-tipranks")

    def test_x_source_scope_matches_the_22_configured_company_roster(self):
        x_sources = [source for source in signals.SOURCES if source.get("format") == "x-api"]
        self.assertEqual({ticker for source in x_sources for ticker in source["tickers"]}, set(monitor.PROVIDERS))
        for source in x_sources:
            self.assertLessEqual(len(source["query"]), 512)

    def test_x_sources_are_disabled_without_both_explicit_flag_and_token(self):
        with patch.dict(os.environ, {"X_API_ENABLED": "true", "X_BEARER_TOKEN": ""}, clear=False):
            self.assertNotIn(self.source, signals.enabled_sources())
        with patch.dict(os.environ, {"X_API_ENABLED": "false", "X_BEARER_TOKEN": "secret"}, clear=False):
            self.assertNotIn(self.source, signals.enabled_sources())

    def test_only_configured_publishers_and_ticker_matches_are_retained(self):
        payload = {
            "data": [
                {"id": "1001", "author_id": "1", "created_at": "2026-09-25T00:00:00Z",
                 "text": "Micron price target raised to $500"},
                {"id": "1002", "author_id": "2", "created_at": "2026-09-25T00:01:00Z",
                 "text": "Unrelated market note"},
                {"id": "1003", "author_id": "3", "created_at": "2026-09-25T00:02:00Z",
                 "text": "$NBIS price target raised to $250"},
            ],
            "includes": {"users": [
                {"id": "1", "username": "TipRanks"},
                {"id": "2", "username": "TipRanks"},
                {"id": "3", "username": "unapproved_account"},
            ]},
        }
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["url"], "https://x.com/TipRanks/status/1001")
        self.assertIn("MU", items[0]["matches"])

    def test_direct_adapter_call_fails_closed(self):
        with patch.dict(os.environ, {"X_API_ENABLED": "false", "X_BEARER_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "x-api-disabled"):
                x_api.fetch_posts(self.source, list(monitor.PROVIDERS), opener_factory=lambda: self.fail("network called"))


if __name__ == "__main__":
    unittest.main()
