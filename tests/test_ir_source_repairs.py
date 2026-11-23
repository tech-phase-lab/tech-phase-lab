"""IR discovery repairs (2026-11-22) checked against pages saved from each company's own site.

DELL: Equisolve moved the feed and release URLs to /news-events/press-releases/... (no-release-links).
CRDO: the corporate home page answers a Cloudflare check in production; the Q4 investor feed and list do not.
LRCX: the investor site redesign removed /news-releases (404); releases are PDFs linked from the IR home page.
SKHY, SNDK: the IR site is refused to robots (SK hynix terms) or by Akamai (403), so SEC answers first.
COHR: GlobeNewswire organization feed first (the wire carries the release before or with the 8-K), SEC 8-K beside it.
"""
import json
import sys
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
import monitor  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/ir-sources"


def source(ticker, fmt, route="primary"):
    return next(s for s in monitor.monitoring_sources(ticker) if s["format"] == fmt and s["route"] == route)


class DellFeed(unittest.TestCase):
    def test_moved_feed_yields_dated_release_links(self):
        primary = monitor.monitoring_sources("DELL")[0]
        self.assertEqual(primary["url"], "https://investors.delltechnologies.com/news-events/press-releases/rss")
        links = monitor.discover_links((FIXTURES / "dell-press-releases.rss.xml").read_bytes(), "text/xml", "DELL", primary)
        url = ("https://investors.delltechnologies.com/news-events/press-releases/detail/1661/"
               "dell-technologies-to-hold-conference-call-nov-24-to-discuss-third-quarter-fiscal-2027-financial-results")
        self.assertEqual(len(links), 4)
        self.assertEqual(links[url]["publishedOn"], "2026-11-10")   # two-digit year in pubDate ("Tue, 10 Nov 26")
        self.assertIn("Third Quarter Fiscal 2027", links[url]["title"])

    def test_old_release_urls_stay_recognized(self):
        old = "https://investors.delltechnologies.com/news-releases/news-release-details/dell-ai-systems-update"
        self.assertEqual(monitor.article_url(old, "DELL"), old)


class CredoFeeds(unittest.TestCase):
    def test_q4_rss_is_primary_and_carries_release_text(self):
        primary = monitor.monitoring_sources("CRDO")[0]
        self.assertEqual((primary["url"], primary["format"]), ("https://investors.credosemi.com/rss/pressrelease.aspx", "rss"))
        links = monitor.discover_links((FIXTURES / "credo-q4-pressrelease.rss.xml").read_bytes(), "text/xml", "CRDO", primary)
        url = ("https://investors.credosemi.com/news-events/news/news-details/2026/"
               "Credo-Schedules-Second-Quarter-Fiscal-Year-2027-Financial-Results-Conference-Call/default.aspx")
        self.assertEqual(len(links), 2)
        self.assertEqual(links[url]["publishedOn"], "2026-11-11")

    def test_q4_json_list_is_the_next_fallback(self):
        chain = [s["format"] for s in monitor.monitoring_sources("CRDO", scope="primary")]
        self.assertEqual(chain, ["rss", "news-json", "html"])
        links = monitor.discover_links((FIXTURES / "credo-q4-press-release-list.json").read_bytes(), "application/json",
                                       "CRDO", source("CRDO", "news-json", "fallback"))
        self.assertEqual(list(links.values())[0], "Credo Reaches Settlement in Patent Dispute")
        self.assertTrue(all(url.startswith("https://investors.credosemi.com/news-events/news/news-details/2026/") for url in links))


class LamHome(unittest.TestCase):
    def test_release_pdfs_are_found_with_their_titles(self):
        primary = monitor.monitoring_sources("LRCX")[0]
        self.assertEqual(primary["url"], "https://investor.lamresearch.com/")
        links = monitor.discover_links((FIXTURES / "lam-investor-home.html").read_bytes(), "text/html", "LRCX", primary)
        results = ("https://investor.lamresearch.com/content/dam/newsroom/press_release_pdfs/2026-10-21-Lam-Research-"
                   "Corporation-Reports-Financial-Results-for-the-Quarter-Ended-September-27,-2026.pdf")
        self.assertIn(results, links)
        self.assertEqual(links[results], "Lam Research Corporation Reports Financial Results for the Quarter Ended September 27, 2026")
        self.assertTrue(all(url.endswith(".pdf") for url in links))   # the ?releaseId= detail pages carry no stable path

    def test_view_pdf_label_without_accessible_name_is_not_a_title(self):
        parser = monitor.Links("https://investor.lamresearch.com/", "LRCX")
        parser.feed('<a href="/content/dam/newsroom/press_release_pdfs/2026-11-17-X.pdf">VIEW PDF VERSION &gt;&gt;</a>')
        self.assertEqual(parser.labels, {})


COHERENT_FEED = "https://rss.globenewswire.com/RssFeed/organization/BjWJdSGc9z7QeHAvb_k3Ew=="
COHERENT_RESULTS = ("https://www.globenewswire.com/news-release/2026/11/04/3395801/11543/en/"
                    "coherent-corp-reports-first-quarter-fiscal-2027-results.html")


class CoherentGlobeNewswire(unittest.TestCase):
    """Coherent issues its results on GlobeNewswire (dateline "(GLOBE NEWSWIRE)"); the wire's organization feed on
    rss.globenewswire.com answered servers while ir.coherent.com (Akamai) did not. Release times on the wire vs SEC acceptance:
    Nov 4 16:05:00 / 16:05:07, Aug 12 16:05 / 16:10:13, May 6 16:06 / 16:10:58 (ET)."""

    def test_wire_feed_is_primary_and_sec_is_always_collected_beside_it(self):
        chain = monitor.monitoring_sources("COHR", automatic=True)
        self.assertEqual([(s["route"], s["format"]) for s in chain],
                         [("primary", "rss"), ("fallback", "rss"), ("supplemental", "sec-json"), ("supplemental-fallback", "rss")])
        self.assertEqual(chain[0]["url"], COHERENT_FEED)
        self.assertEqual(chain[1]["url"], "https://ir.coherent.com/rss/news-releases.xml")
        self.assertEqual(chain[2]["forms"], ["8-K"])
        self.assertEqual(monitor.PROVIDERS["COHR"]["pollSeconds"], 10)

    def test_feed_yields_only_coherent_releases_with_titles(self):
        links = monitor.discover_links((FIXTURES / "coherent-globenewswire-organization.rss.xml").read_bytes(),
                                       "application/rss+xml", "COHR", monitor.monitoring_sources("COHR")[0])
        self.assertEqual(len(links), 20)
        self.assertEqual(links[COHERENT_RESULTS], "Coherent Corp. Reports First Quarter Fiscal 2027 Results")
        self.assertTrue(all(url.startswith("https://www.globenewswire.com/news-release/20") and "/11543/en/" in url for url in links))

    def test_other_wire_releases_are_not_coherent_articles(self):
        other = "https://www.globenewswire.com/news-release/2026/11/04/3395802/0/en/another-company-reports-results.html"
        self.assertIsNone(monitor.article_url(other, "COHR"))
        self.assertIsNone(monitor.article_url(COHERENT_RESULTS, "NVDA"))

    def test_release_body_comes_from_the_wire_rss_host_and_names_that_address(self):
        mirror = COHERENT_RESULTS.replace("https://www.", "https://rss.")
        self.assertEqual(monitor.body_mirror_url(COHERENT_RESULTS, "COHR"), mirror)
        page = (FIXTURES / "coherent-globenewswire-q1fy27-results.html").read_bytes()
        requested = []

        def transport(url, ticker):
            requested.append(url)
            return page, "text/html"
        row = {"url": COHERENT_RESULTS, "ticker": "COHR", "title": "Coherent Corp. Reports First Quarter Fiscal 2027 Results",
               "content_type": None, "sha256": None, "extracted_text": None, "extracted_chars": None,
               "response_etag": None, "response_last_modified": None, "extractor_version": None}
        result = monitor.collect_source(row, transport)
        self.assertEqual(requested, [mirror])
        text = json.dumps(result, ensure_ascii=False)
        self.assertIn("Revenue for the first quarter of fiscal 2027 was $2.37 billion", text)

    def test_a_page_whose_canonical_is_another_release_is_refused(self):
        page = (FIXTURES / "coherent-globenewswire-q1fy27-results.html").read_bytes().replace(
            b"3395801/11543/en/coherent-corp-reports-first-quarter-fiscal-2027-results.html\" />",
            b"3395802/11543/en/coherent-other.html\" />")
        row = {"url": COHERENT_RESULTS, "ticker": "COHR", "title": "Coherent Corp. Reports First Quarter Fiscal 2027 Results",
               "content_type": None, "sha256": None, "extracted_text": None, "extracted_chars": None,
               "response_etag": None, "response_last_modified": None, "extractor_version": None}
        with self.assertRaises(ValueError):
            monitor.collect_source(row, lambda *_: (page, "text/html"))


class SecFirstWhereTheSiteRefusesRobots(unittest.TestCase):
    def test_blocked_sites_answer_from_sec_first(self):
        for ticker, form in (("SKHY", "6-K"), ("SNDK", "8-K")):
            chain = monitor.monitoring_sources(ticker, automatic=True)
            self.assertEqual(chain[0]["format"], "sec-json", ticker)
            self.assertEqual(chain[0]["route"], "fallback", ticker)
            self.assertEqual(chain[0]["forms"], [form], ticker)

    def test_sk_hynix_site_is_not_in_any_chain(self):
        for automatic in (False, True):
            urls = [s["url"] for s in monitor.monitoring_sources("SKHY", automatic=automatic)]
            self.assertEqual(urls, ["https://data.sec.gov/submissions/CIK0002120882.json"])

    def test_sk_hynix_discovery_makes_no_request_to_its_site(self):
        requested = []

        def transport(url, ticker):
            requested.append(url)
            return json.dumps({"cik": 2120882, "filings": {"recent": {"form": [], "accessionNumber": [],
                                                                      "primaryDocument": [], "primaryDocDescription": []}}}).encode(), "application/json"
        with mock.patch.object(urllib.request, "urlopen", side_effect=AssertionError("no network")):
            result, _links = monitor.collect_discovery("SKHY", transport=transport, automatic=True)
        self.assertEqual(requested, ["https://data.sec.gov/submissions/CIK0002120882.json"])
        self.assertNotIn("invalid-source-response", json.dumps(result))   # the refused-site attempt is gone

    def test_other_companies_keep_their_order(self):
        self.assertEqual([s["route"] for s in monitor.monitoring_sources("DELL", automatic=True)],
                         ["primary", "supplemental", "supplemental-fallback"])
        self.assertEqual(monitor.monitoring_sources("AMD", automatic=True)[0]["route"], "primary")


if __name__ == "__main__":
    unittest.main()
