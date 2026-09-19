import importlib.util
from pathlib import Path
import tempfile
import unittest

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
            for rule in p["articleRules"]:
                self.assertIn(rule["host"], m.HOSTS[ticker])
                self.assertIsNotNone(m.re.compile(rule["pattern"]))


if __name__ == "__main__":
    unittest.main()
