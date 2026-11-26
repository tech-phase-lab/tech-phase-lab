"""TSMC (2330) material information from MOPS (2026-11-23).

The production probe (Railway, Nov 23 09:55Z) reached mops.twse.com.tw (200) while pr.tsmc.com stayed behind a Cloudflare
challenge. MOPS carried TSMC's Q3 EPS announcement at 15:21:38 Taipei on Oct 15 (SEC 6-K accepted 18:40) and the October
revenue report at 13:45:22 on Nov 10 (SEC 6-K 20:01). The list is MOPS's t05st01 reply for one company and year; each row links to
its own announcement (t05st01_detail), whose full text the body fetch reads. Fixtures follow MOPS's reply shape (titles + data);
the detail text is written from TSMC's published Q3 figures.
"""
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
import monitor  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/ir-sources"
LIST = FIXTURES / "tsmc-mops-t05st01.json"
DETAIL = FIXTURES / "tsmc-mops-detail-q3.json"
Q3 = "https://mops.twse.com.tw/mops/api/t05st01_detail?companyId=2330&marketKind=sii&enterDate=1151015&serialNumber=1"


def mops_source():
    return next(s for s in monitor.monitoring_sources("TSM", automatic=True) if s["format"] == "mops-material-json")


class MopsList(unittest.TestCase):
    def test_mops_is_collected_every_cycle_beside_both_chains(self):
        routes = [(s["route"], s["format"]) for s in monitor.monitoring_sources("TSM", automatic=True)]
        self.assertIn(("supplemental-parallel", "mops-material-json"), routes)
        self.assertEqual(routes[0], ("primary", "html"))
        self.assertIn("mops.twse.com.tw", monitor.PROVIDERS["TSM"]["allowedHosts"])

    def test_rows_link_their_own_announcement_with_title_and_date(self):
        links = monitor.discover_links(LIST.read_bytes(), "application/json", "TSM", mops_source())
        self.assertEqual(len(links), 3)  # the row without a detail link and the other company's row are left out
        # 發言時間 15:21:38 Taiwan time is the announcement's own clock time (owner, Nov 26).
        self.assertEqual(links[Q3], {"title": "台積公司2026年第三季每股盈餘新台幣29.43元", "publishedOn": "2026-10-15",
                                     "publishedAt": "2026-10-15T07:21:38+00:00"})
        self.assertTrue(all(monitor.valid_discovery_candidate_url(url, "TSM") for url in links))
        self.assertIn("台積公司2026年10月營收報告", [d["title"] for d in links.values()])

    def test_no_data_is_empty_and_an_error_code_is_a_failure(self):
        self.assertEqual(monitor.discover_links(b'{"code":406,"message":"x","result":null}', "application/json", "TSM", mops_source()), {})
        with self.assertRaises(ValueError):
            monitor.discover_links(b'{"code":500,"message":"x","result":null}', "application/json", "TSM", mops_source())

    def test_identities_are_tightly_scoped(self):
        self.assertFalse(monitor.valid_discovery_candidate_url(Q3.replace("2330", "2303"), "TSM"))
        self.assertFalse(monitor.valid_discovery_candidate_url(Q3 + "&x=1", "TSM"))
        self.assertFalse(monitor.valid_discovery_candidate_url(Q3, "NVDA"))


class MopsRequests(unittest.TestCase):
    def test_list_body_names_the_current_taiwan_year(self):
        body = monitor.request_json(mops_source(), datetime(2026, 12, 31, 15, 59, tzinfo=timezone.utc))
        self.assertEqual(body, {"companyId": "2330", "year": "115", "month": "all", "firstDay": "", "lastDay": ""})
        # 16:00 UTC on Dec 31 is already Jan 1 in Taipei.
        self.assertEqual(monitor.request_json(mops_source(), datetime(2026, 12, 31, 16, 0, tzinfo=timezone.utc))["year"], "116")

    def test_announcement_identity_is_posted_as_its_detail_parameters(self):
        self.assertEqual(monitor.mops_detail_request(Q3), ("https://mops.twse.com.tw/mops/api/t05st01_detail",
                         {"companyId": "2330", "marketKind": "sii", "enterDate": "1151015", "serialNumber": "1"}))
        self.assertIsNone(monitor.mops_detail_request("https://mops.twse.com.tw/mops/api/t05st01"))

    def test_detail_text_is_readable_and_keeps_the_figures(self):
        text = monitor.extract_text(DETAIL.read_bytes(), "application/json")
        self.assertIn("主旨: 台積公司2026年第三季每股盈餘新台幣29.43元", text)
        self.assertIn("發言時間: 15:21:38", text)
        self.assertIn("每股盈餘為新台幣29.43元", text)
        self.assertNotIn('"titles"', text)

    def test_polite_pace_is_faster_only_in_results_and_revenue_windows(self):
        source = mops_source()
        at = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731
        self.assertEqual(monitor.source_poll_seconds(source, at(2026, 10, 15, 6, 0)), 10)   # 14:00 Taipei, results day
        self.assertEqual(monitor.source_poll_seconds(source, at(2026, 11, 10, 5, 30)), 10)  # 13:30 Taipei, revenue day
        self.assertEqual(monitor.source_poll_seconds(source, at(2026, 11, 10, 12, 0)), 300)  # 20:00 Taipei
        self.assertEqual(monitor.source_poll_seconds(source, at(2026, 11, 23, 6, 0)), 300)  # no scheduled release


class MopsRobots(unittest.TestCase):
    def setUp(self):
        monitor._ROBOTS.clear()

    def tearDown(self):
        monitor._ROBOTS.clear()

    def test_rules_are_obeyed(self):
        robots = "User-agent: *\nDisallow: /mops/api/\n"
        self.assertFalse(monitor.robots_allows(Q3, transport=lambda url: (200, robots)))

    def test_allowed_path_and_missing_robots(self):
        self.assertTrue(monitor.robots_allows(Q3, transport=lambda url: (200, "User-agent: *\nDisallow: /server-java/\n")))
        monitor._ROBOTS.clear()
        self.assertTrue(monitor.robots_allows(Q3, transport=lambda url: (404, "")))

    def test_unreachable_robots_allows_nothing(self):
        self.assertFalse(monitor.robots_allows(Q3, transport=lambda url: (503, "")))

    def test_other_hosts_are_not_checked(self):
        self.assertTrue(monitor.robots_allows("https://pr.tsmc.com/english/latest-news",
                                              transport=lambda url: (_ for _ in ()).throw(AssertionError())))

    def test_fetch_refuses_a_disallowed_path(self):
        monitor._ROBOTS["mops.twse.com.tw"] = (monitor.time.monotonic(), monitor.urllib.robotparser.RobotFileParser())
        monitor._ROBOTS["mops.twse.com.tw"][1].parse(["User-agent: *", "Disallow: /"])
        with mock.patch.object(monitor, "build_opener", side_effect=AssertionError("no request")):
            with self.assertRaisesRegex(ValueError, "robots-disallowed"):
                monitor.fetch(Q3, "TSM")


class MopsCollection(unittest.TestCase):
    def test_body_fetch_posts_the_detail_and_saves_readable_text(self):
        sent = []

        class Response:
            status = 200
            headers = type("H", (), {"get_content_type": lambda self: "application/json", "get": lambda self, k, d=None: None,
                                     "get_content_charset": lambda self: None})()

            def read(self, n):
                return DETAIL.read_bytes()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        class Opener:
            def open(self, request, timeout=None):
                sent.append((request.full_url, request.get_method(), json.loads(request.data)))
                return Response()
        monitor._ROBOTS["mops.twse.com.tw"] = (monitor.time.monotonic(), monitor.urllib.robotparser.RobotFileParser())
        monitor._ROBOTS["mops.twse.com.tw"][1].parse([])
        try:
            with mock.patch.object(monitor, "build_opener", return_value=Opener()), \
                    mock.patch.object(monitor, "wait_for_source_courtesy", lambda url: None):
                content, kind = monitor.fetch(Q3, "TSM")
        finally:
            monitor._ROBOTS.clear()
        self.assertEqual(sent, [("https://mops.twse.com.tw/mops/api/t05st01_detail", "POST",
                                 {"companyId": "2330", "marketKind": "sii", "enterDate": "1151015", "serialNumber": "1"})])
        self.assertIn("每股盈餘為新台幣29.43元", monitor.extract_text(content, kind))


if __name__ == "__main__":
    unittest.main()
