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
            "accessRestricted": 1, "rateLimited": 0, "timeout": 1,
            "server": 0, "invalidResponse": 0,
            "articlePartial": 0, "other": 0,
        })
        article_retry = summary["articleRetrieval"]["retry"]
        self.assertEqual(
            {key: article_retry[key] for key in ("due", "deferred", "unscheduled", "nextAt")},
            {"due": 1, "deferred": 1, "unscheduled": 0,
             "nextAt": "2026-09-25T07:04:00+00:00"},
        )
        self.assertEqual(article_retry["byErrorKind"]["timeout"]["due"], 1)
        self.assertEqual(
            article_retry["byErrorKind"]["accessRestricted"],
            {"due": 0, "deferred": 1, "unscheduled": 0,
             "nextAt": "2026-09-25T07:04:00+00:00"},
        )
        self.assertEqual(summary["articleRetrieval"]["recoveries24Hours"], {
            "count": 1,
            "latencyAverageMs": 300_000,
            "latencyMaxMs": 300_000,
            "attemptsAverage": 3.0,
            "attemptsMax": 3,
            "lastRecoveredAt": "2026-09-25T06:55:00+00:00",
        })
        self.assertEqual(summary["routeTransitions24Hours"], {
            "recoveries": 0, "failures": 0, "changes": 0,
            "lastOutcome": None, "lastOccurredAt": None,
        })
        serialized = json.dumps(summary)
        self.assertNotIn("https://", serialized)
        self.assertNotIn("palantir", serialized.lower())
        self.assertNotIn("http-403", serialized)
        self.assertNotIn("private.invalid", serialized)

    def test_operational_summary_ignores_malformed_or_oversized_article_state(self):
        official = [self.doc, next(
            source for source in signals.SOURCES
            if source["id"] == "palantir-shareholder-letters"
        )]
        signals.schema(self.db)
        with self.db:
            self.db.execute("INSERT INTO signal_index_state VALUES(?,?)", (
                official[0]["id"], "not-json",
            ))
            self.db.execute("INSERT INTO signal_index_state VALUES(?,?)", (
                official[1]["id"], " " * 2_000_001,
            ))
        summary = signals.operational_summary(self.db, sources=official)
        self.assertEqual(summary["articleRetrieval"]["error"], 0)
        self.assertEqual(sum(summary["articleRetrieval"]["errorKinds"].values()), 0)
        self.assertEqual(summary["articleRetrieval"]["retry"]["unscheduled"], 0)

    def test_signal_error_kind_uses_fixed_aggregate_categories(self):
        cases = {
            "http-403": "accessRestricted",
            "verification-page": "accessRestricted",
            "http-429": "rateLimited",
            "timeout": "timeout",
            "http-503": "server",
            "signal-invalid-feed-root": "invalidResponse",
            "unsupported-content-type": "invalidResponse",
            "article-fetch-failed:2": "articlePartial",
            "unexpected-private-detail": "other",
        }
        for error, expected in cases.items():
            with self.subTest(error=error):
                self.assertEqual(signals.signal_error_kind(error), expected)

    def test_operational_summary_bounds_retry_schedule_without_route_details(self):
        reference = datetime(2026, 9, 25, 7, 0, tzinfo=timezone.utc)
        official = [source for source in signals.SOURCES
                    if source.get("kind") != "external-research"
                    and source.get("format") != "x-api"][:3]
        schedules = [
            ("2026-09-25T06:59:00+00:00", "timeout"),
            ("2026-09-25T07:10:00+00:00", "article-fetch-failed:1"),
            ("2099-01-01T00:00:00+00:00", "http-403"),
        ]
        signals.schema(self.db)
        with self.db:
            for source, (next_check, error) in zip(official, schedules):
                self.db.execute("""INSERT INTO signal_routes(
                  id,initialized,checked_at,next_check_at,failures,error
                  ) VALUES(?,1,?,?,1,?)""", (
                    source["id"], "2026-09-25T06:58:00+00:00", next_check, error,
                ))
        summary = signals.operational_summary(
            self.db, sources=official, reference=reference
        )
        self.assertEqual(summary["routes"]["retry"], {
            "due": 1, "deferred": 1, "unscheduled": 1,
            "nextAt": "2026-09-25T07:10:00+00:00",
            "byErrorKind": {
                "accessRestricted": {"due": 0, "deferred": 0, "unscheduled": 1, "nextAt": None},
                "rateLimited": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                "timeout": {"due": 1, "deferred": 0, "unscheduled": 0, "nextAt": None},
                "server": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                "invalidResponse": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
                "articlePartial": {
                    "due": 0, "deferred": 1, "unscheduled": 0,
                    "nextAt": "2026-09-25T07:10:00+00:00",
                },
                "other": {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
            },
        })
        self.assertEqual(sum(summary["routes"]["errorKinds"].values()), 3)
        serialized = json.dumps(summary)
        for private_value in ("article-fetch-failed", "http-403"):
            self.assertNotIn(private_value, serialized)

    def test_route_retry_wait_persists_without_route_identity(self):
        signals.schema(self.db)
        with self.db:
            self.db.execute("""INSERT INTO signal_routes(
              id,initialized,checked_at,next_check_at,failures,error
              ) VALUES(?,1,?,?,1,?)""", (
                self.doc["id"], "2026-09-25T09:55:00+00:00",
                "2026-09-25T10:00:00+00:00", "timeout",
            ))
        route = self.db.execute(
            "SELECT * FROM signal_routes WHERE id=?", (self.doc["id"],)
        ).fetchone()
        self.assertFalse(signals.record_route_retry_attempt(
            self.db, self.doc["id"], route, "2026-09-25T09:59:59+00:00"
        ))
        self.assertTrue(signals.record_route_retry_attempt(
            self.db, self.doc["id"], route, "2026-09-25T10:00:03.250+00:00"
        ))
        self.assertTrue(signals.record_route_retry_attempt(
            self.db, self.doc["id"], route, "2026-09-25T10:02:00+00:00"
        ))
        self.db.commit()
        self.db.close()
        self.db = monitor.connect(self.path)
        summary = signals.operational_summary(
            self.db, sources=[self.doc],
            reference=datetime(2026, 9, 25, 10, 1, tzinfo=timezone.utc),
        )
        self.assertEqual(summary["routeRetryWait24Hours"], {
            "count": 1, "waitAverageMs": 3250, "waitMaxMs": 3250,
            "lastAttemptedAt": "2026-09-25T10:00:03.250000+00:00",
        })
        serialized = json.dumps(summary["routeRetryWait24Hours"])
        self.assertNotIn(self.doc["id"], serialized)
        self.assertNotIn("timeout", serialized)

    def test_route_recovery_history_survives_restart_without_repeated_failure_inflation(self):
        html = b"<html><main><p>" + (b"Nebius official infrastructure update. " * 5) + b"</p></main></html>"
        self.assertEqual(signals.check(
            self.db, self.doc, self.tickers, lambda *_: {"body": html}
        )["status"], "ok")

        def timeout(*_args):
            raise TimeoutError("private route detail")

        self.assertEqual(signals.check(self.db, self.doc, self.tickers, timeout)["status"], "error")
        self.assertEqual(signals.check(self.db, self.doc, self.tickers, timeout)["status"], "error")
        self.assertEqual(signals.check(
            self.db, self.doc, self.tickers, lambda *_: {"body": html}
        )["status"], "ok")
        self.db.close()
        self.db = monitor.connect(self.path)
        self.assertEqual(signals.check(self.db, self.doc, self.tickers, timeout)["status"], "error")

        def restricted(*_args):
            raise HTTPError("https://private.invalid/route", 403, "forbidden", {}, None)

        self.assertEqual(signals.check(self.db, self.doc, self.tickers, restricted)["status"], "error")
        self.assertEqual(signals.check(self.db, self.doc, self.tickers, restricted)["status"], "error")

        history = self.db.execute(
            "SELECT outcome,previous_kind,current_kind,occurred_at "
            "FROM signal_route_transitions ORDER BY id"
        ).fetchall()
        self.assertEqual(
            [row["outcome"] for row in history],
            ["failed", "recovered", "failed", "changed"],
        )
        self.assertEqual(history[0]["current_kind"], "timeout")
        self.assertEqual(history[-1]["current_kind"], "accessRestricted")
        summary = signals.operational_summary(self.db, sources=[self.doc])
        self.assertEqual(summary["routeTransitions24Hours"], {
            "recoveries": 1, "failures": 2, "changes": 1,
            "lastOutcome": "changed",
            "lastOccurredAt": datetime.fromisoformat(history[-1]["occurred_at"]).isoformat(),
        })
        serialized = json.dumps(summary)
        self.assertNotIn(self.doc["id"], serialized)
        self.assertNotIn("private route detail", serialized)

    def test_route_recovery_measurement_persists_latency_and_total_attempts(self):
        html = b"<html><main><p>" + (b"Nebius official infrastructure update. " * 5) + b"</p></main></html>"

        def timeout(*_args):
            raise TimeoutError("private route detail")

        with patch.object(signals, "stamp", side_effect=[
            "2026-09-25T10:00:00+00:00",
            "2026-09-25T10:01:00+00:00",
            "2026-09-25T10:02:00+00:00",
            "2026-09-25T10:05:00+00:00",
        ]):
            signals.check(self.db, self.doc, self.tickers, lambda *_: {"body": html})
            signals.check(self.db, self.doc, self.tickers, timeout)
            signals.check(self.db, self.doc, self.tickers, timeout)
            signals.check(self.db, self.doc, self.tickers, lambda *_: {"body": html})

        route = self.db.execute(
            "SELECT error,failure_started_at,failure_attempts FROM signal_routes WHERE id=?",
            (self.doc["id"],),
        ).fetchone()
        self.assertIsNone(route["error"])
        self.assertIsNone(route["failure_started_at"])
        self.assertEqual(route["failure_attempts"], 0)
        recovery = self.db.execute(
            "SELECT failed_at,recovered_at,attempts,error_kind FROM signal_route_recoveries"
        ).fetchone()
        self.assertEqual(dict(recovery), {
            "failed_at": "2026-09-25T10:01:00+00:00",
            "recovered_at": "2026-09-25T10:05:00+00:00",
            "attempts": 3,
            "error_kind": "timeout",
        })
        self.db.execute("""INSERT INTO signal_route_recoveries(
          source_id,failed_at,recovered_at,attempts,error_kind) VALUES(?,?,?,?,?)""", (
            self.doc["id"], "2026-09-25T09:00:00", "2026-09-25T09:05:00", 2, "timeout",
        ))
        self.db.commit()
        self.db.close()
        self.db = monitor.connect(self.path)
        summary = signals.operational_summary(
            self.db, sources=[self.doc],
            reference=datetime(2026, 9, 25, 10, 6, tzinfo=timezone.utc),
        )
        self.assertEqual(summary["routeRecoveries24Hours"], {
            "count": 1,
            "latencyAverageMs": 240_000,
            "latencyMaxMs": 240_000,
            "attemptsAverage": 3.0,
            "attemptsMax": 3,
            "lastRecoveredAt": "2026-09-25T10:05:00+00:00",
        })
        serialized = json.dumps(summary)
        self.assertNotIn(self.doc["id"], serialized)
        self.assertNotIn("private route detail", serialized)

    def test_active_route_outages_report_only_bounded_aggregate_measurements(self):
        signals.schema(self.db)
        self.db.execute("""INSERT INTO signal_routes(
          id,initialized,checked_at,next_check_at,failures,error,
          failure_started_at,failure_attempts) VALUES(?,1,?,?,?,?,?,?)""", (
            self.doc["id"], "2026-09-25T10:03:00+00:00",
            "2026-09-25T10:10:00+00:00", 3, "timeout",
            "2026-09-25T10:01:00+00:00", 3,
        ))
        second = {
            **next(source for source in signals.SOURCES
                   if source["id"] == "nvidia-developer"),
            "id": "private-unmeasured-route",
        }
        self.db.execute("""INSERT INTO signal_routes(
          id,initialized,checked_at,next_check_at,failures,error,
          failure_started_at,failure_attempts) VALUES(?,1,?,?,?,?,?,?)""", (
            second["id"], "2026-09-25T10:03:00+00:00",
            "2026-09-25T10:10:00+00:00", 1, "http-403", None, 0,
        ))
        self.db.commit()
        summary = signals.operational_summary(
            self.db, sources=[self.doc, second],
            reference=datetime(2026, 9, 25, 10, 6, tzinfo=timezone.utc),
        )
        self.assertEqual(summary["routes"]["activeOutages"], {
            "measured": 1,
            "unmeasured": 1,
            "ageMaxMs": 300_000,
            "attemptsAverage": 3.0,
            "attemptsMax": 3,
            "oldestStartedAt": "2026-09-25T10:01:00+00:00",
            "byErrorKind": {
                "timeout": {
                    "measured": 1, "unmeasured": 0, "ageMaxMs": 300_000,
                    "attemptsAverage": 3.0, "attemptsMax": 3,
                    "oldestStartedAt": "2026-09-25T10:01:00+00:00",
                },
                "accessRestricted": {
                    "measured": 0, "unmeasured": 1, "ageMaxMs": None,
                    "attemptsAverage": None, "attemptsMax": None,
                    "oldestStartedAt": None,
                },
            },
        })
        serialized = json.dumps(summary)
        self.assertNotIn(self.doc["id"], serialized)
        self.assertNotIn(second["id"], serialized)

    def test_route_recovery_measurement_migrates_an_existing_failure(self):
        self.db.execute("""CREATE TABLE signal_routes (
          id TEXT PRIMARY KEY, initialized INTEGER NOT NULL DEFAULT 0,
          checked_at TEXT, succeeded_at TEXT, next_check_at TEXT,
          failures INTEGER NOT NULL DEFAULT 0, error TEXT, etag TEXT, last_modified TEXT,
          config_sha TEXT, last_duration_ms INTEGER, matched_items INTEGER NOT NULL DEFAULT 0
        )""")
        self.db.execute("""INSERT INTO signal_routes(
          id,initialized,checked_at,failures,error) VALUES(?,1,?,2,'timeout')""", (
            self.doc["id"], "2026-09-25T10:01:00+00:00",
        ))
        self.db.commit()
        html = b"<html><main><p>" + (b"Nebius official infrastructure update. " * 5) + b"</p></main></html>"
        with patch.object(signals, "stamp", return_value="2026-09-25T10:05:00+00:00"):
            result = signals.check(
                self.db, self.doc, self.tickers, lambda *_: {"body": html},
            )
        self.assertEqual(result["status"], "ok")
        recovery = self.db.execute(
            "SELECT failed_at,recovered_at,attempts FROM signal_route_recoveries"
        ).fetchone()
        self.assertEqual(dict(recovery), {
            "failed_at": "2026-09-25T10:01:00+00:00",
            "recovered_at": "2026-09-25T10:05:00+00:00",
            "attempts": 3,
        })

    def test_persisted_validators_and_304(self):
        self.check_feed(feed(), etag='"v1"')
        self.db.close()
        self.db = monitor.connect(self.path)
        def unchanged(source, validators):
            self.assertEqual(validators["etag"], '"v1"')
            return {"not_modified": True}
        result = signals.check(self.db, self.feed, self.tickers, unchanged)
        self.assertEqual(result["status"], "unchanged")
        self.assertEqual(signals.queue(self.db)["counts"]["all"], 1)

    def test_configuration_change_invalidates_validators(self):
        self.check_feed(feed(), etag='"v1"')
        def changed_config(source, validators):
            self.assertEqual(validators, {})
            return {"body": feed(body="Micron launches a memory product.")}
        signals.check(self.db, self.feed, ["MU"], changed_config)
        self.assertEqual(signals.queue(self.db, ticker="MU")["items"][0]["eventKind"], "baseline")

    def test_failed_initial_fetch_does_not_establish_baseline_and_retries_back_off(self):
        def failure(*_):
            raise HTTPError(self.feed["url"], 429, "limit", {"Retry-After": "900"}, None)
        with patch.object(signals, "stamp", return_value="2026-09-25T10:00:00+00:00"):
            result = signals.check(self.db, self.feed, self.tickers, failure)
        self.assertEqual(result["error"], "http-429")
        route = self.db.execute(
            "SELECT next_check_at FROM signal_routes WHERE id=?", (self.feed["id"],)
        ).fetchone()
        self.assertEqual(route["next_check_at"], "2026-09-25T10:15:00+00:00")
        with patch.object(signals, "stamp", return_value="2026-09-25T10:01:00+00:00"):
            self.assertEqual(signals.due(self.db, [self.feed]), [])
        self.check_feed(feed())
        self.assertEqual(signals.queue(self.db)["counts"]["baseline"], 1)
        self.assertIsNone(signals.queue(self.db)["routes"][0]["error"])

    def test_top_level_access_restriction_uses_shared_long_backoff(self):
        def failure(*_):
            raise HTTPError(self.feed["url"], 403, "forbidden", {}, None)
        with patch.object(signals, "stamp", return_value="2026-09-25T10:00:00+00:00"):
            result = signals.check(self.db, self.feed, self.tickers, failure)
        self.assertEqual(result["error"], "http-403")
        route = self.db.execute(
            "SELECT next_check_at,failures,error FROM signal_routes WHERE id=?", (self.feed["id"],)
        ).fetchone()
        self.assertEqual(route["next_check_at"], "2026-09-25T16:00:00+00:00")
        self.assertEqual(route["failures"], 1)
        self.assertEqual(route["error"], "http-403")

    def test_x_api_attempt_budget_is_persistent_bounded_and_redacted(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120}
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {
            "X_API_ENABLED": "true", "X_BEARER_TOKEN": "secret-token",
            "X_API_DAILY_REQUEST_LIMIT": "2",
        }, clear=False):
            first = signals.reserve_x_api_request(self.db, source, now)
            second = signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12))
            self.assertEqual(first["attemptsLast24Hours"], 1)
            self.assertEqual(second["attemptsLast24Hours"], 2)
            with self.assertRaises(signals.XApiDailyLimit) as blocked:
                signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12, minutes=1))
            self.assertEqual(blocked.exception.retry_at, "2026-09-26T01:00:00+00:00")
            self.db.executemany(
                "INSERT INTO signal_x_request_attempts(source_id,attempted_at) VALUES('x-test',?)",
                [("not-a-time",), ((now + timedelta(days=30)).isoformat(),)],
            )
            self.db.commit()
            usage = signals.x_api_usage(self.db, now + timedelta(hours=12, minutes=1), sources=[])
            self.assertEqual(usage["attemptsLast24Hours"], 2)
            self.assertNotIn("token", json.dumps(usage).lower())

    def test_x_api_plan_exposes_only_bounded_aggregate_demand(self):
        sources = [
            {"id": "x-fast", "format": "x-api", "intervalSeconds": 120,
             "query": "secret-query", "url": "https://example.invalid"},
            {"id": "x-slow", "format": "x-api", "intervalSeconds": 3600},
            {"id": "free", "format": "rss", "intervalSeconds": 5},
        ]
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "100"}, clear=False):
            plan = signals.x_api_request_plan(sources)
        self.assertEqual(plan["sourceCount"], 2)
        self.assertEqual(plan["scope"], "analyst-price-target-or-earnings")
        self.assertEqual(plan["configuredMaxRequestsPerDay"], 744)
        self.assertEqual(plan["localMaxRequestsPerDay"], 100)
        self.assertTrue(plan["budgetCapped"])
        self.assertEqual(plan["minimumSpacingSeconds"], 864)
        self.assertEqual(plan["minimumSourceSpacingSeconds"], 1728)
        serialized = json.dumps(plan)
        self.assertNotIn("secret-query", serialized)
        self.assertNotIn("example.invalid", serialized)

    def test_mu_earnings_window_increases_polling_only_during_release(self):
        sources = [source for source in signals.SOURCES if source.get("format") == "x-api"]
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "2300"}):
            plan = signals.x_api_request_plan(sources)
        self.assertEqual(plan["configuredMaxRequestsPerDay"], 4320)
        self.assertTrue(plan["budgetCapped"])
        self.assertTrue(plan["pacingEnabled"])
        source = sources[0]
        for moment, expected in [
            ("2026-09-30T19:29:59+00:00", 60),
            ("2026-09-30T19:30:00+00:00", 60),
            ("2026-09-30T20:49:59+00:00", 60),
            ("2026-09-30T20:50:00+00:00", 60),
        ]:
            with self.subTest(moment=moment):
                self.assertEqual(
                    signals.source_interval_seconds(source, datetime.fromisoformat(moment)),
                    expected,
                )
        with patch.object(signals, "stamp", return_value="2026-09-30T19:35:00+00:00"):
            signals.check(self.db, source, self.tickers, lambda *_: {"_items": []})
        next_at = self.db.execute(
            "SELECT next_check_at FROM signal_routes WHERE id=?", (source["id"],)
        ).fetchone()[0]
        self.assertEqual(next_at, "2026-09-30T19:36:00+00:00")

    def test_x_interval_change_keeps_existing_baseline_and_target_filter(self):
        source = next(item for item in signals.SOURCES if item["id"] == "x-tipranks")
        signals.schema(self.db)
        with self.db:
            self.db.execute("INSERT INTO signal_routes(id,initialized,config_sha) VALUES(?,1,?)",
                            (source["id"], signals.legacy_x_fingerprint(source, self.tickers)))
        item = {"url": "https://x.com/TipRanks/status/1234567890",
                "title": "$AMD price target raised to $720 from $620 at BofA",
                "text": "$AMD price target raised to $720 from $620 at BofA",
                "matches": {"AMD": ["$AMD"]}, "publishedAt": "2026-09-25T10:50:28Z", "truncated": False}
        signals.save(self.db, source, [item], {}, signals.stamp(),
                     signals.fingerprint(source, self.tickers), 1)
        queue = signals.queue(self.db, view="targets")
        self.assertEqual(queue["counts"]["targets"], 1)
        self.assertEqual(queue["items"][0]["eventKind"], "new")

    def test_x_api_budget_is_evenly_paced_and_rotates_due_sources(self):
        sources = [
            {"id": source_id, "format": "x-api", "intervalSeconds": 120}
            for source_id in ("x-a", "x-b", "x-c")
        ]
        due_ids = [source["id"] for source in sources]
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "100"}, clear=False), \
                patch.object(signals, "SOURCES", sources):
            first = signals.reserve_x_api_request(
                self.db, sources[0], now, eligible_source_ids=due_ids
            )
            self.assertEqual(first["pacedUntil"], "2026-09-25T01:14:24+00:00")
            with self.assertRaises(signals.XApiPacing) as early:
                signals.reserve_x_api_request(
                    self.db, sources[1], now + timedelta(minutes=1), eligible_source_ids=due_ids
                )
            self.assertEqual(early.exception.retry_at, "2026-09-25T01:14:24+00:00")
            with self.assertRaises(signals.XApiPacing):
                signals.reserve_x_api_request(
                    self.db, sources[0], now + timedelta(seconds=864), eligible_source_ids=due_ids
                )
            signals.reserve_x_api_request(
                self.db, sources[1], now + timedelta(seconds=864), eligible_source_ids=due_ids
            )
            signals.reserve_x_api_request(
                self.db, sources[2], now + timedelta(seconds=1728), eligible_source_ids=due_ids
            )
        attempts = [row["source_id"] for row in self.db.execute(
            "SELECT source_id FROM signal_x_request_attempts ORDER BY attempted_at"
        )]
        self.assertEqual(attempts, ["x-a", "x-b", "x-c"])

    def test_x_api_rolling_window_excludes_exactly_twenty_four_hours_old_attempt(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120}
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "2"}, clear=False):
            signals.reserve_x_api_request(self.db, source, now)
            signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12))
            usage = signals.reserve_x_api_request(self.db, source, now + timedelta(hours=24))
        self.assertEqual(usage["attemptsLast24Hours"], 2)

    def test_x_api_budget_block_sets_next_check_without_transport(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120,
                  "name": "X test", "kind": "publisher-update", "reuse": "review-required"}
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "1"}, clear=False):
            signals.reserve_x_api_request(self.db, source)
            usage = signals.x_api_usage(self.db)
            result = signals.check(
                self.db, source, self.tickers,
                lambda *_: (_ for _ in ()).throw(signals.XApiDailyLimit(usage["nextAvailableAt"])),
            )
        self.assertEqual(result["error"], "x-api-daily-limit")
        route = self.db.execute("SELECT next_check_at FROM signal_routes WHERE id='x-test'").fetchone()
        self.assertEqual(route["next_check_at"], usage["nextAvailableAt"])

    def test_signal_worker_reserves_x_budget_before_network(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120,
                  "name": "X test", "kind": "publisher-update", "reuse": "review-required"}
        self.db.close()
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "1"}, clear=False):
            with monitor.connect(self.path) as db:
                signals.reserve_x_api_request(db, source)
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
            with patch.object(signals, "acquire") as acquire:
                app.check_signal_source(source)
                acquire.assert_not_called()
            with monitor.connect(self.path) as db:
                route = db.execute(
                    "SELECT error,next_check_at FROM signal_routes WHERE id='x-test'"
                ).fetchone()
                usage = signals.x_api_usage(db)
        self.db = monitor.connect(self.path)
        self.assertEqual(route["error"], "x-api-daily-limit")
        self.assertEqual(route["next_check_at"], usage["nextAvailableAt"])
        self.assertEqual(usage["attemptsLast24Hours"], 1)

    def test_invalid_xml_is_not_a_successful_empty_feed(self):
        result = self.check_feed(b"<rss><channel><item>")
        self.assertEqual(result["status"], "error")
        self.assertEqual(signals.queue(self.db)["counts"]["all"], 0)

    def test_atom_feeds_and_no_match_are_valid(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Memory systems</title>
        <link rel="alternate" href="https://newsletter.semianalysis.com/p/atom"/>
        <published>2026-09-23T12:00:00Z</published><content type="html">Micron and NVIDIA.</content></entry></feed>'''
        self.assertEqual(set(signals.parse(self.feed, atom, self.tickers)[0]["matches"]), {"MU", "NVDA"})
        self.assertEqual(self.check_feed(feed(body="An unrelated travel update."))["matchedItems"], 0)

    def test_untrusted_urls_entities_and_tracking_variants(self):
        for url in ["http://newsletter.semianalysis.com/p/a", "https://127.0.0.1/", "https://user:password@newsletter.semianalysis.com/p/a", "https://newsletter.semianalysis.com.evil.test/a"]:
            with self.assertRaises(ValueError): signals.safe_url(url, self.feed)
            self.assertEqual(signals.parse(self.feed, feed(url=url), self.tickers), [])
        self.assertEqual(signals.safe_url("https://newsletter.semianalysis.com/p/a?utm_source=x#top", self.feed), "https://newsletter.semianalysis.com/p/a")
        with self.assertRaisesRegex(ValueError, "unsafe-signal-xml"):
            signals.parse(self.feed, b'<!DOCTYPE rss [<!ENTITY a "boom">]><rss/>', self.tickers)

    def test_editor_auth_and_no_public_snapshot_leak(self):
        self.check_feed(feed())
        app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        token = "editor-token-at-least-24-characters"
        try:
            url = f"http://127.0.0.1:{server.server_port}/admin/signals"
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": token}):
                with self.assertRaises(HTTPError) as failed:
                    urlopen(url)
                self.assertEqual(failed.exception.code, 401)
                with urlopen(Request(url, headers={"Authorization": "Bearer " + token})) as response:
                    payload = json.load(response)
                self.assertEqual(payload["items"][0]["tickers"], ["CRWV", "NBIS"])
                self.assertFalse(payload["publicationEnabled"])
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": ""}):
                with self.assertRaises(HTTPError):
                    urlopen(Request(url, headers={"Authorization": "Bearer " + token}))
            self.assertNotIn("ClusterMAX", json.dumps(monitor.snapshot(self.db)))
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_html_index_body_matching_and_unassigned_articles(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<main><a href="/news/test">Infrastructure update</a><a href="/root-article" class="FeaturedGrid-module__content">Other</a><a href="https://evil.test/news/a">No</a></main>'}
            text = ("Nebius and NVIDIA collaborate on infrastructure. " if route["url"].endswith("test")
                    else "A new model evaluation method is available. ") * 6
            return {"body": ('<html><nav>Micron</nav><main><h1>Infrastructure update</h1><p>' + text + '</p></main></html>').encode(), "etag": '"v1"'}
        with patch.object(signals, "fetch", side_effect=request) as fetched:
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result["events"], 2)
        self.assertEqual(fetched.call_count, 3)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue["counts"]["baseline"], 2)
        assigned = next(item for item in queue["items"] if item["tickers"])
        self.assertEqual(assigned["tickers"], ["NBIS", "NVDA"])
        self.assertIsNone(assigned["publishedAt"])
        self.assertTrue(any(not item["tickers"] for item in queue["items"]))

    def test_html_index_deferred_baselines_restart_and_new_arrivals(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        urls = [f"/news/item-{i}" for i in range(5)]
        calls = []
        def request(route, validators):
            calls.append(route["url"])
            if route["url"] == source["url"]:
                return {"body": ''.join(f'<a href="{url}">Article</a>' for url in urls).encode()}
            return {"body": ('<main><h1>Example</h1><p>' + 'Nebius builds infrastructure. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])["routes"][0]["pendingArticles"], 2)
            self.db.close()
            self.db = monitor.connect(self.path)
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])["counts"]["baseline"], 5)
            urls.insert(0, '/news/new')
            signals.check(self.db, source, self.tickers)
        self.assertEqual(signals.queue(self.db, sources=[source])["counts"]["new"], 1)
        self.assertEqual(calls.count(source["url"] + '/item-0'), 1)

    def test_html_index_article_errors_remain_visible_and_retry_as_baseline(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            raise HTTPError(route["url"], 403, "forbidden", {}, None)
        with patch.object(signals, "fetch", side_effect=request), \
                patch.object(signals, "stamp", return_value="2026-09-25T10:00:00+00:00"):
            signals.check(self.db, source, self.tickers)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue["routes"][0]["error"], "article-fetch-failed:1")
        self.assertEqual(queue["routes"][0]["pendingArticles"], 1)
        self.assertEqual(queue["counts"]["all"], 0)
        state = json.loads(self.db.execute("SELECT body FROM signal_index_state").fetchone()[0])
        child = state['children'][source['url'] + '/test']
        self.assertTrue(child['baseline'])
        self.assertEqual(child['error'], 'http-403')
        self.assertEqual(queue['routes'][0]['articleErrors'][0]['url'], source['url'] + '/test')
        self.assertEqual(queue['routes'][0]['articleErrors'][0]['error'], 'http-403')
        self.assertEqual(
            queue['routes'][0]['articleErrors'][0]['nextCheckAt'],
            '2026-09-25T16:00:00+00:00',
        )

    def test_html_article_recovery_measurement_survives_restart_without_url(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        failing = True

        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            if failing:
                raise TimeoutError("private transport detail")
            return {"body": (
                '<main><h1>Official update</h1><p>'
                + 'Nebius builds reliable infrastructure. ' * 10
                + '</p></main>'
            ).encode()}

        with patch.object(signals, "fetch", side_effect=request), \
                patch.object(signals, "stamp", return_value="2026-09-25T10:00:00+00:00"):
            signals.check(self.db, source, self.tickers)
        state = json.loads(self.db.execute(
            "SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)
        ).fetchone()[0])
        child = state["children"][source["url"] + "/test"]
        self.assertIsNotNone(datetime.fromisoformat(child["first_failed_at"]).tzinfo)
        self.assertEqual(child["failure_attempts"], 1)
        failed_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        child["first_failed_at"] = failed_at
        child["next_check"] = ""
        self.db.execute(
            "UPDATE signal_index_state SET body=? WHERE source_id=?",
            (json.dumps(state), source["id"]),
        )
        self.db.commit()

        failing = False
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
        self.db.close()
        self.db = monitor.connect(self.path)
        state = json.loads(self.db.execute(
            "SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)
        ).fetchone()[0])
        self.assertEqual(len(state["recoveries"]), 1)
        recovery = state["recoveries"][0]
        self.assertEqual(recovery["failedAt"], failed_at)
        self.assertEqual(recovery["attempts"], 2)
        self.assertEqual(recovery["errorKind"], "timeout")
        self.assertNotIn(source["url"], json.dumps(state["recoveries"]))
        recovered_at = datetime.fromisoformat(recovery["recoveredAt"])
        expected_latency = round(
            (recovered_at - datetime.fromisoformat(failed_at)).total_seconds() * 1000
        )
        summary = signals.operational_summary(
            self.db, sources=[source],
            reference=datetime.now(timezone.utc) + timedelta(minutes=1),
        )
        self.assertEqual(summary["articleRetrieval"]["recoveries24Hours"], {
            "count": 1,
            "latencyAverageMs": expected_latency,
            "latencyMaxMs": expected_latency,
            "attemptsAverage": 2.0,
            "attemptsMax": 2,
            "lastRecoveredAt": recovered_at.isoformat(),
        })

    def test_html_article_retry_after_is_honored_without_retaining_header(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            raise HTTPError(route["url"], 429, "limited", {"Retry-After": "172800"}, None)
        with patch.object(signals, "fetch", side_effect=request), \
                patch.object(signals, "stamp", return_value="2026-09-25T10:00:00+00:00"):
            signals.check(self.db, source, self.tickers)
        state = json.loads(self.db.execute("SELECT body FROM signal_index_state").fetchone()[0])
        child = state["children"][source["url"] + "/test"]
        self.assertEqual(child["error"], "http-429")
        self.assertEqual(child["next_check"], "2026-09-27T10:00:00+00:00")
        self.assertNotIn("172800", json.dumps(signals.queue(self.db, sources=[source])))

    def test_html_index_unchanged_index_still_rechecks_article_changes(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        version = 'v1'
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            return {"body": ('<main><h1>Example</h1><p>' + 'Nebius builds infrastructure. ' * 10 + version + '</p></main>').encode()}
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
            state = json.loads(self.db.execute("SELECT body FROM signal_index_state").fetchone()[0])
            state['children'][source['url'] + '/test']['next_check'] = ''
            self.db.execute("UPDATE signal_index_state SET body=?", (json.dumps(state),))
            self.db.commit()
            version = 'v2'
            signals.check(self.db, source, self.tickers)
        queue = signals.queue(self.db, sources=[source], view='changed')
        self.assertEqual(len(queue['items']), 1)
        self.assertIn('v2', queue['items'][0]['diff'])

    def test_html_index_empty_shell_is_not_healthy(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        with patch.object(signals, "fetch", return_value={"body": b'<main>Enable JavaScript</main>'}):
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(signals.queue(self.db, sources=[source])['counts']['all'], 0)

    def test_public_next_listing_discovers_body_without_article_anchors(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'nebius-blog')
        payload = {'props': {'pageProps': {'initialListing': {'items': [
            {'url': '/blog/posts/platinum'}, {'url': 'https://evil.test/blog/posts/trap'}]}}}}
        requested = []
        def request(route, validators):
            requested.append(route['url'])
            if route['url'] == source['url']:
                return {'body': ('<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + '</script>').encode()}
            return {'body': ('<main><h1>Platinum rating</h1><p>' + 'We improved cluster reliability. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        self.assertEqual(len(requested), 2)
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['tickers'], ['NBIS'])
        self.assertEqual(item['eventKind'], 'baseline')
        self.assertIsNone(item['publishedAt'])

    def test_palantir_sitemap_extracts_only_english_shareholder_letter_next_data(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'palantir-shareholder-letters')
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.palantir.com/q2-2026-letter/</loc></url>
          <url><loc>https://www.palantir.com/q2-2026-letter/fr/</loc></url>
          <url><loc>https://www.palantir.com/q2-2026-letter/en/</loc></url>
          <url><loc>https://www.palantir.com/newsroom/media/not-a-letter/</loc></url>
          <url><loc>https://evil.test/q2-2026-letter/en/</loc></url>
        </urlset>'''
        payload = {'props': {'pageProps': {'page': {'fields': {
            'pageTitle': 'Q2 2026 | Letter to Shareholders',
            'blocks': [{'fields': {'text': {'nodeType': 'document', 'content': [
                {'nodeType': 'paragraph', 'content': [
                    {'nodeType': 'text', 'value': 'August 3, 2026', 'marks': [], 'data': {}}]},
                {'nodeType': 'paragraph', 'content': [
                    {'nodeType': 'text', 'value': 'Our revenue grew as customers adopted the Artificial Intelligence Platform. ' * 4,
                     'marks': [], 'data': {}}]},
            ]}}, 'sys': {'createdAt': 'do-not-extract'}}],
        }}}}}
        requested = []
        def request(route, validators):
            requested.append(route['url'])
            if route['url'] == source['url']:
                return {'body': sitemap}
            return {'body': ('<script id="__NEXT_DATA__" type="application/json">'
                             + json.dumps(payload) + '</script>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        self.assertEqual(requested, [source['url'], 'https://www.palantir.com/q2-2026-letter/en/'])
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['title'], 'Q2 2026 | Letter to Shareholders')
        self.assertEqual(item['tickers'], ['PLTR'])
        self.assertEqual(item['publishedOn'], '2026-08-03')
        self.assertIsNone(item['publishedAt'])
        self.assertIn('August 3, 2026', item['excerpt'])
        self.assertNotIn('do-not-extract', item['excerpt'])

    def test_next_data_rich_text_rejects_excessive_nesting(self):
        import html_signals
        nested = {'nodeType': 'text', 'value': 'evidence'}
        for _ in range(21):
            nested = {'content': [nested]}
        with self.assertRaisesRegex(ValueError, 'signal-article-next-data-limit'):
            html_signals.rich_text(nested)

    def test_visible_article_date_rejects_impossible_calendar_date(self):
        import html_signals
        with self.assertRaisesRegex(ValueError, 'signal-article-published-date'):
            html_signals.visible_date(
                'February 30, 2026', r'\b[A-Z][a-z]+ [0-9]{1,2}, 20[0-9]{2}\b', '%B %d, %Y'
            )

    def test_signal_schema_migrates_date_only_publication_column(self):
        self.db.execute('''CREATE TABLE signal_events (
          id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
          sha TEXT NOT NULL, previous_sha TEXT, title TEXT NOT NULL,
          tickers_json TEXT NOT NULL, matches_json TEXT NOT NULL,
          event_kind TEXT NOT NULL, published_at TEXT, observed_at TEXT NOT NULL,
          excerpt TEXT NOT NULL, diff TEXT NOT NULL, truncated INTEGER NOT NULL,
          UNIQUE(source_id,url,sha,previous_sha)
        )''')
        signals.schema(self.db)
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(signal_events)')}
        self.assertIn('published_on', columns)

    def test_specific_article_body_excludes_related_stories_and_duplicate_title(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'coreweave-blog')
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': b'<a href="/blog/example">Read</a>'}
            return {'body': ('<main><h1>Storage update</h1><article><div class="article-content-container w-richtext"><p>'
                             + 'We improved archive storage. ' * 10
                             + '</p></div></article><h1>Storage update</h1><aside>NVIDIA and Micron related stories</aside></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['title'], 'Storage update')
        self.assertEqual(item['tickers'], ['CRWV'])
        self.assertNotIn('related stories', item['excerpt'])

    def test_new_article_retry_precedes_baseline_backlog_and_respects_backoff(self):
        from html_signals import collect
        source = next(s for s in signals.SOURCES if s['id'] == 'anthropic-news')
        base = source['url'] + '/'
        children = {base + f'old-{i}': {'baseline': True} for i in range(8)}
        for i in range(4):
            children[base + f'new-{i}'] = {
                'baseline': False, 'checked': '2026-01-01T00:00:00.000+00:00',
                'next_check': '', 'failures': 1, 'error': 'http-503'}
        children[base + 'new-3']['next_check'] = '2099-01-01T00:00:00.000+00:00'
        calls = []
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': ''.join(f'<a href="{url}">Story</a>' for url in children).encode()}
            calls.append(route['url'])
            return {'body': ('<main><h1>Infrastructure</h1><p>'
                             + 'Nebius infrastructure update. ' * 10 + '</p></main>').encode()}
        response = collect(source, {'index_state': json.dumps({
            'initialized': True, 'children': children})}, self.tickers, request)
        self.assertEqual(calls, [base + 'new-0', base + 'new-1', base + 'old-0'])
        self.assertEqual([item['baseline'] for item in response['_items']], [False, False, True])
        state = json.loads(response['index_state'])
        calls.clear()
        collect(source, {'index_state': json.dumps(state)}, self.tickers, request)
        self.assertEqual(calls, [base + 'new-2', base + 'old-1', base + 'old-2'])
        self.assertNotIn(base + 'new-3', calls)

    def test_due_failed_baseline_retries_without_starving_history(self):
        from html_signals import collect
        source = next(s for s in signals.SOURCES if s['id'] == 'anthropic-news')
        base = source['url'] + '/'
        children = {base + f'old-{i}': {'baseline': True} for i in range(6)}
        children[base + 'failed'] = {
            'baseline': True, 'checked': '2026-09-25T10:00:00+00:00',
            'next_check': '', 'failures': 1, 'error': 'http-503',
        }
        calls = []

        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': ''.join(
                    f'<a href="{url}">Story</a>' for url in children
                ).encode()}
            calls.append(route['url'])
            return {'body': ('<main><h1>Infrastructure</h1><p>'
                             + 'Nebius infrastructure update. ' * 10
                             + '</p></main>').encode()}

        collect(source, {'index_state': json.dumps({
            'initialized': True, 'children': children,
        })}, self.tickers, request)
        self.assertEqual(calls, [base + 'failed', base + 'old-0', base + 'old-1'])

    def test_sitemap_baselines_survive_restart_and_new_url_is_prioritized(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'micron-blog')
        urls = [f'https://www.micron.com/about/blog/memory/dram/article-{i}' for i in range(130)]
        urls += ['https://www.micron.com/about/blog/blog-authors/author-bio/person',
                 'https://www.micron.com/about/blog/memory/dram',
                 'https://evil.test/about/blog/memory/dram/attack']
        calls = []
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                 + ''.join(f'<url><loc>{u}</loc></url>' for u in urls) + '</urlset>').encode()}
            calls.append(route['url'])
            return {'body': ('<main><h1>Memory update</h1><p>' + 'Micron memory innovation. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])['routes'][0]['pendingArticles'], 127)
            self.db.close(); self.db = monitor.connect(self.path)
            urls.append('https://www.micron.com/about/blog/memory/dram/new-arrival')
            calls.clear()
            signals.check(self.db, source, self.tickers)
        self.assertTrue(calls[0].endswith('/new-arrival'))
        self.assertEqual(len(calls), 3)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue['counts']['baseline'], 5)
        self.assertEqual(queue['counts']['new'], 1)

    def test_sitemap_rejects_entities_and_nested_sitemaps(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'micron-blog')
        for body in [b'<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset/>',
                     b'<sitemapindex><sitemap><loc>https://evil.test/a.xml</loc></sitemap></sitemapindex>']:
            with patch.object(signals, 'fetch', return_value={'body': body}):
                self.assertEqual(signals.check(self.db, source, self.tickers)['status'], 'error')
        self.assertEqual(signals.queue(self.db, sources=[source])['counts']['all'], 0)

    def test_specific_title_skips_generic_site_heading(self):
        from html_signals import NewsHTML
        parser = NewsHTML('article-body', 'story-title')
        parser.feed('<h1>All blogs</h1><h1 class="story-title">New chips</h1>'
                    '<div class="article-body"><p>New memory platform</p></div><aside>NVIDIA</aside>')
        self.assertEqual(parser.title, ['New chips'])
        self.assertNotIn('NVIDIA', ''.join(parser.selected))

    def test_long_article_is_bounded_and_flagged_instead_of_retried_forever(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'anthropic-news')
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': b'<a href="/news/long-report">Report</a>'}
            return {'body': ('<main><h1>Long report</h1><p>' + 'Nebius infrastructure. ' * 10000
                             + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result['status'], 'ok')
        queue = signals.queue(self.db, sources=[source])
        self.assertTrue(queue['items'][0]['truncated'])
        self.assertEqual(queue['routes'][0]['articleErrors'], [])
        self.assertEqual(queue['routes'][0]['pendingArticles'], 0)

    def test_worker_is_opt_in_and_stops(self):
        with patch.dict(os.environ, {"RESEARCH_SIGNALS_ENABLED": ""}):
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        with patch.object(signals, "fetch") as fetch:
            app.run_signals()
            fetch.assert_not_called()
        with patch.dict(os.environ, {"RESEARCH_SIGNALS_ENABLED": "1"}):
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        def fetch(*_):
            app.stop_event.set()
            return {"body": feed()}
        with patch.object(signals, "fetch", side_effect=fetch):
            app.run_signals()
        self.assertEqual(app.signal_queue()["counts"]["baseline"], 1)


if __name__ == "__main__":
    unittest.main()
