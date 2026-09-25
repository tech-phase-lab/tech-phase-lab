"""Synthetic tests for the disabled-by-default X adapter; no live X requests."""
import os
import sqlite3
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
        self.assertEqual({source["accounts"][0].lower() for source in x_sources},
                         {"tipranks", "theflynews", "wallstengine"})
        self.assertEqual({ticker for source in x_sources for ticker in source["tickers"]}, set(monitor.PROVIDERS))
        for source in x_sources:
            self.assertLessEqual(len(source["query"]), 512)
            self.assertIn('"price target"', source["query"])
            self.assertIn('"target price"', source["query"])
            self.assertIn('"PT to"', source["query"])
            self.assertIn('"quarterly results"', source["query"])

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
                {"id": "1004", "author_id": "1", "created_at": "2026-09-25T00:03:00Z",
                 "text": "$MU releases new product lineup"},
                {"id": "1005", "author_id": "1", "created_at": "2026-09-25T00:04:00Z",
                 "text": "$NBIS analyst lifts PT to $399"},
            ],
            "includes": {"users": [
                {"id": "1", "username": "TipRanks"},
                {"id": "2", "username": "TipRanks"},
                {"id": "3", "username": "unapproved_account"},
            ]},
        }
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["url"], "https://x.com/TipRanks/status/1001")
        self.assertIn("MU", items[0]["matches"])
        self.assertEqual(items[1]["url"], "https://x.com/TipRanks/status/1005")

    def test_fetched_x_post_reaches_private_editorial_queue(self):
        payload = {
            "data": [{"id": "1001", "author_id": "1", "created_at": "2026-09-25T00:00:00Z",
                      "text": "Micron price target raised to $500"}],
            "includes": {"users": [{"id": "1", "username": "TipRanks"}]},
        }
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        with patch.dict(os.environ, {"X_API_ENABLED": "true", "X_BEARER_TOKEN": "test-token"}):
            with patch.object(x_api, "fetch_posts", return_value={"_items": items}):
                with sqlite3.connect(":memory:") as db:
                    db.row_factory = sqlite3.Row
                    result = signals.check(db, self.source, list(monitor.PROVIDERS))
                    self.assertEqual(result["status"], "ok")
                    self.assertEqual(result["matchedItems"], 1)
                    queue = signals.queue(db, ticker="MU")
                    self.assertEqual(queue["counts"]["baseline"], 1)
                    self.assertEqual(queue["items"][0]["url"], "https://x.com/TipRanks/status/1001")

    def test_wall_st_engine_post_is_kept_only_for_a_monitored_company(self):
        source = next(s for s in signals.SOURCES if s["id"] == "x-wallstengine")
        payload = {"data": [
            {"id": "2001", "author_id": "2", "text": "$NBIS price target raised to $399"},
            {"id": "2002", "author_id": "2", "text": "$XYZ price target raised to $20"},
        ], "includes": {"users": [{"id": "2", "username": "wallstengine"}]}}
        items = x_api.parse_response(source, payload, list(monitor.PROVIDERS))
        self.assertEqual([item["url"] for item in items], ["https://x.com/wallstengine/status/2001"])

    def test_earnings_posts_are_kept_separate_from_target_changes_and_previews(self):
        source = self.source
        payload = {"data": [
            {"id": "3001", "author_id": "1", "text": "$MU reports Q2 earnings, revenue rose 25%"},
            {"id": "3002", "author_id": "1", "text": "$MU earnings preview: revenue is expected to rise"},
            {"id": "3003", "author_id": "1", "text": "$MU price target raised to $500"},
            {"id": "3004", "author_id": "1", "text": "$NBIS quarterly results: revenue beat forecasts"},
        ], "includes": {"users": [{"id": "1", "username": "TipRanks"}]}}
        self.assertEqual([item["url"] for item in x_api.parse_response(source, payload, list(monitor.PROVIDERS))],
                         ["https://x.com/TipRanks/status/3001", "https://x.com/TipRanks/status/3003",
                          "https://x.com/TipRanks/status/3004"])

    def test_direct_adapter_call_fails_closed(self):
        with patch.dict(os.environ, {"X_API_ENABLED": "false", "X_BEARER_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "x-api-disabled"):
                x_api.fetch_posts(self.source, list(monitor.PROVIDERS), opener_factory=lambda: self.fail("network called"))


if __name__ == "__main__":
    unittest.main()
