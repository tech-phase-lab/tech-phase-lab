"""Official earnings channels for SNDK and TSM (2026-11-23).

SNDK: SEC 8-K stays first (Akamai refuses investor.sandisk.com to the production monitor); Sandisk's own newsroom search on
www.sandisk.com (robots allows /tools/api/, no CDN cache) is now collected beside it every 15 seconds, so the next results day
shows whether Sandisk's own site lists the release before the 8-K (Oct 29: release 16:05 ET, 8-K accepted 16:13:53, seen 16:15:40).
Business Wire's feed host is not used: its robots.txt allows /rss/ only to named partners.
TSM and the remaining candidates: an opt-in probe records only reachability (status codes and fixed labels) from production.
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
import monitor  # noqa: E402
import official_channel_probe as probe  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/ir-sources"
SEARCH = FIXTURES / "sandisk-newsroom-search.json"
RESULTS = ("https://www.sandisk.com/company/newsroom/press-releases/2026/"
           "2026-10-29-sandisk-reports-fiscal-first-quarter-2027-financial-results")


class SandiskNewsroomBesideSec(unittest.TestCase):
    def test_sec_answers_first_and_the_newsroom_is_always_collected(self):
        chain = monitor.monitoring_sources("SNDK", automatic=True)
        self.assertEqual([(s["route"], s["format"]) for s in chain],
                         [("fallback", "sec-json"), ("fallback", "rss"), ("primary", "html"), ("supplemental", "news-json")])
        newsroom = chain[-1]
        self.assertTrue(newsroom["url"].startswith("https://www.sandisk.com/tools/api/globalsearchquery?"))
        self.assertEqual(newsroom["minPollSeconds"], 15)
        self.assertNotIn("feed.businesswire.com", monitor.PROVIDERS["SNDK"]["allowedHosts"])

    def test_newsroom_search_yields_dated_release_links_with_titles(self):
        newsroom = monitor.monitoring_sources("SNDK", scope="supplemental")[0]
        links = monitor.discover_links(SEARCH.read_bytes(), "application/json", "SNDK", newsroom)
        self.assertEqual(links[RESULTS], {"title": "Sandisk Reports Fiscal First Quarter 2027 Financial Results",
                                          "publishedOn": "2026-10-29"})
        self.assertEqual(len(links), 4)
        self.assertTrue(all(monitor.article_url(url, "SNDK") == url for url in links))

    def test_newsroom_is_asked_no_more_than_every_15_seconds(self):
        clock = [1000.0]
        calls = []

        def transport(url, ticker, validators=None, include_metadata=False):
            calls.append(url)
            return {"content": SEARCH.read_bytes(), "contentType": "application/json", "etag": None, "lastModified": None,
                    "notModified": False}
        transport.supports_persistent_validators = True
        with mock.patch.object(monitor, "SOURCE_PACE", monitor.SourcePace(clock=lambda: clock[0])):
            _, links = monitor.collect_discovery("SNDK", transport, automatic=True, cached_sources={}, source_scope="supplemental")
            self.assertIn(RESULTS, links)
            clock[0] += 14
            _, again = monitor.collect_discovery("SNDK", transport, automatic=True, cached_sources={}, source_scope="supplemental")
            self.assertEqual(len(calls), 1)
            self.assertEqual(again, links)
            clock[0] += 1
            monitor.collect_discovery("SNDK", transport, automatic=True, cached_sources={}, source_scope="supplemental")
            self.assertEqual(len(calls), 2)


def response(status, headers=None, body=b""):
    return status, {k.lower(): v for k, v in (headers or {}).items()}, body


CHALLENGE = response(403, {"Server": "cloudflare", "cf-mitigated": "challenge"}, b"<title>Just a moment...</title>")
TWSE = response(200, {"Content-Type": "text/html"}, "因為安全性考量 FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.".encode())
AKAMAI = response(403, {"akamai-grn": "0.1"}, b"<TITLE>Access Denied</TITLE>")
BW_ROBOTS = b"User-agent: NewsNow\nAllow: /rss/\n\nUser-agent: *\nDisallow: /rss/\nDisallow: /cgi-bin/\n"


class ReachabilityProbe(unittest.TestCase):
    def test_off_unless_enabled_and_never_more_often_than_ten_minutes(self):
        self.assertFalse(probe.enabled({}))
        self.assertTrue(probe.enabled({"OFFICIAL_CHANNEL_PROBE_ENABLED": "true"}))
        self.assertEqual(probe.interval_seconds({}), 1800)
        self.assertEqual(probe.interval_seconds({"OFFICIAL_CHANNEL_PROBE_SECONDS": "5"}), 600)

    def test_labels_challenges_and_refusals_without_keeping_bodies(self):
        self.assertEqual(probe.classify(*CHALLENGE), "cloudflare-challenge")
        self.assertEqual(probe.classify(*TWSE), "twse-security-page")
        self.assertEqual(probe.classify(*AKAMAI), "akamai-denied")
        self.assertEqual(probe.classify(*response(200, {}, b"[]")), "ok")
        self.assertEqual(probe.classify(*response(404)), "http-404")

    def test_one_round_obeys_robots_and_records_status_only(self):
        requested = []

        def transport(url):
            requested.append(url)
            if url == "https://feed.businesswire.com/robots.txt":
                return response(200, {"Content-Type": "text/plain"}, BW_ROBOTS)
            if url.endswith("/robots.txt"):
                return response(404)
            if "tsmc.com" in url:
                return CHALLENGE
            if "twse.com.tw" in url:
                return TWSE
            return response(200, {"Content-Type": "application/json", "Last-Modified": "Sun, 22 Nov 2026 21:24:34 GMT"}, b"[]")
        results, robots = probe.run_round(transport)
        self.assertEqual(results["businesswire-technology-feed"]["result"], "not-requested-robots")
        self.assertNotIn(probe.CANDIDATES[-1]["url"], requested)
        self.assertEqual(results["tsmc-press-center"]["result"], "cloudflare-challenge")
        self.assertEqual(results["twse-emops"]["result"], "twse-security-page")
        self.assertEqual(results["sandisk-investor"]["lastModified"], "Sun, 22 Nov 2026 21:24:34 GMT")
        self.assertEqual(robots["feed.businesswire.com"]["status"], 200)
        self.assertTrue(all(not key.startswith("_") for host in robots.values() for key in host))
        # Each host's robots.txt once, then each allowed candidate once: no retries, no redirects followed.
        self.assertEqual(len(requested), len({u for u in requested}))

    def test_unreachable_robots_means_the_host_is_left_alone(self):
        def transport(url):
            if url.endswith("/robots.txt"):
                return response(503)
            raise AssertionError("no candidate may be requested")
        results, _ = probe.run_round(transport, candidates=probe.CANDIDATES[:1])
        self.assertEqual(results["tsmc-press-center"]["result"], "not-requested-robots")

    def test_health_block_lists_every_candidate(self):
        state = probe.Probe(env={"OFFICIAL_CHANNEL_PROBE_ENABLED": "true"})
        state.run_once(lambda url: CHALLENGE if "tsmc" in url else response(404))
        health = state.diagnostics()
        self.assertTrue(health["enabled"])
        self.assertEqual(health["rounds"], 1)
        self.assertEqual({c["id"] for c in health["candidates"]}, {c["id"] for c in probe.CANDIDATES})
        tsmc = next(c for c in health["candidates"] if c["id"] == "tsmc-press-center")
        self.assertEqual(tsmc["recent"], ["cloudflare-challenge"])
        self.assertNotIn("body", str(health).lower())


if __name__ == "__main__":
    unittest.main()
