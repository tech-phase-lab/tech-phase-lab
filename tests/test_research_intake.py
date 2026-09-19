import importlib.util
from pathlib import Path
import tempfile
import unittest
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

    def test_repeated_fetch_deduplicates_and_preserves_review(self):
        self.check()
        sha = self.row()["sha256"]
        m.review(self.db, URL, sha, "approved", "editor", "Verified source")
        self.assertEqual(self.check()["status"], "unchanged")
        self.assertEqual(self.row()["status"], "approved")
        self.assertEqual(self.db.execute("SELECT count(*) FROM history").fetchone()[0], 2)

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
        body = b'''<html><head><title>Nebius expands AI capacity</title><meta name="description" content="Official release summary"></head><body><nav>Private navigation noise</nav><main><h1>Nebius expands AI capacity</h1><p>Capacity will increase in 2027.</p><script>steal()</script></main></body></html>'''
        result = self.check(body)
        row = self.row()
        self.assertEqual(result["status"], "first-fetched")
        self.assertEqual(row["content_type"], "text/html")
        self.assertEqual(row["content_bytes"], len(body))
        self.assertIn("Capacity will increase in 2027.", row["extracted_text"])
        self.assertNotIn("Private navigation noise", row["extracted_text"])
        self.assertNotIn("steal()", row["extracted_text"])
        self.assertEqual(row["extracted_chars"], len(row["extracted_text"]))
        public = m.snapshot(self.db)["sources"][0]
        self.assertEqual(public["extracted_chars"], row["extracted_chars"])
        self.assertNotIn("extracted_text", public)

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

    def test_automatic_monitor_prefers_configured_official_fallback(self):
        self.assertEqual(m.monitoring_sources("TSM")[0]["route"], "primary")
        self.assertEqual(m.monitoring_sources("TSM", automatic=True)[0]["route"], "fallback")
        self.assertEqual(m.monitoring_sources("TSM", automatic=True)[0]["format"], "sec-json")

    def test_sec_submissions_json_filters_form_and_builds_official_document_url(self):
        source = m.monitoring_sources("TSM", automatic=True)[0]
        body = b'''{"cik":"1046179","filings":{"recent":{"form":["6-K","3"],"accessionNumber":["0001046179-26-000658","0000000000-26-000001"],"primaryDocument":["tsm-20260918.htm","ownership.xml"],"primaryDocDescription":["REPORT OF FOREIGN ISSUER",""]}}}'''
        links = m.sec_submission_links(body, "TSM", source)
        self.assertEqual(len(links), 1)
        url, title = next(iter(links.items()))
        self.assertEqual(url, "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000658/tsm-20260918.htm")
        self.assertEqual(title, "6-K · REPORT OF FOREIGN ISSUER")

    def test_collection_is_read_only_until_saved_and_reports_only_new_urls(self):
        markup = b'<a href="/newsroom/automatic">Automatic release</a>'
        result, links = m.collect_discovery("NBIS", lambda *_: (markup, "text/html"), automatic=True)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources WHERE url LIKE '%automatic'").fetchone()[0], 0)
        self.assertEqual(len(m.save_discovery(self.db, "NBIS", result, links)), 1)
        self.assertEqual(len(m.save_discovery(self.db, "NBIS", result, links)), 0)

    def test_release_events_are_deduplicated_and_exposed_without_private_fields(self):
        new_url = "https://nebius.com/newsroom/automatic-event"
        m.add_source(self.db, "NBIS", new_url, title="Official release")
        m.add_release_events(self.db, "NBIS", [new_url, new_url])
        report = m.snapshot(self.db)
        self.assertEqual(len(report["events"]), 1)
        self.assertEqual(report["events"][0]["url"], new_url)
        self.assertEqual(report["events"][0]["title"], "Official release")
        self.assertNotIn("reviewer", report["events"][0])

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
            for source in p.get("fallbackSources", []):
                self.assertEqual(m.safe_url(source["url"], ticker), source["url"])
                self.assertIn(source["format"], {"html", "rss", "sec-json"})
            for rule in p["articleRules"]:
                self.assertIn(rule["host"], m.HOSTS[ticker])
                self.assertIsNotNone(m.re.compile(rule["pattern"]))


if __name__ == "__main__":
    unittest.main()
