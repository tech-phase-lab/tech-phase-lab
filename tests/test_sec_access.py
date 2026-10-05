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


ATOM = b'''<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Latest Filings</title>
<entry><title>8-K - ADVANCED MICRO DEVICES INC (0000002488) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/2488/000000248826000002/0000002488-26-000002-index.htm"/>
<id>urn:tag:sec.gov,2008:accession-number=0000002488-26-000002</id></entry>
<entry><title>8-K - OTHER CO (0000099999) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/99999/000009999926000001/0000099999-26-000001-index.htm"/>
<id>urn:tag:sec.gov,2008:accession-number=0000099999-26-000001</id></entry>
</feed>'''
SUBMISSIONS = "https://data.sec.gov/submissions/CIK0000002488.json"
OLD = "https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/amd-8k.htm"


class EdgarCurrentFeedTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.access = m.SecAccess(clock=self.clock)
        self.feed_calls = []
        self.feed_body = ATOM

        def feed_transport(url):
            self.feed_calls.append(url)
            if self.feed_body is None:
                raise TimeoutError("feed down")
            return self.feed_body
        self.feed = m.EdgarCurrentFeed(clock=self.clock, transport=feed_transport)
        for target, value in (("SEC_ACCESS", self.access), ("EDGAR_CURRENT", self.feed)):
            patcher = patch.object(m, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.calls = []

        def send(url, ticker, validators=None, include_metadata=False):
            self.calls.append(url)
            if m.is_sec_url(url):
                raise TimeoutError("not needed for this test")
            return {"content": RSS, "contentType": "application/rss+xml", "etag": None,
                    "lastModified": None, "notModified": False}
        send.supports_persistent_validators = True
        # The shared feed is consulted only by the real fetcher.
        patcher = patch.object(m, "fetch", send)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.send = send

    def cache(self, accession):
        return {SUBMISSIONS: {"etag": None, "lastModified": None, "candidates": {
            OLD: {"title": "8-K", "secAccession": accession, "secCik": "0000002488"}}}}

    def sec_calls(self):
        return self.calls.count(SUBMISSIONS)

    def test_parse_lists_accessions_by_cik_and_rejects_entities(self):
        self.assertEqual(m.EdgarCurrentFeed.parse(ATOM), {2488: {"0000002488-26-000002"}, 99999: {"0000099999-26-000001"}})
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            m.EdgarCurrentFeed.parse(b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><feed/>')

    def test_new_filing_in_shared_feed_triggers_immediate_company_fetch(self):
        self.access.polled(SUBMISSIONS)  # Just polled: normally not due for 60 s.
        m.collect_discovery("AMD", self.send, True, self.cache("0000002488-26-000001"))
        self.assertEqual(self.sec_calls(), 1)
        self.assertEqual(len(self.feed_calls), 2)  # 8-K and 6-K feeds: one request each.

    def test_no_new_filing_means_no_company_request_until_safety_interval(self):
        self.access.polled(SUBMISSIONS)
        m.collect_discovery("AMD", self.send, True, self.cache("0000002488-26-000002"))
        self.clock.now += 30
        m.collect_discovery("AMD", self.send, True, self.cache("0000002488-26-000002"))
        self.assertEqual(self.sec_calls(), 0)
        self.assertEqual(len(self.feed_calls), 4)  # Feed refreshed every 3 s at most.
        self.clock.now += self.access.safety_poll_seconds
        m.collect_discovery("AMD", self.send, True, self.cache("0000002488-26-000002"))
        self.assertEqual(self.sec_calls(), 1)

    def test_feed_outage_falls_back_to_short_company_interval(self):
        self.feed_body = None
        self.access.polled(SUBMISSIONS)
        self.clock.now += self.access.poll_seconds
        m.collect_discovery("AMD", self.send, True, self.cache("0000002488-26-000002"))
        self.assertEqual(self.sec_calls(), 1)
        self.assertFalse(self.feed.healthy())
