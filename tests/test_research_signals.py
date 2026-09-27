"""Synthetic regression cases for private multi-company intake, never live news."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import monitor
import signals
import service


def feed(title="ClusterMAX review", body="Nebius and CoreWeave receive Platinum ratings.", url="https://newsletter.semianalysis.com/p/test"):
    return f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
      <title>{title}</title><link>{url}</link><pubDate>Wed, 23 Sep 2026 21:20:29 GMT</pubDate>
      <content:encoded><![CDATA[<p>{body}</p>]]></content:encoded></item></channel></rss>'''.encode()


class SignalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "test.sqlite"
        self.db = monitor.connect(self.path)
        self.feed = signals.SOURCES[0]
        self.doc = next(s for s in signals.SOURCES if s["id"] == "nebius-preemptible")
        self.tickers = list(monitor.PROVIDERS)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def check_feed(self, content, **response):
        return signals.check(self.db, self.feed, self.tickers, lambda *_: {"body": content, **response})

    def test_public_targets_only_recent_parseable_x_facts(self):
        signals.schema(self.db)
        reference = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
        for index, (title, published, observed) in enumerate([
            ("AMD price target raised to $720 from $620 at BofA", reference - timedelta(minutes=5), reference - timedelta(minutes=3)),
            ("AMD price target raised to $750 from $620 at BofA", reference - timedelta(days=3), reference - timedelta(minutes=3)),
            ("AMD price target raised to $760 from $620 at BofA", reference - timedelta(hours=2), reference - timedelta(minutes=3)),
            ("AMD price target raised to $800 from $620", reference - timedelta(minutes=5), reference - timedelta(minutes=3)),
        ]):
            self.db.execute("""INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,
              matches_json,event_kind,published_at,published_on,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)""", (
                "x-tipranks", f"https://x.com/TipRanks/status/{index + 1}", str(index), "", title,
                '["AMD"]', "{}", "new", published.isoformat(), None, observed.isoformat(),
                "private raw post text", "",
            ))
        result = signals.public_price_targets(self.db, now=reference)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual((result["items"][0]["previous"], result["items"][0]["latest"]), (620, 720))
        self.assertNotIn("private raw post text", str(result))

    def test_target_history_retains_unlisted_ticker_for_seven_days(self):
        signals.schema(self.db)
        reference = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)
        for index, age in enumerate([2, 8]):
            published = reference - timedelta(days=age)
            self.db.execute("""INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,
              matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)""", (
                "x-tipranks", f"https://x.com/TipRanks/status/{index+1}", str(index), "",
                "$AAPL price target cut to $200 from $250 at BofA", '["AAPL"]', "{}", "new",
                published.isoformat(), (published+timedelta(minutes=2)).isoformat(), "", ""))
        items = signals.public_price_targets(self.db, now=reference)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ticker"], "AAPL")

    def test_public_target_from_multiple_accounts_uses_first_detection_once(self):
        signals.schema(self.db)
        reference = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
        for index, (source_id, observed) in enumerate([
            ("x-tipranks", reference - timedelta(minutes=2)),
            ("x-thefly", reference - timedelta(minutes=3)),
            ("x-wallstengine", reference - timedelta(minutes=1)),
        ]):
            self.db.execute("""INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,
              matches_json,event_kind,published_at,published_on,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)""", (
                source_id, f"https://x.com/example/status/{index + 1}", str(index), "",
                "AMD price target raised to $720 from $620 at BofA", '["AMD"]', "{}", "new",
                (reference - timedelta(minutes=4)).isoformat(), None, observed.isoformat(), "", "",
            ))
        result = signals.public_price_targets(self.db, now=reference)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["source"], "X · The Fly")
        self.assertEqual(result["items"][0]["observedAt"], (reference - timedelta(minutes=3)).isoformat())

    def test_signal_route_errors_have_safe_specific_diagnostic_codes(self):
        cases = {
            "unexpected-signal-content-type": "signal-content-type",
            "not-a-signal-feed": "signal-invalid-feed-root",
            "signal-index-no-articles": "signal-no-article-links",
            "signal-article-body-limit": "signal-article-body-invalid",
            "x-api-daily-limit": "x-api-daily-limit",
            "x-api-paced": "x-api-paced",
            "x-api-daily-limit-invalid": "x-api-budget-invalid",
        }
        for message, expected in cases.items():
            with self.subTest(message=message):
                self.assertEqual(monitor.source_error_code(ValueError(message)), expected)

    def test_legacy_source_error_detail_is_reduced_to_fixed_code(self):
        self.assertEqual(
            monitor.persisted_source_error_code(
                'https://private.invalid/news failed with customer detail'
            ),
            'fetch-failed',
        )
        self.assertEqual(monitor.persisted_source_error_code('http-503'), 'http-503')
        self.assertIsNone(monitor.persisted_source_error_code(None))

    def test_legacy_route_error_detail_is_reduced_before_queue_render(self):
        signals.schema(self.db)
        with self.db:
            self.db.execute(
                """INSERT INTO signal_routes(id,initialized,error)
                   VALUES(?,1,?)""",
                (self.feed["id"], "https://private.invalid failed with customer detail"),
            )
        route = signals.queue(self.db, sources=[self.feed])["routes"][0]
        self.assertEqual(route["error"], "fetch-failed")
        self.assertNotIn("private.invalid", json.dumps(route))
        self.db.execute(
            "UPDATE signal_routes SET error=? WHERE id=?",
            ("article-fetch-failed:7", self.feed["id"]),
        )
        self.assertEqual(
            signals.queue(self.db, sources=[self.feed])["routes"][0]["error"],
            "article-fetch-failed:7",
        )
        self.assertEqual(
            monitor.persisted_route_error_code("article-fetch-failed:1001"),
            "fetch-failed",
        )

    def test_body_only_multicompany_association_and_no_false_ticker(self):
        self.assertEqual(len(signals.ALIASES), 22)
        items = signals.parse(self.feed, feed(), self.tickers)
        self.assertEqual(set(items[0]["matches"]), {"NBIS", "CRWV"})
        self.assertNotIn("NBIS", items[0]["title"])
        self.assertEqual(signals.match_companies("a robot arm will be useful", self.tickers), {})
        self.assertEqual(set(signals.match_companies("$ARM, Arm Holdings and $MU", self.tickers)), {"ARM", "MU"})

    def test_baseline_restart_and_repeat_do_not_create_new_events(self):
        self.assertEqual(self.check_feed(feed())["events"], 1)
        self.db.close()
        self.db = monitor.connect(self.path)
        self.assertEqual(self.check_feed(feed())["events"], 0)
        queue = signals.queue(self.db)
        self.assertEqual(queue["counts"]["baseline"], 1)
        self.assertEqual(queue["counts"]["new"], 0)
        self.check_feed(feed(url="https://newsletter.semianalysis.com/p/new"))
        self.assertEqual(signals.queue(self.db)["counts"]["new"], 1)
        self.assertEqual(len(signals.queue(self.db, ticker="CRWV")["items"]), 2)
        self.assertEqual(len(signals.queue(self.db, ticker="MU")["items"]), 0)

    def test_same_url_document_change_and_navigation_noise(self):
        text = "Preemptible VMs support configurable pricing policies. " * 4
        def check(text, nav="Home"):
            return signals.check(self.db, self.doc, self.tickers, lambda *_: {
                "body": f"<html><nav>{nav}</nav><main><p>{text}</p></main></html>".encode()})
        check(text)
        self.assertEqual(check(text, "New navigation NVIDIA")["events"], 0)
        self.assertEqual(check(text + "Follow spot price is now available.")["events"], 1)
        items = signals.queue(self.db, view="changed")["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["tickers"], ["NBIS"])
        self.assertIn("Follow spot price", items[0]["diff"])
        self.assertIsNone(items[0]["publishedAt"])

    def test_unchanged_document_backfills_date_only_without_new_event(self):
        self.assertEqual(self.check_feed(feed())["events"], 1)
        items = signals.parse(self.feed, feed(), self.tickers)
        items[0]["publishedOn"] = "2026-09-23"
        count = signals.save(
            self.db, self.feed, items, {}, signals.stamp(), "backfill-test", 1
        )
        queue = signals.queue(self.db)
        self.assertEqual(count, 0)
        self.assertEqual(queue["counts"]["all"], 1)
        self.assertEqual(queue["items"][0]["publishedOn"], "2026-09-23")

    def test_operational_summary_is_bounded_redacted_and_separates_date_only_evidence(self):
        reference = datetime(2026, 9, 25, 7, 0, tzinfo=timezone.utc)
        official = [self.doc, next(
            source for source in signals.SOURCES
            if source["id"] == "palantir-shareholder-letters"
        )]
        excluded = [self.feed, next(
            source for source in signals.SOURCES if source["format"] == "x-api"
        )]
        signals.schema(self.db)
        with self.db:
            self.db.execute("""INSERT INTO signal_routes(
              id,initialized,checked_at,succeeded_at,next_check_at,failures,error
              ) VALUES(?,1,?,?,?,0,NULL)""", (
                official[0]["id"], "2026-09-25T06:59:00+00:00",
                "2026-09-25T06:59:00+00:00", "2026-09-25T07:01:00+00:00",
            ))
            self.db.execute("""INSERT INTO signal_routes(
              id,initialized,checked_at,next_check_at,failures,error
              ) VALUES(?,1,?,?,1,?)""", (
                official[1]["id"], "2026-09-25T06:58:00+00:00",
                "2026-09-25T07:03:00+00:00", "http-403",
            ))
            self.db.execute("""INSERT INTO signal_routes(
              id,initialized,checked_at,succeeded_at,next_check_at,failures,error
              ) VALUES(?,1,?,?,?,0,NULL)""", (
                excluded[0]["id"], "2026-09-25T06:59:00+00:00",
                "2026-09-25T06:59:00+00:00", "2026-09-25T07:01:00+00:00",
            ))
            self.db.execute("INSERT INTO signal_index_state VALUES(?,?)", (
                official[0]["id"], json.dumps({"initialized": True, "children": {
                    "https://private.invalid/restricted": {
                        "error": "http-403", "next_check": "2026-09-25T07:04:00+00:00",
                    },
                    "https://private.invalid/due": {
                        "error": "timeout", "next_check": "2026-09-25T06:59:00+00:00",
                    },
                    "https://private.invalid/success": {
                        "error": None, "next_check": "2026-09-25T07:05:00+00:00",
                    },
                }, "recoveries": [
                    {
                        "failedAt": "2026-09-25T06:50:00+00:00",
                        "recoveredAt": "2026-09-25T06:55:00+00:00",
                        "attempts": 3,
                    },
                    {
                        "failedAt": "2026-09-23T06:50:00+00:00",
                        "recoveredAt": "2026-09-23T06:55:00+00:00",
                        "attempts": 2,
                    },
                    {
                        "failedAt": "invalid",
                        "recoveredAt": "2026-09-25T06:56:00+00:00",
                        "attempts": 2,
                    },
                ]}),
            ))
            events = [
                (official[0]["id"], "timestamp", "2026-09-25T06:00:00+00:00", None),
                (official[0]["id"], "missing", "2099-01-01T00:00:00+00:00", "not-a-date"),
                (official[1]["id"], "date", None, "2026-08-03"),
                (excluded[0]["id"], "external", "2026-09-25T06:00:00+00:00", None),
                (excluded[1]["id"], "x-api", "2026-09-25T06:00:00+00:00", None),
            ]
            for index, (source_id, title, published_at, published_on) in enumerate(events):
                self.db.execute("""INSERT INTO signal_events(
                  source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
                  published_at,published_on,observed_at,excerpt,diff,truncated
                  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)""", (
                    source_id, f"https://example.invalid/{index}", str(index), "", title,
                    "[]", "{}", "baseline", published_at, published_on,
                    "2026-09-25T06:30:00+00:00", "private evidence", "",
                ))

        summary = signals.operational_summary(
            self.db, sources=official + excluded, reference=reference
        )
        self.assertEqual(summary["routes"], {
            "configured": 2, "checked": 2, "fresh": 1,
            "stale": 0, "error": 1, "pending": 0,
            "errorKinds": {
                "accessRestricted": 1, "rateLimited": 0, "timeout": 0,
                "server": 0, "invalidResponse": 0,
                "articlePartial": 0, "other": 0,
            },
            "retry": {
                "due": 0, "deferred": 1, "unscheduled": 0,
                "nextAt": "2026-09-25T07:03:00+00:00",
                "byErrorKind": {
                    "accessRestricted": {
                        "due": 0, "deferred": 1, "unscheduled": 0,
                        "nextAt": "2026-09-25T07:03:00+00:00",
                    },
                    "rateLimited": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                    "timeout": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                    "server": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                    "invalidResponse": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                    "articlePartial": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                    "other": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                },
            },
            "activeOutages": {
                "measured": 0, "unmeasured": 1, "ageMaxMs": None,
                "attemptsAverage": None, "attemptsMax": None,
                "oldestStartedAt": None,
                "byErrorKind": {
                    "accessRestricted": {
                        "measured": 0, "unmeasured": 1, "ageMaxMs": None,
                        "attemptsAverage": None, "attemptsMax": None,
                        "oldestStartedAt": None,
                    },
                },
            },
        })
        self.assertEqual(summary["publicationEvidence"], {
            "total": 3, "timestamp": 1, "dateOnly": 1, "missing": 1,
        })
        self.assertEqual(summary["articleRetrieval"]["error"], 2)
        self.assertEqual(summary["articleRetrieval"]["errorKinds"], {
            "accessRestrict