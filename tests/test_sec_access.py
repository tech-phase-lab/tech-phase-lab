from datetime import datetime, timedelta, timezone
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import monitor as m


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


RSS = (b'<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><item><title>AMD news</title>'
       b'<link>https://ir.amd.com/news-events/press-releases/detail/1234/amd-news</link>'
       b'<pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>')


class SecAccessTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.access = m.SecAccess(clock=self.clock)
        patcher = patch.object(m, "SEC_ACCESS", self.access)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_block_pauses_all_sec_requests_briefly_then_recovers(self):
        self.assertEqual(self.access.failed("http-403"), 60)
        with self.assertRaisesRegex(ValueError, "paused"):
            self.access.check()
        self.assertEqual(self.access.failed("http-403"), 120)
        for _ in range(10):
            delay = self.access.failed("http-429")
        self.assertEqual(delay, 900)  # Never the old 6-hour-to-7-day parking.
        self.assertEqual(self.access.failed("http-429", retry_after=1800), 1800)
        self.clock.now += 1801
        self.access.check()
        self.access.succeeded()
        self.assertEqual(self.access.failed("http-403"), 60)

    def test_user_agent_without_contact_is_never_sent_to_sec(self):
        for value in ("", "TechPhaseResearch/1.0", "bad\r\nX: y ops@example.com"):
            with patch.dict("os.environ", {"RESEARCH_USER_AGENT": value}):
                with self.assertRaisesRegex(ValueError, "no contact"):
                    m.sec_user_agent()
                with patch.object(m, "build_opener", side_effect=AssertionError("no request")):
                    with self.assertRaises(ValueError) as error:
                        m.fetch("https://data.sec.gov/submissions/CIK0000002488.json", "AMD")
                self.assertEqual(m.source_error_code(error.exception), "sec-user-agent-missing")
        with patch.dict("os.environ", {"RESEARCH_USER_AGENT": "TechPhaseResearch ops@example.com"}):
            self.assertEqual(m.sec_user_agent(), "TechPhaseResearch ops@example.com")

    def transport(self, sec_status=None):
        calls = []

        def send(url, ticker, validators=None, include_metadata=False):
            calls.append(url)
            if m.is_sec_url(url):
                if sec_status:
                    self.access.failed(f"http-{sec_status}")
                    raise HTTPError(url, sec_status, "blocked", {}, io.BytesIO(b""))
                return {"content": b'{"filings":{"recent":{}}}', "contentType": "application/json",
                        "etag": None, "lastModified": None, "notModified": False}
            return {"content": RSS, "contentType": "application/rss+xml", "etag": None,
                    "lastModified": None, "notModified": False}
        send.supports_persistent_validators = True
        return send, calls

    def test_blocked_sec_is_not_hammered_and_company_feed_continues(self):
        send, calls = self.transport(sec_status=403)
        for _ in range(5):
            result, links = m.collect_discovery("AMD", send, True, {})
            self.assertIn("https://ir.amd.com/news-events/press-releases/detail/1234/amd-news", links)
            self.clock.now += 3
        sec_calls = [url for url in calls if m.is_sec_url(url)]
        # One SEC request, then a shared pause: no Atom fallback, no 3-second retries.
        self.assertEqual(len(sec_calls), 1)
        self.assertEqual(result["error"], "sec-paused")

    def test_each_sec_route_is_polled_at_its_own_interval_with_cached_candidates(self):
        cached = {"https://data.sec.gov/submissions/CIK0000002488.json": {
            "etag": None, "lastModified": None,
            "candidates": {"https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/amd-8k.htm": {"title": "8-K"}},
        }}
        send, calls = self.transport()
        self.access.polled("https://data.sec.gov/submissions/CIK0000002488.json")
        result, links = m.collect_discovery("AMD", send, True, cached)
        self.assertFalse([url for url in calls if m.is_sec_url(url)])
        self.assertIn("https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/amd-8k.htm", links)
        self.clock.now += self.access.poll_seconds
        m.collect_discovery("AMD", send, True, cached)
        self.assertEqual(calls.count("https://data.sec.gov/submissions/CIK0000002488.json"), 1)

    def test_startup_release_clamps_old_sec_parking_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = m.connect(Path(tmp) / "db.sqlite")
            far = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat(timespec="milliseconds")
            sec = "https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/amd-8k.htm"
            issuer = "https://ir.amd.com/news-events/press-releases/detail/1234/amd-news"
            m.add_source(db, "AMD", sec)
            m.add_source(db, "AMD", issuer)
            with db:
                db.execute("UPDATE sources SET error='http-403',next_fetch_at=?", (far,))
                db.execute("INSERT INTO body_host_backoff VALUES('www.sec.gov',6,'http-403',?,?)", (far, far))
                db.execute("INSERT INTO body_host_backoff VALUES('ir.amd.com',3,'http-403',?,?)", (far, far))
            self.assertEqual(m.release_long_sec_backoffs(db), 1)
            rows = dict(db.execute("SELECT url,next_fetch_at FROM sources").fetchall())
            self.assertLess(rows[sec], far)
            self.assertEqual(rows[issuer], far)
            hosts = {row[0]: tuple(row[1:]) for row in db.execute("SELECT host,failures,retry_at FROM body_host_backoff")}
            self.assertEqual(hosts["ir.amd.com"], (3, far))
            self.assertEqual(hosts["www.sec.gov"][0], 1)
            self.assertLess(hosts["www.sec.gov"][1], far)
            db.close()


if __name__ == "__main__":
    unittest.main()
