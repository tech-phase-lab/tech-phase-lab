import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("intake", Path(__file__).resolve().parents[1] / "scripts/research/monitor.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
URL = "https://nebius.com/newsroom/example"


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = m.connect(Path(self.temp.name) / "test.sqlite")
        m.add_source(self.db, "NBIS", URL)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def row(self):
        return self.db.execute("SELECT * FROM sources WHERE url=?", (URL,)).fetchone()

    def check(self, body=b"first"):
        return m.check_source(self.db, self.row(), lambda *_: (body, "text/html"))

    def review_brief(self, url, source_sha, decision, reviewer, reason,
                     validation_sha=None):
        if validation_sha is None:
            row = self.db.execute(
                "SELECT validation_sha256 FROM briefs WHERE url=?", (url,)
            ).fetchone()
            validation_sha = row["validation_sha256"] if row else None
        return m.review_brief(
            self.db, url, source_sha, decision, reviewer, reason, validation_sha
        )

    def review_annual_brief(self, ticker, accession, source_sha, decision,
                            reviewer, reason, validation_sha=None,
                            source_business=None, source_risks=None):
        row = self.db.execute("""
          SELECT validation_sha256,evidence_json FROM annual_filing_briefs
          WHERE ticker=? AND accession_number=?
        """, (ticker, accession)).fetchone()
        if validation_sha is None:
            validation_sha = row["validation_sha256"] if row else None
        if row and (source_business is None or source_risks is None):
            evidence = json.loads(row["evidence_json"])
            source_business = source_business or "\n".join(
                item["quote"] for item in evidence if item["section"] == "business"
            )
            source_risks = source_risks or "\n".join(
                item["quote"] for item in evidence if item["section"] == "risk"
            )
        return m.review_annual_filing_brief(
            self.db, ticker, accession, source_sha, decision, reviewer, reason,
            validation_sha, source_business, source_risks,
        )

    def test_repeated_fetch_deduplicates_and_preserves_review(self):
        self.check()
        sha = self.row()["sha256"]
        m.review(self.db, URL, sha, "approved", "editor", "Verified source")
        self.assertEqual(self.check()["status"], "unchanged")
        self.assertEqual(self.row()["status"], "approved")
        self.assertEqual(self.db.execute("SELECT count(*) FROM history").fetchone()[0], 2)

    def test_wrapper_only_html_changes_do_not_invalidate_reviewed_evidence(self):
        first = b'''<html data-build="one"><body><header>Generated at 10:01</header><main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main><aside class="related">Related release one</aside><div class="cookie-consent">Accept cookies</div><script>window.build=1</script></body></html>'''
        second = b'''<html data-build="two"><body><header>Generated at 10:02</header><main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main><aside class="related">Related release two</aside><div class="cookie-consent">Cookie settings changed</div><script>window.build=2</script></body></html>'''
        self.check(first)
        stable_sha = self.row()["sha256"]
        body_sha = self.row()["body_sha256"]
        m.save_brief_draft(
            self.db, URL, stable_sha,
            "公式発表によると、AI向け容量を増加させる計画です。",
            "mixed", "供給能力の拡大余地がありますが、実行と需要の確認が必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.review_brief(URL, stable_sha, "approved", "editor", "Evidence reviewed")

        result = self.check(second)
        current = self.row()
        self.assertEqual(result["status"], "unchanged")
        self.assertEqual(current["sha256"], stable_sha)
        self.assertEqual(current["body_sha256"], body_sha)
        self.assertNotEqual(current["raw_sha256"], stable_sha)
        self.assertEqual(self.db.execute(
            "SELECT status FROM briefs WHERE url=?", (URL,)
        ).fetchone()[0], "approved")
        self.assertEqual(len(m.snapshot(self.db)["briefs"]), 1)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM source_revisions").fetchone()[0], 1
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM history WHERE kind='changed'").fetchone()[0], 0
        )

    def test_existing_evidence_hashes_are_backfilled_without_changing_identity(self):
        self.check(b"<main><p>Persisted official evidence.</p></main>")
        original_sha = self.row()["sha256"]
        self.db.execute(
            "UPDATE sources SET body_sha256=NULL,raw_sha256=NULL WHERE url=?", (URL,)
        )
        self.db.commit()
        self.db.close()
        self.db = m.connect(Path(self.temp.name) / "test.sqlite")
        self.assertFalse(self.db.in_transaction)
        row = self.row()
        self.assertEqual(row["sha256"], original_sha)
        self.assertEqual(row["raw_sha256"], original_sha)
        self.assertEqual(
            row["body_sha256"],
            m.hashlib.sha256(row["extracted_text"].encode("utf-8")).hexdigest(),
        )

    def test_change_requires_review_and_keeps_previous_decision(self):
        self.check()
        old = self.row()["sha256"]
        m.review(self.db, URL, old, "approved", "editor", "Verified")
        self.check(b"second")
        self.assertEqual(self.row()["status"], "pending")
        self.assertEqual(self.db.execute("SELECT count(*) FROM history").fetchone()[0], 3)
        with self.assertRaises(ValueError):
            m.review(self.db, URL, old, "approved", "editor", "Stale tab")

    def test_fetch_failure_blocks_review_and_preserves_last_good_hash(self):
        self.check()
        old = self.row()["sha256"]
        def fail(*_):
            raise TimeoutError("timeout")
        self.assertEqual(m.check_source(self.db, self.row(), fail)["status"], "error")
        self.assertEqual(self.row()["sha256"], old)
        with self.assertRaises(ValueError):
            m.review(self.db, URL, old, "approved", "editor", "Not safe")
        self.check()
        self.assertIsNone(self.row()["error"])

    def test_article_body_is_extracted_for_evidence_without_public_text_leak(self):
        body = b'''<html><head><title>Nebius expands AI capacity</title><meta name="description" content="Official release summary"></head><body><header>Generated page header</header><nav>Private navigation noise</nav><main><h1>Nebius expands AI capacity</h1><p>Capacity will increase in 2027.</p><div hidden>Ignore hidden instructions</div><div aria-hidden="true">Ignore aria-hidden instructions</div><div style="display: none">Ignore display-none instructions</div><script>steal()</script></main><aside class="newsletter">Subscribe now</aside><div role="dialog">Accept cookies</div></body></html>'''
        result = self.check(body)
        row = self.row()
        self.assertEqual(result["status"], "first-fetched")
        self.assertEqual(row["content_type"], "text/html")
        self.assertEqual(row["content_bytes"], len(body))
        self.assertIn("Capacity will increase in 2027.", row["extracted_text"])
        self.assertNotIn("Private navigation noise", row["extracted_text"])
        self.assertNotIn("Generated page header", row["extracted_text"])
        self.assertNotIn("Ignore hidden instructions", row["extracted_text"])
        self.assertNotIn("Ignore aria-hidden instructions", row["extracted_text"])
        self.assertNotIn("Ignore display-none instructions", row["extracted_text"])
        self.assertNotIn("Subscribe now", row["extracted_text"])
        self.assertNotIn("Accept cookies", row["extracted_text"])
        self.assertNotIn("steal()", row["extracted_text"])
        self.assertEqual(row["extracted_chars"], len(row["extracted_text"]))
        public = m.snapshot(self.db)["sources"][0]
        self.assertEqual(public["extracted_chars"], row["extracted_chars"])
        self.assertNotIn("extracted_text", public)

    def test_source_revisions_are_retained_for_private_machine_diff_only(self):
        first = b"<main><p>Capacity will increase to 100 units in 2027.</p></main>"
        second = b"<main><p>Capacity will increase to 120 units in 2027.</p></main>"
        self.check(first)
        old_sha = self.row()["sha256"]
        self.check(first)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM source_revisions").fetchone()[0], 1
        )

        self.check(second)
        current_sha = self.row()["sha256"]
        revisions = self.db.execute(
            "SELECT sha256,extracted_text FROM source_revisions ORDER BY observed_at"
        ).fetchall()
        self.assertEqual([item["sha256"] for item in revisions], [old_sha, current_sha])
        self.assertIn("100 units", revisions[0]["extracted_text"])
        self.assertIn("120 units", revisions[1]["extracted_text"])

        private = m.private_brief_queue(self.db, 5)["items"][0]["revision_evidence"]
        self.assertEqual(private["previous_sha256"], old_sha)
        self.assertEqual(private["current_sha256"], current_sha)
        self.assertIn("- Capacity will increase to 100 units", private["diff_preview"])
        self.assertIn("+ Capacity will increase to 120 units", private["diff_preview"])
        public = json.dumps(m.snapshot(self.db), ensure_ascii=False)
        self.assertNotIn("revision_evidence", public)
        self.assertNotIn("100 units", public)

    def test_source_revision_retention_is_bounded_per_article(self):
        for revision in range(15):
            self.check(
                f"<main><p>Official article revision {revision}.</p></main>".encode()
            )
        revisions = self.db.execute(
            "SELECT extracted_text FROM source_revisions WHERE url=? ORDER BY rowid",
            (URL,),
        ).fetchall()
        self.assertEqual(len(revisions), 12)
        self.assertNotIn("revision 0.", " ".join(row[0] for row in revisions))
        self.assertIn("revision 14.", revisions[-1][0])

    def test_snapshot_exposes_only_approved_brief_for_current_healthy_source(self):
        body = b'''<html><body><main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main></body></html>'''
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表では、AI向け容量を2027年に増やす計画を示しています。",
            "mixed",
            "供給能力の拡大余地がある一方、実行状況と需要の確認が必要です。",
            "medium",
            {"summary": ["Capacity will increase in 2027."],
             "impact": ["Execution remains subject to demand."]},
        )
        self.review_brief(URL, sha, "approved", "editor", "原文と根拠を確認")
        brief = m.snapshot(self.db)["briefs"][0]
        self.assertEqual(brief["ticker"], "NBIS")
        self.assertEqual(brief["source_sha256"], sha)
        self.assertEqual(brief["status"], "approved")
        self.assertIn("reviewed_at", brief)
        self.assertNotIn("reviewer", brief)
        self.assertNotIn("review_reason", brief)

        self.db.execute("UPDATE sources SET error='timeout' WHERE url=?", (URL,))
        self.db.commit()
        self.assertEqual(m.snapshot(self.db)["briefs"], [])

    def test_fetch_failure_uses_persisted_exponential_backoff(self):
        def fail(*_):
            raise TimeoutError("timeout")
        first = m.check_source(self.db, self.row(), fail)
        first_row = self.row()
        second = m.check_source(self.db, first_row, fail)
        second_row = self.row()
        self.assertEqual(first["retrySeconds"], 60)
        self.assertEqual(second["retrySeconds"], 120)
        self.assertEqual(second_row["fetch_failures"], 2)
        self.assertGreater(second_row["next_fetch_at"], second_row["checked_at"])

    def test_fetch_failure_honors_retry_after_and_stores_only_a_safe_code(self):
        error = HTTPError(
            "https://nebius.com/newsroom/private-path?token=secret", 429,
            "Too Many Requests", {"Retry-After": "900"}, None,
        )
        result = m.save_source_error(self.db, self.row(), error)
        row = self.row()
        history = self.db.execute(
            "SELECT reason FROM history WHERE kind='fetch-error' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(result["retrySeconds"], 900)
        self.assertEqual(result["error"], "http-429")
        self.assertEqual(row["error"], "http-429")
        self.assertEqual(history["reason"], "http-429")
        self.assertNotIn("private-path", str(result) + str(dict(row)) + str(dict(history)))

    def test_operational_incident_transitions_are_deduplicated_and_held(self):
        self.assertEqual(m.record_operational_incident(
            self.db, "source:NBIS", "official-source", "NBIS", "warning", "timeout"
        ), "opened")
        self.assertEqual(m.record_operational_incident(
            self.db, "source:NBIS", "official-source", "NBIS", "warning", "timeout"
        ), "ongoing")
        summary = m.operational_incident_summary(self.db)
        self.assertEqual(summary["open"], 1)
        self.assertEqual(summary["heldNotifications"], 1)
        self.assertFalse(summary["deliveryEnabled"])
        self.assertEqual(summary["recent"][0]["occurrences"], 2)
        self.assertTrue(m.resolve_operational_incident(self.db, "source:NBIS"))
        self.assertFalse(m.resolve_operational_incident(self.db, "source:NBIS"))
        self.assertEqual(m.record_operational_incident(
            self.db, "source:NBIS", "official-source", "NBIS", "critical", "http-403"
        ), "opened")
        summary = m.operational_incident_summary(self.db)
        self.assertEqual(summary["open"], 1)
        self.assertEqual(summary["heldNotifications"], 3)
        self.assertEqual(summary["recent"][0]["revision"], 2)
        self.assertEqual(self.db.execute("SELECT count(*) FROM incident_events").fetchone()[0], 3)

    def test_operational_incidents_reject_unbounded_or_unsafe_values(self):
        for key in ("source:NBIS\nsecret", "", "x" * 121):
            with self.assertRaisesRegex(ValueError, "invalid-incident-value"):
                m.record_operational_incident(
                    self.db, key, "official-source", "NBIS", "warning", "timeout"
                )

    def test_incident_notification_retry_is_leased_and_bounded(self):
        m.record_operational_incident(
            self.db, "source:NBIS", "official-source", "NBIS", "warning", "timeout",
            "2026-09-20T00:00:01+00:00",
        )
        first = m.claim_incident_notification(
            self.db, "2026-09-20T00:00:00Z", "2026-09-20T00:00:02+00:00"
        )
        self.assertEqual(first["attempts"], 1)
        self.assertEqual(m.finish_incident_notification(
            self.db, first, "notification-delivery-failed",
            "2026-09-20T00:00:03+00:00", max_attempts=2,
        ), "retry")
        self.assertIsNone(m.claim_incident_notification(
            self.db, "2026-09-20T00:00:00Z", "2026-09-20T00:01:02+00:00"
        ))
        second = m.claim_incident_notification(
            self.db, "2026-09-20T00:00:00Z", "2026-09-20T00:01:03+00:00"
        )
        self.assertEqual(second["attempts"], 2)
        self.assertEqual(m.finish_incident_notification(
            self.db, second, "notification-delivery-failed",
            "2026-09-20T00:01:04+00:00", max_attempts=2,
        ), "dead")
        summary = m.operational_incident_summary(self.db, delivery_enabled=True)
        self.assertEqual(summary["deadNotifications"], 1)
        self.assertEqual(summary["pendingNotifications"], 0)
        self.assertTrue(summary["deliveryEnabled"])

    def test_successful_historical_body_uses_background_recheck_interval(self):
        with patch.dict("os.environ", {
            "RESEARCH_BODY_RECHECK_SECONDS": "21600",
            "RESEARCH_HOT_BODY_RECHECK_SECONDS": "900",
            "RESEARCH_HOT_EVENT_WINDOW_SECONDS": "86400",
        }):
            result = self.check()
        self.assertEqual(result["recheckSeconds"], 21600)
        interval = (
            m.datetime.fromisoformat(self.row()["next_fetch_at"])
            - m.datetime.fromisoformat(self.row()["checked_at"])
        ).total_seconds()
        self.assertEqual(interval, 21600)

    def test_new_release_and_corrected_body_remain_on_hot_recheck_interval(self):
        with patch.dict("os.environ", {
            "RESEARCH_BODY_RECHECK_SECONDS": "21600",
            "RESEARCH_HOT_BODY_RECHECK_SECONDS": "900",
            "RESEARCH_HOT_EVENT_WINDOW_SECONDS": "86400",
        }):
            m.add_release_events(self.db, "NBIS", [URL])
            self.assertEqual(self.check()["recheckSeconds"], 900)
            self.db.execute("DELETE FROM release_events WHERE url=?", (URL,))
            self.db.commit()
            self.assertEqual(self.check(b"corrected")["recheckSeconds"], 900)

    def test_unfetched_or_incomplete_review_is_rejected(self):
        with self.assertRaises(ValueError):
            m.review(self.db, URL, None, "approved", "editor", "Unfetched")
        self.check()
        for reviewer, reason in [("", "reason"), ("editor", " ")]:
            with self.assertRaises(ValueError):
                m.review(self.db, URL, self.row()["sha256"], "approved", reviewer, reason)

    def test_new_discovery_is_not_assigned_todays_publication_date(self):
        markup = b'<a href="/newsroom/new?a=1">New</a><a href="/newsroom/new#a">Duplicate</a>'
        result = m.discover(self.db, "NBIS", lambda *_: (markup, "text/html"))
        self.assertEqual(result["candidates"], 1)
        row = self.db.execute("SELECT * FROM sources WHERE url LIKE '%/new'").fetchone()
        self.assertIsNone(row["published_on"])
        self.assertEqual(row["status"], "pending")

    def test_empty_dynamic_or_failed_index_is_degraded_not_no_news(self):
        for ticker in ("NBIS", "MU"):
            result = m.discover(self.db, ticker, lambda *_: (b"<div id='app'></div>", "text/html"))
            self.assertEqual(result["status"], "degraded")

    def test_official_sec_fallback_is_used_when_company_index_fails(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>6-K - Report</title><link href="https://www.sec.gov/Archives/edgar/data/1046179/000104617926000658/0001046179-26-000658-index.htm"/></entry></feed>'''

        def transport(url, _ticker):
            if url == m.INDEXES["TSM"]:
                raise RuntimeError("HTTP Error 403")
            return atom, "application/atom+xml"

        result = m.discover(self.db, "TSM", transport)
        self.assertEqual(result["status"], "fallback")
        self.assertEqual(result["route"], "fallback")
        self.assertEqual(result["candidates"], 1)
        run = self.db.execute("SELECT status,index_url,error FROM discovery_runs WHERE ticker='TSM'").fetchone()
        self.assertEqual(run["status"], "fallback")
        self.assertIn("sec.gov", run["index_url"])
        self.assertIn("403", run["error"])

    def test_priority_companies_record_multi_route_sec_recovery_evidence(self):
        companies = {
            "TSM": ("1046179", "6-K"),
            "MRVL": ("1835632", "8-K"),
            "ANET": ("1596532", "8-K"),
            "VRT": ("1674101", "8-K"),
            "PLTR": ("1321655", "8-K"),
        }
        for ticker, (cik, form) in companies.items():
            with self.subTest(ticker=ticker):
                accession = f"000{cik}-26-000001"
                archive_accession = accession.replace("-", "")
                atom = f'''<feed xmlns="http://www.w3.org/2005/Atom"><entry>
                  <title>{form} - Official filing</title>
                  <link href="https://www.sec.gov/Archives/edgar/data/{int(cik)}/{archive_accession}/{accession}-index.htm"/>
                </entry></feed>'''.encode()

                def transport(url, _ticker):
                    if "output=atom" in url:
                        return atom, "application/atom+xml"
                    raise RuntimeError("HTTP Error 403")

                result, links = m.collect_discovery(ticker, transport, automatic=True)
                self.assertEqual(result["status"], "fallback")
                self.assertEqual(result["sourceFormat"], "rss")
                self.assertEqual(result["sourcesChecked"], 3)
                self.assertEqual(result["sourcesConfigured"], 3)
                self.assertEqual(len(links), 1)
                m.save_discovery(self.db, ticker, result, links)
                run = self.db.execute("""
                  SELECT source_format,sources_checked,sources_configured
                  FROM discovery_runs WHERE ticker=? ORDER BY id DESC LIMIT 1
                """, (ticker,)).fetchone()
                self.assertEqual(dict(run), {
                    "source_format": "rss",
                    "sources_checked": 3,
                    "sources_configured": 3,
                })

    def test_degraded_discovery_records_completed_route_evidence(self):
        result, links = m.collect_discovery(
            "MRVL", lambda *_: (_ for _ in ()).throw(TimeoutError()), automatic=True
        )
        self.assertEqual(links, {})
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["sourceFormat"], "none")
        self.assertEqual(result["sourcesChecked"], result["sourcesConfigured"])

    def test_automatic_monitor_prefers_twse_material_information(self):
        source = m.monitoring_sources("TSM", automatic=True)[0]
        self.assertEqual(source["route"], "primary")
        self.assertEqual(source["format"], "twse-material-json")
        self.assertEqual(source["twseCompanyCode"], "2330")
        self.assertTrue(source["allowEmpty"])

    def test_sec_submissions_json_filters_form_and_builds_official_document_url(self):
        source = next(source for source in m.monitoring_sources("TSM", automatic=True) if source["format"] == "sec-json")
        body = b'''{"cik":"1046179","filings":{"recent":{"form":["6-K","3"],"accessionNumber":["0001046179-26-000658","0000000000-26-000001"],"primaryDocument":["tsm-20260918.htm","ownership.xml"],"primaryDocDescription":["REPORT OF FOREIGN ISSUER",""]}}}'''
        links = m.sec_submission_links(body, "TSM", source)
        self.assertEqual(len(links), 1)
        url, title = next(iter(links.items()))
        self.assertEqual(url, "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000658/tsm-20260918.htm")
        self.assertEqual(title, "6-K · REPORT OF FOREIGN ISSUER")

    def test_twse_material_information_is_filtered_and_saved_as_inline_evidence(self):
        body = json.dumps([
            {"發言日期":"1150918","發言時間":"153643","公司代號":"2330","公司名稱":"台積電","主旨 ":"董事會決議重要事項","說明":"1. 核准資本預算100億元。\n2. 尚待執行。"},
            {"發言日期":"1150918","發言時間":"160000","公司代號":"9999","公司名稱":"其他公司","主旨 ":"不應匯入","說明":"其他"},
        ], ensure_ascii=False).encode()
        result = m.discover(self.db, "TSM", lambda *_: (body, "application/json"))
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["candidates"], 1)
        row = self.db.execute("SELECT * FROM sources WHERE ticker='TSM'").fetchone()
        self.assertEqual(row["published_on"], "2026-09-18")
        self.assertEqual(row["source_mode"], "inline")
        self.assertEqual(row["content_type"], "application/json")
        self.assertIn("資本預算100億元", row["extracted_text"])
        self.assertIsNotNone(row["sha256"])
        self.assertIn("company=2330", row["url"])
        self.assertNotIn("extracted_text", m.snapshot(self.db)["sources"][-1])

    def test_twse_valid_empty_company_result_is_not_a_false_failure(self):
        body = b'[{"company":"other"}]'
        result, links = m.collect_discovery("TSM", lambda *_: (body, "application/json"), automatic=True)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["candidates"], 0)
        self.assertEqual(links, {})

    def test_collection_is_read_only_until_saved_and_reports_only_new_urls(self):
        markup = b'<a href="/newsroom/automatic">Automatic release</a>'
        result, links = m.collect_discovery("NBIS", lambda *_: (markup, "text/html"), automatic=True)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources WHERE url LIKE '%automatic'").fetchone()[0], 0)
        self.assertEqual(len(m.save_discovery(self.db, "NBIS", result, links)), 1)
        self.assertEqual(len(m.save_discovery(self.db, "NBIS", result, links)), 0)

    def test_recovered_primary_source_does_not_report_a_stale_fallback_error(self):
        markup = b'<a href="/news/announcement/official-release">Official release</a>'

        def transport(url, _ticker):
            if url == "https://www.oracle.com/news/":
                return markup, "text/html"
            raise RuntimeError("HTTP Error 403")

        result, links = m.collect_discovery("ORCL", transport, automatic=True)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["route"], "primary")
        self.assertIsNone(result["error"])
        self.assertEqual(list(links), ["https://www.oracle.com/news/announcement/official-release"])

    def test_release_events_are_deduplicated_and_exposed_without_private_fields(self):
        new_url = "https://nebius.com/newsroom/automatic-event"
        m.add_source(self.db, "NBIS", new_url, title="Official release")
        m.add_release_events(self.db, "NBIS", [new_url, new_url])
        report = m.snapshot(self.db)
        self.assertEqual(len(report["events"]), 1)
        self.assertEqual(report["events"][0]["url"], new_url)
        self.assertEqual(report["events"][0]["title"], "Official release")
        self.assertNotIn("reviewer", report["events"][0])
        self.assertIsNone(report["events"][0]["detection_to_body_ms"])

        row = self.db.execute("SELECT * FROM sources WHERE url=?", (new_url,)).fetchone()
        m.save_source_check(self.db, row, {
            "sha256": "c" * 64, "contentType": "text/html", "contentBytes": 40,
            "extractedText": "Official evidence body.", "extractedChars": 23,
        })
        measured = m.snapshot(self.db)["events"][0]
        self.assertIsNotNone(measured["body_fetched_at"])
        self.assertGreaterEqual(measured["detection_to_body_ms"], 0)
        first_fetched_at = measured["body_fetched_at"]
        current = self.db.execute("SELECT * FROM sources WHERE url=?", (new_url,)).fetchone()
        m.save_source_check(self.db, current, {
            "sha256": "c" * 64, "contentType": "text/html", "contentBytes": 40,
            "extractedText": "Official evidence body.", "extractedChars": 23,
        })
        self.assertEqual(m.snapshot(self.db)["events"][0]["body_fetched_at"], first_fetched_at)

    def test_conditional_fetch_reuses_cached_body_on_not_modified(self):
        url = m.INDEXES["NBIS"]
        m._FETCH_CACHE[url] = {
            "content": b"cached-index",
            "content_type": "text/html",
            "etag": '"revision-1"',
            "last_modified": "Fri, 19 Sep 2026 00:00:00 GMT",
        }
        original = m.build_opener

        class NotModified:
            def open(self, request, timeout):
                self.request = request
                raise HTTPError(request.full_url, 304, "Not Modified", {}, None)

        opener = NotModified()
        m.build_opener = lambda *_: opener
        try:
            content, content_type = m.fetch(url, "NBIS")
        finally:
            m.build_opener = original
            m._FETCH_CACHE.pop(url, None)
        self.assertEqual((content, content_type), (b"cached-index", "text/html"))
        self.assertEqual(opener.request.headers["If-none-match"], '"revision-1"')

    def test_conditional_article_fetch_treats_cached_304_as_not_modified(self):
        url = URL
        m._FETCH_CACHE[url] = {
            "content": b"cached article must not be re-extracted",
            "content_type": "text/html",
            "etag": None,
            "last_modified": None,
        }
        original = m.build_opener

        class NotModified:
            def open(self, request, timeout):
                self.request = request
                raise HTTPError(
                    request.full_url, 304, "Not Modified",
                    {"ETag": '"persisted-revision-2"'}, None,
                )

        opener = NotModified()
        m.build_opener = lambda *_: opener
        try:
            result = m.fetch(
                url, "NBIS",
                validators={"etag": '"persisted-revision-1"', "last_modified": None},
                include_metadata=True,
            )
        finally:
            m.build_opener = original
            m._FETCH_CACHE.pop(url, None)
        self.assertTrue(result["notModified"])
        self.assertIsNone(result["content"])
        self.assertIsNone(result["contentType"])
        self.assertEqual(result["etag"], '"persisted-revision-2"')
        self.assertEqual(opener.request.headers["If-none-match"], '"persisted-revision-1"')

    def test_persisted_validator_survives_restart_and_304_preserves_evidence(self):
        m.save_source_check(self.db, self.row(), {
            "sha256": "d" * 64, "contentType": "text/html", "contentBytes": 40,
            "extractedText": "Persisted official evidence.", "extractedChars": 28,
            "responseEtag": '"article-revision-1"',
            "responseLastModified": "Fri, 19 Sep 2026 00:00:00 GMT",
        })
        before = self.row()
        original_fetch_time = before["fetched_at"]
        original_history = self.db.execute("SELECT count(*) FROM history").fetchone()[0]
        m._FETCH_CACHE.pop(URL, None)
        original = m.build_opener

        class PersistedNotModified:
            def open(self, request, timeout):
                self.request = request
                raise HTTPError(request.full_url, 304, "Not Modified", {}, None)

        opener = PersistedNotModified()
        m.build_opener = lambda *_: opener
        try:
            result = m.collect_source(before)
        finally:
            m.build_opener = original
        self.assertTrue(result["notModified"])
        self.assertEqual(opener.request.headers["If-none-match"], '"article-revision-1"')
        self.assertEqual(
            opener.request.headers["If-modified-since"], "Fri, 19 Sep 2026 00:00:00 GMT"
        )
        saved = m.save_source_check(self.db, before, result)
        after = self.row()
        self.assertEqual(saved["status"], "not-modified")
        self.assertEqual(after["sha256"], "d" * 64)
        self.assertEqual(after["extracted_text"], "Persisted official evidence.")
        self.assertEqual(after["fetched_at"], original_fetch_time)
        self.assertEqual(self.db.execute("SELECT count(*) FROM history").fetchone()[0], original_history)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM source_revisions").fetchone()[0], 1
        )
        public = m.snapshot(self.db)["sources"][0]
        self.assertNotIn("response_etag", public)
        self.assertNotIn("response_last_modified", public)

    def test_unsafe_http_validators_are_not_reused(self):
        self.assertIsNone(m.http_validator("ok\r\nInjected: value"))
        self.assertIsNone(m.http_validator("x" * 1025))

    def test_external_links_and_redirect_targets_are_blocked(self):
        for url in ["http://nebius.com/newsroom/a", "https://nebius.com.evil.test/a", "https://x:secret@nebius.com/a", "https://nebius.com:8443/a", "https://127.0.0.1/a"]:
            with self.assertRaises(ValueError):
                m.safe_url(url, "NBIS")
        parser = m.Links(m.INDEXES["NBIS"], "NBIS")
        parser.feed('<a href="https://other.test/newsroom/x">bad</a><a href="/blog/x">blog</a>')
        self.assertEqual(parser.urls, set())

    def test_restart_retains_history(self):
        self.check()
        self.db.close()
        self.db = m.connect(Path(self.temp.name) / "test.sqlite")
        self.assertIsNotNone(self.row()["sha256"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM history").fetchone()[0], 1)

    def test_snapshot_omits_private_review_fields_and_raw_errors(self):
        self.check()
        m.review(self.db, URL, self.row()["sha256"], "held", "private-editor", "private-reason")
        with self.db:
            self.db.execute("UPDATE sources SET error='private error /local/path' WHERE url=?", (URL,))
        report = m.snapshot(self.db)
        self.assertNotIn("private-", str(report))
        self.assertNotIn("/local/path", str(report))
        self.assertEqual(report["sources"][0]["error"], "fetch-error")
        self.assertEqual(report["history"][0]["kind"], "held")

    def test_snapshot_export_is_complete_and_leaves_no_temporary_file(self):
        output = Path(self.temp.name) / "public" / "snapshot.json"
        report = m.write_snapshot(self.db, output)
        self.assertTrue(output.exists())
        self.assertFalse(output.with_name(output.name + ".tmp").exists())
        self.assertEqual(report["schemaVersion"], 1)

    def test_micron_corporate_index_finds_ir_links_and_records_origin(self):
        markup = b'<a href="https://investors.micron.com/news/press-release/2026/example/default.aspx">Read</a>'
        result = m.discover(self.db, "MU", lambda *_: (markup, "text/html"))
        self.assertEqual(result["candidates"], 1)
        self.assertEqual(self.db.execute("SELECT index_url FROM discovery_runs").fetchone()[0], m.INDEXES["MU"])

    def test_official_rss_keeps_plain_title_and_rejects_other_hosts(self):
        body = b'''<rss><channel><item><title>Arm &amp; AI</title><link>https://newsroom.arm.com/news/example</link></item><item><link>https://evil.test/news/example</link></item></channel></rss>'''
        result = m.discover(self.db, "ARM", lambda *_: (body, "application/rss+xml"))
        self.assertEqual(result["candidates"], 1)
        row = self.db.execute("SELECT * FROM sources WHERE ticker='ARM'").fetchone()
        self.assertEqual(row["title"], "Arm & AI")
        self.assertIsNone(row["published_on"])
        self.assertEqual(row["status"], "pending")

    def test_marvell_uses_company_official_rss_with_sec_fallback(self):
        provider = m.PROVIDERS["MRVL"]
        self.assertEqual(provider["format"], "rss")
        self.assertEqual(provider["indexUrl"], "https://investor.marvell.com/news-events/press-releases/rss")
        self.assertEqual(provider["fallbackSources"][0]["format"], "sec-json")
        body = b'''<rss><channel><item><title>Marvell AI release</title><link>https://investor.marvell.com/news-events/press-releases/detail/1234/example</link></item></channel></rss>'''
        result, links = m.collect_discovery("MRVL", lambda *_: (body, "text/xml"), automatic=True)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(list(links.values()), ["Marvell AI release"])

    def test_arista_uses_first_party_press_release_rss(self):
        provider = m.PROVIDERS["ANET"]
        self.assertEqual(provider["indexUrl"], "https://www.arista.com/en/company/news/press-release-rss")
        body = b'''<rss><channel><item><title>Arista AI release</title><link>https://www.arista.com/en/company/news/press-release/123-pr-20260919</link></item></channel></rss>'''
        result, links = m.collect_discovery("ANET", lambda *_: (body, "application/xml"), automatic=True)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(list(links.values()), ["Arista AI release"])

    def test_palantir_first_party_sitemap_keeps_only_press_releases(self):
        body = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.palantir.com/newsroom/press-releases/official-release/</loc></url><url><loc>https://www.palantir.com/newsroom/media/not-a-release/</loc></url></urlset>'''
        result, links = m.collect_discovery("PLTR", lambda *_: (body, "application/xml"), automatic=True)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(list(links), ["https://www.palantir.com/newsroom/press-releases/official-release/"])

    def test_vertiv_public_news_endpoint_uses_static_post_and_scoped_links(self):
        source = m.monitoring_sources("VRT")[0]
        self.assertEqual(source["format"], "news-json")
        self.assertEqual(source["requestJson"]["newsType"], "4593")
        body = b'''{"items":[{"displayName":"Vertiv AI release","pageUrl":"/en-us/about/news-and-events/corporate-news/2026/official-release/"},{"displayName":"Outside","pageUrl":"https://evil.test/release"}]}'''
        links = m.news_json_links(body, "VRT", source)
        self.assertEqual(links, {"https://www.vertiv.com/en-us/about/news-and-events/corporate-news/2026/official-release/": "Vertiv AI release"})

    def test_brief_draft_requires_current_exact_evidence_and_cited_numbers(self):
        body = b"<main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        evidence = {"summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."]}
        result = m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "mixed", "供給能力の拡大は成長機会ですが、実行時期と需要の確度は引き続き確認が必要です。",
            "medium", evidence,
        )
        self.assertEqual(result["status"], "draft")
        self.assertFalse(result["published"])
        with self.assertRaises(ValueError):
            m.save_brief_draft(
                self.db, URL, sha,
                "公式発表によると、AI向け容量は2028年に増加する計画です。",
                "mixed", "供給能力の拡大は成長機会ですが、実行時期と需要の確度は引き続き確認が必要です。",
                "medium", evidence,
            )

    def test_brief_numbers_must_be_cited_by_the_same_editorial_field(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand in 2027.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        with self.assertRaisesRegex(ValueError, "numeric summary claim"):
            m.save_brief_draft(
                self.db, URL, sha,
                "公式発表によると、AI向け容量は2027年に増加する計画です。",
                "mixed", "実行時期と需要の確度は2027年も引き続き確認が必要です。",
                "medium", {
                    "summary": ["Capacity will increase."],
                    "impact": ["Execution remains subject to demand in 2027."],
                },
            )

    def test_brief_review_revalidates_both_evidence_fields(self):
        body = b"<main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "mixed", "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "medium", {
                "summary": ["Capacity will increase in 2027."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.db.execute("DELETE FROM brief_evidence WHERE url=? AND field='impact'", (URL,))
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "missing or invalid"):
            self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.assertEqual(self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0], "draft")

    def test_brief_review_revalidates_field_specific_numeric_claims(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand in 2027.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量を増加させる計画です。",
            "mixed", "実行時期と需要の確度は2027年も引き続き確認が必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand in 2027."],
            },
        )
        self.db.execute(
            "UPDATE briefs SET summary_ja=? WHERE url=?",
            ("公式発表によると、AI向け容量は2027年に増加する計画です。", URL),
        )
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "missing or invalid"):
            self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.assertEqual(self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0], "draft")

    def test_brief_review_rejects_evidence_modified_after_save(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量を増加させる計画です。",
            "mixed", "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.db.execute(
            "UPDATE brief_evidence SET excerpt=? WHERE url=? AND field='summary'",
            ("Capacity may increase.", URL),
        )
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "missing or invalid"):
            self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.assertEqual(self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0], "draft")

    def test_brief_review_rejects_valid_but_unsealed_edit_after_save(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表では、AI向けの供給能力を増やす計画が示されています。",
            "mixed", "供給拡大の余地はありますが、需要と実行状況の確認が引き続き必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.db.execute(
            "UPDATE briefs SET summary_ja=? WHERE url=?",
            ("公式資料では、AI向け供給能力を拡大する方針が示されています。", URL),
        )
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "missing or invalid"):
            self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.assertEqual(self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0], "draft")

    def test_only_human_approved_brief_is_public_without_private_review_data(self):
        body = b"<main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "mixed", "供給能力の拡大は成長機会ですが、実行時期と需要の確度は引き続き確認が必要です。",
            "medium", {"summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."]},
        )
        self.assertEqual(m.snapshot(self.db)["briefs"], [])
        self.db.execute(
            "UPDATE briefs SET status='approved',reviewed_at=? WHERE url=?",
            ("2026-09-21T00:00:00+00:00", URL),
        )
        self.db.commit()
        self.assertEqual(m.snapshot(self.db)["briefs"], [])
        self.db.execute(
            "UPDATE briefs SET status='draft',reviewed_at=NULL WHERE url=?", (URL,)
        )
        self.db.commit()
        result = self.review_brief(URL, sha, "approved", "private-editor", "private-review-reason")
        self.assertFalse(result["published"])
        public = m.snapshot(self.db)["briefs"]
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["status"], "approved")
        self.assertEqual(public[0]["generation_method"], "human")
        self.assertEqual(public[0]["source_checked_at"], self.row()["checked_at"])
        self.assertNotIn("private-", str(public))
        self.assertEqual(public[0]["evidence"]["summary"], [{
            "text": "Capacity will increase in 2027.", "truncated": False,
        }])
        self.assertEqual(public[0]["evidence"]["impact"], [{
            "text": "Execution remains subject to demand.", "truncated": False,
        }])
        self.assertNotIn("reviewer", str(public))
        self.assertNotIn("review_reason", str(public))

        editorial = m.private_brief_queue(self.db, 5)
        self.assertEqual(len(editorial["items"]), 1)
        self.assertIn("Capacity will increase", editorial["items"][0]["source_text"])
        self.assertEqual(editorial["items"][0]["evidence"]["summary"], ["Capacity will increase in 2027."])
        self.assertTrue(editorial["items"][0]["review_preflight"]["ready"])
        self.assertEqual(editorial["items"][0]["review_preflight"]["blockers"], [])
        self.assertIn(
            "draft-fingerprint-matched",
            editorial["items"][0]["review_preflight"]["checks"],
        )
        self.assertIn(
            "source-check-recent",
            editorial["items"][0]["review_preflight"]["checks"],
        )
        review_history = editorial["items"][0]["review_history"]
        self.assertEqual(len(review_history), 1)
        self.assertEqual(review_history[0]["source_sha256"], sha)
        self.assertEqual(review_history[0]["decision"], "approved")
        self.assertEqual(review_history[0]["reviewed_at"], public[0]["reviewed_at"])
        self.assertEqual(review_history[0]["reviewer"], "private-editor")
        self.assertEqual(review_history[0]["reason"], "private-review-reason")
        self.assertTrue(review_history[0]["current_revision"])
        self.assertTrue(review_history[0]["draft_validation_sha256"])
        self.assertFalse(editorial["items"][0]["source_text_truncated"])
        self.db.execute(
            "UPDATE briefs SET summary_ja=? WHERE url=?",
            ("公式資料では、AI向け容量を拡大する方針が示されています。", URL),
        )
        self.db.commit()
        self.assertEqual(m.snapshot(self.db)["briefs"], [])
        tampered = m.private_brief_queue(self.db, 5)["items"][0]
        self.assertFalse(tampered["review_preflight"]["ready"])
        self.assertEqual(
            tampered["review_preflight"]["blockers"],
            ["draft-fingerprint-mismatch"],
        )

    def test_brief_review_rejects_a_draft_changed_after_the_editor_loaded_it(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        evidence = {
            "summary": ["Capacity will increase."],
            "impact": ["Execution remains subject to demand."],
        }
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表では、AI向けの供給能力を増やす計画が示されています。",
            "mixed", "供給拡大の余地はありますが、需要と実行状況の確認が必要です。",
            "medium", evidence,
        )
        first_validation_sha = m.private_brief_queue(
            self.db, 5
        )["items"][0]["draft_validation_sha256"]
        with self.assertRaisesRegex(ValueError, "draft-revision-mismatch"):
            m.review_brief(
                self.db, URL, sha, "approved", "missing-fingerprint-editor",
                "検証指紋を省略した判断は拒否します", "",
            )
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表では、AI向け供給能力を拡大する方針が示されています。",
            "mixed", "供給拡大の余地はありますが、需要と実行状況の確認が必要です。",
            "medium", evidence,
        )
        current_validation_sha = m.private_brief_queue(
            self.db, 5
        )["items"][0]["draft_validation_sha256"]
        self.assertNotEqual(first_validation_sha, current_validation_sha)
        with self.assertRaisesRegex(ValueError, "draft-revision-mismatch"):
            self.review_brief(
                URL, sha, "approved", "stale-editor",
                "画面表示時の下書きを確認しました", first_validation_sha,
            )
        self.assertEqual(self.db.execute(
            "SELECT status FROM briefs WHERE url=?", (URL,)
        ).fetchone()[0], "draft")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM brief_review_history WHERE url=?", (URL,)
        ).fetchone()[0], 0)
        result = self.review_brief(
            URL, sha, "held", "current-editor",
            "最新版を確認して追加確認に回します", current_validation_sha,
        )
        self.assertEqual(result["status"], "held")

    def test_stale_source_check_blocks_review_and_public_preview(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表では、AI向けの供給能力を増やす計画が示されています。",
            "mixed", "供給拡大の余地はありますが、需要と実行状況の確認が必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.assertEqual(len(m.snapshot(self.db)["briefs"]), 1)

        stale_at = (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat(
            timespec="milliseconds"
        )
        self.db.execute("UPDATE sources SET checked_at=? WHERE url=?", (stale_at, URL))
        self.db.commit()

        item = m.private_brief_queue(self.db, 5)["items"][0]
        self.assertFalse(item["review_preflight"]["ready"])
        self.assertEqual(item["review_preflight"]["blockers"], ["source-check-stale"])
        self.assertEqual(m.snapshot(self.db)["briefs"], [])
        with self.assertRaisesRegex(ValueError, "missing, stale"):
            self.review_brief(URL, sha, "held", "editor", "Refresh required")
        self.assertEqual(
            self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0],
            "approved",
        )

    def test_public_brief_evidence_is_bounded_and_marks_truncation(self):
        result = m._public_brief_evidence({
            "summary": ["A" * 400, "second", "not-public"],
            "impact": ["B" * 12],
        })
        self.assertEqual(result["summary"], [
            {"text": "A" * 320, "truncated": True},
            {"text": "second", "truncated": False},
        ])
        self.assertEqual(result["impact"], [
            {"text": "B" * 12, "truncated": False},
        ])

    def test_brief_review_history_is_append_only_and_private(self):
        body = b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量を増加させる計画です。",
            "mixed", "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.review_brief(URL, sha, "held", "first-editor", "追加確認が必要です")
        self.review_brief(URL, sha, "approved", "second-editor", "原文と根拠を再確認しました")
        history = m.private_brief_queue(self.db, 5)["items"][0]["review_history"]
        self.assertEqual([item["decision"] for item in history], ["approved", "held"])
        self.assertEqual([item["reviewer"] for item in history], ["second-editor", "first-editor"])
        self.assertTrue(all(item["current_revision"] for item in history))
        self.assertTrue(all(item["draft_validation_sha256"] for item in history))
        self.assertNotIn("review_history", m.snapshot(self.db)["briefs"][0])

        m.save_brief_draft(
            self.db, URL, sha,
            "公式資料では、AI向けの供給能力を増やす方針を示しています。",
            "mixed", "供給拡大の余地はありますが、需要と実行状況の継続確認が必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        rewritten_history = m.private_brief_queue(self.db, 5)["items"][0]["review_history"]
        self.assertTrue(all(not item["current_revision"] for item in rewritten_history))
        self.review_brief(URL, sha, "held", "third-editor", "書き直した要約を追加確認します")
        rewritten_history = m.private_brief_queue(self.db, 5)["items"][0]["review_history"]
        self.assertEqual(
            [item["current_revision"] for item in rewritten_history],
            [True, False, False],
        )

        legacy = self.db.execute("""
          INSERT INTO brief_review_history(
            url,source_sha256,draft_validation_sha256,decision,reviewed_at,reviewer,reason
          ) VALUES(?,?,?,?,?,?,?)
        """, (
            URL, sha, None, "held", "2026-09-21T00:00:00+00:00",
            "legacy-editor", "下書き指紋導入前の判断です",
        ))
        legacy_history = m.private_brief_queue(self.db, 5)["items"][0]["review_history"]
        self.assertFalse(legacy_history[0]["current_revision"])
        self.db.execute("DELETE FROM brief_review_history WHERE id=?", (legacy.lastrowid,))
        self.db.commit()

        self.check(b"<main><p>Capacity plan changed.</p></main>")
        stale_history = m.private_brief_queue(self.db, 5)["items"][0]["review_history"]
        self.assertTrue(all(not item["current_revision"] for item in stale_history))
        with self.assertRaises(ValueError):
            self.review_brief(URL, self.row()["sha256"], "held", "bad\nname", "理由を確認します")

    def test_editorial_queue_counts_all_items_and_prioritizes_human_actions(self):
        body = b"<main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main>"
        summary = "公式発表によると、AI向け容量は2027年に増加する計画です。"
        impact = "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。"
        evidence = {
            "summary": ["Capacity will increase in 2027."],
            "impact": ["Execution remains subject to demand."],
        }

        def prepare(url):
            m.add_source(self.db, "NBIS", url)
            row = self.db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            m.check_source(self.db, row, lambda *_: (body, "text/html"))
            return self.db.execute("SELECT sha256 FROM sources WHERE url=?", (url,)).fetchone()[0]

        approved_sha = prepare(URL)
        m.save_brief_draft(self.db, URL, approved_sha, summary, "mixed", impact, "medium", evidence)
        self.review_brief(URL, approved_sha, "approved", "editor", "Evidence reviewed")

        draft_url = "https://nebius.com/newsroom/draft-release"
        draft_sha = prepare(draft_url)
        m.save_brief_draft(self.db, draft_url, draft_sha, summary, "mixed", impact, "medium", evidence)

        held_url = "https://nebius.com/newsroom/held-release"
        held_sha = prepare(held_url)
        m.save_brief_draft(self.db, held_url, held_sha, summary, "mixed", impact, "medium", evidence)
        self.review_brief(held_url, held_sha, "held", "editor", "Needs follow-up")

        prepare("https://nebius.com/newsroom/no-draft-release")
        self.db.execute(
            "UPDATE briefs SET validation_sha256=? WHERE url=?",
            ("0" * 64, draft_url),
        )
        self.db.commit()
        queue = m.private_brief_queue(self.db, 2)

        self.assertEqual(queue["counts"], {
            "total": 4, "needs_draft": 1, "awaiting_review": 1, "stale": 0,
            "held": 1, "approved": 1, "rejected": 0,
            "machine_ready": 1, "machine_blocked": 1,
        })
        self.assertEqual([item["brief_status"] for item in queue["items"]], ["draft", "held"])
        self.assertEqual([item["url"] for item in queue["items"]], [draft_url, held_url])
        self.assertFalse(queue["items"][0]["review_preflight"]["ready"])
        self.assertEqual(
            queue["items"][0]["review_preflight"]["blockers"],
            ["draft-fingerprint-mismatch"],
        )
        self.assertTrue(queue["items"][1]["review_preflight"]["ready"])

        ready = m.private_brief_queue(self.db, 50, "ready")
        self.assertEqual(ready["filter"], "ready")
        self.assertEqual(ready["filteredTotal"], 1)
        self.assertEqual([item["url"] for item in ready["items"]], [held_url])

        blocked = m.private_brief_queue(self.db, 50, "blocked")
        self.assertEqual(blocked["filteredTotal"], 1)
        self.assertEqual([item["url"] for item in blocked["items"]], [draft_url])

        needs_draft = m.private_brief_queue(self.db, 50, "needs-draft")
        self.assertEqual(needs_draft["filteredTotal"], 1)
        self.assertEqual(
            [item["url"] for item in needs_draft["items"]],
            ["https://nebius.com/newsroom/no-draft-release"],
        )
        self.assertEqual(needs_draft["counts"], queue["counts"])
        with self.assertRaisesRegex(ValueError, "invalid-review-filter"):
            m.private_brief_queue(self.db, 50, "approved")

    def test_source_change_makes_approved_brief_stale_and_private_again(self):
        body = b"<main><p>Capacity will increase in 2027.</p><p>Execution remains subject to demand.</p></main>"
        self.check(body)
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "mixed", "供給能力の拡大は成長機会ですが、実行時期と需要の確度は引き続き確認が必要です。",
            "medium", {"summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."]},
        )
        self.review_brief(URL, sha, "approved", "editor", "Evidence reviewed")
        self.check(b"<main><p>Capacity plan changed.</p></main>")
        self.assertEqual(self.db.execute("SELECT status FROM briefs WHERE url=?", (URL,)).fetchone()[0], "stale")
        self.assertEqual(m.snapshot(self.db)["briefs"], [])
        stale = m.private_brief_queue(self.db, 5)["items"][0]
        self.assertFalse(stale["brief_current"])
        self.assertEqual(stale["brief_status"], "stale")
        self.assertFalse(stale["review_preflight"]["ready"])
        self.assertEqual(
            stale["review_preflight"]["blockers"],
            ["source-revision-mismatch"],
        )
        self.assertIsNone(stale["summary_ja"])
        self.assertIsNone(stale["impact_ja"])
        self.assertEqual(stale["evidence"], {"summary": [], "impact": []})
        previous = stale["previous_brief"]
        self.assertEqual(previous["source_sha256"], sha)
        self.assertIn("2027年", previous["summary_ja"])
        self.assertEqual(previous["evidence"]["summary"], ["Capacity will increase in 2027."])
        public = json.dumps(m.snapshot(self.db), ensure_ascii=False)
        self.assertNotIn("previous_brief", public)
        self.assertNotIn(previous["summary_ja"], public)

    def test_tampered_stale_brief_is_not_returned_as_previous_reference(self):
        self.check(b"<main><p>Capacity will increase.</p><p>Execution remains subject to demand.</p></main>")
        sha = self.row()["sha256"]
        m.save_brief_draft(
            self.db, URL, sha,
            "公式発表によると、AI向け容量を増加させる計画です。",
            "mixed", "供給能力の拡大余地がありますが、実行と需要の確認が必要です。",
            "medium", {
                "summary": ["Capacity will increase."],
                "impact": ["Execution remains subject to demand."],
            },
        )
        self.check(b"<main><p>Capacity plan changed.</p></main>")
        self.db.execute(
            "UPDATE briefs SET summary_ja=summary_ja || ' 改変' WHERE url=?", (URL,)
        )
        self.db.commit()

        stale = m.private_brief_queue(self.db, 5)["items"][0]
        self.assertEqual(stale["brief_status"], "stale")
        self.assertIsNone(stale["previous_brief"])

    def test_annual_queue_counts_and_prioritizes_items_needing_human_action(self):
        business = "The company provides accelerated computing systems to enterprise customers."
        risk = "Demand changes and third-party suppliers may adversely affect product delivery."

        def save(ticker, accession, source_sha):
            payload = {
                "id": f"{ticker.lower()}-annual-ja", "ticker": ticker,
                "accessionNumber": accession, "sourceSha256": source_sha,
                "summaryJa": "企業顧客に向けて、アクセラレーテッド・コンピューティング基盤を提供する企業です。",
                "businessModelJa": "企業顧客へ計算基盤を提供し、その対価を収益として受け取ります。",
                "riskPointsJa": [{
                    "text": "需要変動や外部供給企業への依存により、製品供給へ影響する可能性があります。",
                    "evidenceIds": ["risk-1"],
                }],
                "summaryEvidenceIds": ["business-1"],
                "businessModelEvidenceIds": ["business-1"],
                "evidence": [
                    {"id": "business-1", "section": "business", "quote": business},
                    {"id": "risk-1", "section": "risk", "quote": risk},
                ],
                "confidence": "medium", "generationMethod": "human",
                "sourceBusiness": business, "sourceRisks": risk,
            }
            m.save_annual_filing_brief_draft(self.db, payload)
            return payload

        approved = save("NVDA", "0001045810-26-000021", "a" * 64)
        self.review_annual_brief(
            "NVDA", approved["accessionNumber"], approved["sourceSha256"],
            "approved", "editor-one", "SEC原文と根拠を確認しました",
        )
        held = save("MRVL", "0001835632-26-000001", "b" * 64)
        self.review_annual_brief(
            "MRVL", held["accessionNumber"], held["sourceSha256"],
            "held", "editor-two", "追加確認が必要なため保留します",
        )
        invalid = save("ANET", "0001596532-26-000001", "c" * 64)
        self.db.execute("""
          UPDATE annual_filing_briefs SET validation_sha256=?
          WHERE ticker=? AND accession_number=?
        """, ("0" * 64, "ANET", invalid["accessionNumber"]))
        self.db.commit()

        statements = []
        self.db.set_trace_callback(statements.append)
        try:
            queue = m.annual_filing_brief_queue(self.db, 2)
        finally:
            self.db.set_trace_callback(None)
        self.assertEqual(queue["counts"], {
            "total": 3, "draft": 1, "held": 1, "approved": 1,
            "rejected": 0, "integrity_invalid": 1, "actionable": 2,
        })
        self.assertEqual(queue["view"], "all")
        self.assertEqual(queue["filteredTotal"], 3)
        self.assertEqual([item["ticker"] for item in queue["items"]], ["ANET", "MRVL"])
        self.assertFalse(queue["items"][0]["integrityValid"])
        self.assertTrue(queue["items"][1]["integrityValid"])
        self.assertEqual(sum(
            "FROM annual_filing_review_history" in statement
            for statement in statements
        ), 1)

        actionable = m.annual_filing_brief_queue(self.db, 10, "actionable")
        self.assertEqual(actionable["filteredTotal"], 2)
        self.assertEqual([item["ticker"] for item in actionable["items"]], ["ANET", "MRVL"])
        invalid_only = m.annual_filing_brief_queue(self.db, 10, "invalid")
        self.assertEqual([item["ticker"] for item in invalid_only["items"]], ["ANET"])
        approved_only = m.annual_filing_brief_queue(self.db, 10, "approved")
        self.assertEqual([item["ticker"] for item in approved_only["items"]], ["NVDA"])
        self.assertEqual(approved_only["counts"], queue["counts"])
        with self.assertRaisesRegex(ValueError, "invalid-annual-review-filter"):
            m.annual_filing_brief_queue(self.db, 10, "unknown")

    def test_annual_filing_brief_requires_exact_evidence_and_human_approval(self):
        business = "NVIDIA designs accelerated computing platforms and software for data centers and other markets."
        risk = "Demand can change rapidly, and dependence on third-party suppliers could disrupt product delivery."
        payload = {
            "id": "nvda-2026-annual-ja", "ticker": "NVDA",
            "accessionNumber": "0001045810-26-000021", "sourceSha256": "a" * 64,
            "summaryJa": "データセンターなどに向けて、計算基盤とソフトウェアを提供する企業です。",
            "businessModelJa": "計算基盤と関連ソフトウェアをデータセンターなどの市場へ提供します。",
            "riskPointsJa": [{
                "text": "需要の急変や第三者サプライヤーへの依存により、製品供給が滞る可能性があります。",
                "evidenceIds": ["risk-1"],
            }],
            "summaryEvidenceIds": ["business-1"],
            "businessModelEvidenceIds": ["business-1"],
            "evidence": [
                {"id": "business-1", "section": "business", "quote": business},
                {"id": "risk-1", "section": "risk", "quote": risk},
            ],
            "confidence": "high", "generationMethod": "human",
            "sourceBusiness": business, "sourceRisks": risk,
        }
        saved = m.save_annual_filing_brief_draft(self.db, payload)
        self.assertEqual(saved["status"], "draft")
        first_validation_sha = m.annual_filing_brief_queue(
            self.db
        )["items"][0]["validationSha256"]
        with self.assertRaisesRegex(ValueError, "annual-review-source-invalid"):
            m.review_annual_filing_brief(
                self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"],
                "approved", "missing-source-editor", "SEC抜粋なしの判断は拒否します",
                first_validation_sha, "", "",
            )
        reworded_before_review = {
            **payload,
            "summaryJa": "計算基盤とソフトウェアをデータセンターなどへ提供している企業です。",
        }
        m.save_annual_filing_brief_draft(self.db, reworded_before_review)
        current_validation_sha = m.annual_filing_brief_queue(
            self.db
        )["items"][0]["validationSha256"]
        self.assertNotEqual(first_validation_sha, current_validation_sha)
        with self.assertRaisesRegex(ValueError, "annual-draft-revision-mismatch"):
            self.review_annual_brief(
                "NVDA", payload["accessionNumber"], payload["sourceSha256"],
                "approved", "stale-editor", "画面表示時の下書きを確認しました",
                first_validation_sha,
            )
        self.assertEqual(self.db.execute(
            "SELECT status FROM annual_filing_briefs WHERE ticker='NVDA'"
        ).fetchone()[0], "draft")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM annual_filing_review_history WHERE ticker='NVDA'"
        ).fetchone()[0], 0)
        m.save_annual_filing_brief_draft(self.db, payload)
        self.assertIsNone(m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        ))
        self.db.execute("""
          UPDATE annual_filing_briefs SET status='approved',reviewed_at=?
          WHERE ticker=? AND accession_number=?
        """, ("2026-09-21T00:00:00+00:00", "NVDA", payload["accessionNumber"]))
        self.db.commit()
        self.assertIsNone(m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        ))
        self.db.execute("""
          UPDATE annual_filing_briefs SET status='draft',reviewed_at=NULL
          WHERE ticker=? AND accession_number=?
        """, ("NVDA", payload["accessionNumber"]))
        self.db.commit()
        held = self.review_annual_brief(
            "NVDA", payload["accessionNumber"], payload["sourceSha256"],
            "held", "first-editor", "追加確認が必要です",
        )
        self.assertEqual(held["status"], "held")
        self.assertIsNone(m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        ))
        reviewed = self.review_annual_brief(
            "NVDA", payload["accessionNumber"], payload["sourceSha256"],
            "approved", "private-editor", "SEC原文と根拠引用を照合済み",
        )
        self.assertEqual(reviewed["status"], "approved")
        public = m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        )
        self.assertEqual(public["summaryJa"], payload["summaryJa"])
        self.assertTrue(public["generatedAt"].endswith("Z"))
        self.assertTrue(public["reviewedAt"].endswith("Z"))
        self.assertNotIn("reviewer", public)
        self.assertNotIn("reviewReason", public)
        self.assertNotIn("reviewHistory", public)
        self.db.execute("""
          UPDATE annual_filing_briefs SET summary_ja=?
          WHERE ticker=? AND accession_number=?
        """, ("保存後に改変された日本語要点です。", "NVDA", payload["accessionNumber"]))
        self.db.commit()
        self.assertIsNone(m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        ))
        self.db.execute("""
          UPDATE annual_filing_briefs SET summary_ja=?
          WHERE ticker=? AND accession_number=?
        """, (payload["summaryJa"], "NVDA", payload["accessionNumber"]))
        self.db.commit()
        self.assertIsNone(m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], "b" * 64
        ))
        private = m.annual_filing_brief_queue(self.db)["items"][0]
        self.assertEqual(private["reviewer"], "private-editor")
        self.assertEqual(
            [entry["decision"] for entry in private["reviewHistory"]],
            ["approved", "held"],
        )
        self.assertEqual(
            [entry["reviewer"] for entry in private["reviewHistory"]],
            ["private-editor", "first-editor"],
        )
        self.assertTrue(all(entry["currentRevision"] for entry in private["reviewHistory"]))
        self.assertTrue(all(entry["draftValidationSha256"] for entry in private["reviewHistory"]))

        legacy = self.db.execute("""
          INSERT INTO annual_filing_review_history(
            ticker,accession_number,source_sha256,draft_validation_sha256,
            decision,reviewed_at,reviewer,reason
          ) VALUES(?,?,?,?,?,?,?,?)
        """, (
            "NVDA", payload["accessionNumber"], payload["sourceSha256"], None,
            "held", "2026-09-21T00:00:00+00:00", "legacy-editor",
            "下書き指紋導入前の判断です",
        ))
        legacy_history = m.annual_filing_brief_queue(self.db)["items"][0]["reviewHistory"]
        self.assertFalse(legacy_history[0]["currentRevision"])
        self.db.execute("DELETE FROM annual_filing_review_history WHERE id=?", (legacy.lastrowid,))

        altered = {**payload, "evidence": [
            {"id": "business-1", "section": "business", "quote": "A plausible sentence absent from the filing."},
            payload["evidence"][1],
        ]}
        with self.assertRaisesRegex(ValueError, "annual-evidence-not-in-source"):
            m.save_annual_filing_brief_draft(self.db, altered)

        reworded = {
            **payload,
            "summaryJa": "計算基盤とソフトウェアをデータセンターなどへ提供している企業です。",
        }
        m.save_annual_filing_brief_draft(self.db, reworded)
        history = m.annual_filing_brief_queue(self.db)["items"][0]["reviewHistory"]
        self.assertTrue(all(not entry["currentRevision"] for entry in history))
        self.review_annual_brief(
            "NVDA", payload["accessionNumber"], payload["sourceSha256"],
            "held", "third-editor", "書き直した要点を追加確認します",
        )
        history = m.annual_filing_brief_queue(self.db)["items"][0]["reviewHistory"]
        self.assertEqual([entry["currentRevision"] for entry in history], [True, False, False])

        revised = {**payload, "sourceSha256": "b" * 64}
        m.save_annual_filing_brief_draft(self.db, revised)
        history = m.annual_filing_brief_queue(self.db)["items"][0]["reviewHistory"]
        self.assertTrue(all(not entry["currentRevision"] for entry in history))

    def test_annual_filing_brief_rejects_uncited_numbers(self):
        business = "The company provides accelerated computing systems."
        risk = "Demand and supply conditions may affect results."
        payload = {
            "id": "nvda-annual-ja", "ticker": "NVDA",
            "accessionNumber": "0001045810-26-000021", "sourceSha256": "c" * 64,
            "summaryJa": "同社は計算基盤を提供し、売上高は100億ドルに達しています。",
            "businessModelJa": "企業向けにアクセラレーテッド・コンピューティング基盤を提供します。",
            "riskPointsJa": [{"text": "需要と供給の変動が業績に影響する可能性があります。", "evidenceIds": ["risk-1"]}],
            "summaryEvidenceIds": ["business-1"], "businessModelEvidenceIds": ["business-1"],
            "evidence": [{"id": "business-1", "section": "business", "quote": business},
                         {"id": "risk-1", "section": "risk", "quote": risk}],
            "confidence": "medium", "generationMethod": "human",
            "sourceBusiness": business, "sourceRisks": risk,
        }
        with self.assertRaisesRegex(ValueError, "annual-number-not-grounded"):
            m.save_annual_filing_brief_draft(self.db, payload)

    def test_annual_filing_review_rejects_a_draft_changed_after_validation(self):
        business = "The company provides accelerated computing systems to enterprise customers."
        risk = "Demand changes and third-party suppliers may adversely affect product delivery."
        payload = {
            "id": "nvda-tamper-check-ja", "ticker": "NVDA",
            "accessionNumber": "0001045810-26-000021", "sourceSha256": "e" * 64,
            "summaryJa": "企業顧客に向けて、アクセラレーテッド・コンピューティング基盤を提供する企業です。",
            "businessModelJa": "企業顧客へ計算基盤を提供し、その対価を収益として受け取ります。",
            "riskPointsJa": [{
                "text": "需要変動や外部供給企業への依存により、製品供給へ影響する可能性があります。",
                "evidenceIds": ["risk-1"],
            }],
            "summaryEvidenceIds": ["business-1"],
            "businessModelEvidenceIds": ["business-1"],
            "evidence": [
                {"id": "business-1", "section": "business", "quote": business},
                {"id": "risk-1", "section": "risk", "quote": risk},
            ],
            "confidence": "medium", "generationMethod": "human",
            "sourceBusiness": business, "sourceRisks": risk,
        }
        m.save_annual_filing_brief_draft(self.db, payload)
        self.db.execute("""
          UPDATE annual_filing_briefs SET summary_ja=?
          WHERE ticker=? AND accession_number=?
        """, ("保存後に書き換えられた未検証の日本語要約です。", "NVDA", payload["accessionNumber"]))
        self.db.commit()

        with self.assertRaisesRegex(ValueError, "annual-draft-evidence-invalid"):
            self.review_annual_brief(
                "NVDA", payload["accessionNumber"], payload["sourceSha256"],
                "approved", "private-editor", "SEC原文と根拠引用を照合済み",
            )
        row = self.db.execute("""
          SELECT status FROM annual_filing_briefs
          WHERE ticker=? AND accession_number=?
        """, ("NVDA", payload["accessionNumber"])).fetchone()
        self.assertEqual(row["status"], "draft")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM annual_filing_review_history"
        ).fetchone()[0], 0)

    def test_annual_filing_brief_preserves_multiple_risks_and_evidence_links(self):
        business = "The company develops computing systems and software for enterprise customers."
        demand = "Customer demand can change rapidly and may adversely affect operating results."
        supply = "The company depends on third-party suppliers for critical components."
        security = "Cybersecurity incidents could interrupt services and harm the company reputation."
        payload = {
            "id": "nvda-multi-risk-ja", "ticker": "NVDA",
            "accessionNumber": "0001045810-26-000021", "sourceSha256": "d" * 64,
            "summaryJa": "企業向けに計算システムとソフトウェアを開発する企業です。",
            "businessModelJa": "企業顧客へ計算システムと関連ソフトウェアを提供します。",
            "riskPointsJa": [
                {"text": "顧客需要の急変により、業績へ悪影響が及ぶ可能性があります。", "evidenceIds": ["risk-1-1"]},
                {"text": "重要部品の外部調達とサイバー攻撃により、事業が中断する可能性があります。", "evidenceIds": ["risk-2-1", "risk-2-2"]},
            ],
            "summaryEvidenceIds": ["business-1"], "businessModelEvidenceIds": ["business-1"],
            "evidence": [
                {"id": "business-1", "section": "business", "quote": business},
                {"id": "risk-1-1", "section": "risk", "quote": demand},
                {"id": "risk-2-1", "section": "risk", "quote": supply},
                {"id": "risk-2-2", "section": "risk", "quote": security},
            ],
            "confidence": "high", "generationMethod": "human",
            "sourceBusiness": business, "sourceRisks": "\n".join([demand, supply, security]),
        }
        saved = m.save_annual_filing_brief_draft(self.db, payload)
        self.review_annual_brief(
            "NVDA", payload["accessionNumber"], payload["sourceSha256"],
            "approved", "private-editor", "複数のSEC原文引用を照合済み",
        )
        public = m.approved_annual_filing_brief(
            self.db, "NVDA", payload["accessionNumber"], payload["sourceSha256"]
        )
        self.assertEqual(saved["status"], "draft")
        self.assertEqual(len(public["riskPointsJa"]), 2)
        self.assertEqual(public["riskPointsJa"][1]["evidenceIds"], ["risk-2-1", "risk-2-2"])
        self.assertEqual(len(public["evidence"]), 4)

    def test_atom_links_supported_and_entity_declarations_rejected(self):
        body = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>AI</title><link href="https://newsroom.arm.com/news/ai"/></entry></feed>'''
        self.assertEqual(len(m.feed_links(body, "ARM")), 1)
        with self.assertRaises(ValueError):
            m.feed_links(b'<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>', "ARM")

    def test_bad_feed_fails_without_creating_false_candidates(self):
        count = self.db.execute("SELECT count(*) FROM sources").fetchone()[0]
        result = m.discover(self.db, "ARM", lambda *_: (b"<rss>broken", "application/rss+xml"))
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources").fetchone()[0], count)

    def test_all_registered_sources_are_scoped_to_their_official_hosts(self):
        self.assertEqual(len(m.PROVIDERS), 22)
        for ticker, p in m.PROVIDERS.items():
            self.assertEqual(m.safe_url(p["indexUrl"], ticker), p["indexUrl"])
            if p.get("monitorUrl"):
                self.assertEqual(m.safe_url(p["monitorUrl"], ticker), p["monitorUrl"])
            if p.get("monitorUrl"):
                self.assertEqual(m.safe_url(p["monitorUrl"], ticker), p["monitorUrl"])
            for source in p.get("fallbackSources", []):
                self.assertEqual(m.safe_url(source["url"], ticker), source["url"])
                self.assertIn(source["format"], {"html", "rss", "sec-json", "sitemap", "news-json"})
            for rule in p["articleRules"]:
                self.assertIn(rule["host"], m.HOSTS[ticker])
                self.assertIsNotNone(m.re.compile(rule["pattern"]))


if __name__ == "__main__":
    unittest.main()
