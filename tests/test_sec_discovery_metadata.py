"""Synthetic-only SEC identity and clock retention, using original SEC URLs."""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import socket
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "sec_discovery_monitor", ROOT / "scripts/research/monitor.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
SEC_URL = "https://data.sec.gov/submissions/CIK0001664703.json"
FILING_URL = "https://www.sec.gov/Archives/edgar/data/1664703/000166470326000001/be-20261002.htm"
SOURCE = next(source for source in monitor.monitoring_sources("BE") if source["format"] == "sec-json")
IDENTITY = {"secForm": "8-K", "secCik": "0001664703", "secAccession": "0001664703-26-000001"}
CLOCKS = {"secFilingDate": "2026-10-02", "secAcceptanceDateTime": "2026-10-02T16:03:04.123Z"}
RESULT = {
    "status": "ok", "route": "supplemental", "candidates": 1, "error": None,
    "sourceUrl": SEC_URL, "sourceFormat": "sec-json",
}


def submissions(**columns):
    recent = {
        "form": ["8-K"], "accessionNumber": ["0001664703-26-000001"],
        "primaryDocument": ["be-20261002.htm"], "primaryDocDescription": ["CURRENT REPORT"],
        "filingDate": [CLOCKS["secFilingDate"]],
        "acceptanceDateTime": [CLOCKS["secAcceptanceDateTime"]],
        **columns,
    }
    return json.dumps({"cik": 1664703, "filings": {"recent": recent}}).encode()


class SecDiscoveryMetadataTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for attribute in ("create_connection", "getaddrinfo", "gethostbyname", "gethostbyname_ex"):
            self.stack.enter_context(patch.object(
                socket, attribute, side_effect=AssertionError("Network/DNS prohibited in SEC fixtures")))
        for attribute in ("connect", "connect_ex", "sendto"):
            self.stack.enter_context(patch.object(
                socket.socket, attribute, side_effect=AssertionError("Network prohibited in SEC fixtures")))
        self.temp = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.path = Path(self.temp) / "monitor.sqlite"
        self.db = monitor.connect(self.path)
        self.addCleanup(self.db.close)

    def row(self):
        return self.db.execute("SELECT * FROM sources WHERE url=?", (FILING_URL,)).fetchone()

    def test_structured_filing_keeps_original_url_and_distinct_clocks(self):
        links = monitor.sec_submission_links(submissions(), "BE", SOURCE)
        self.assertEqual(links, {FILING_URL: {"title": "8-K · CURRENT REPORT", **IDENTITY, **CLOCKS}})
        self.assertEqual(monitor.save_discovery(self.db, "BE", RESULT, links), [FILING_URL])
        row = self.row()
        self.assertEqual(row["sec_form"], "8-K")
        self.assertEqual(row["sec_cik"], "0001664703")
        self.assertEqual(row["sec_accession"], "0001664703-26-000001")
        self.assertEqual(row["sec_filing_date"], "2026-10-02")
        self.assertEqual(row["sec_acceptance_datetime"], CLOCKS["secAcceptanceDateTime"])
        self.assertIsNone(row["published_on"])
        self.assertIsNone(row["fetched_at"])
        self.assertIsNone(row["checked_at"])
        self.assertIsNone(row["sha256"])
        self.assertEqual(row["status"], "pending")
        self.assertEqual(self.db.execute("SELECT count(*) FROM release_events").fetchone()[0], 0)

    def test_clock_validation_never_guesses_missing_timezones_or_dates(self):
        bad_dates = [None, "", "2026-02-30", "2025-02-29", "20261002", "26-10-02",
                     "2026-10-02T00:00:00Z", "２０２６-10-02", 20261002, {}, "0000-01-01"]
        bad_times = [None, "", "2026-10-02", "2026-10-02T16:03:04", "20261002160304",
                     "2026-02-30T16:03:04Z", "2026-10-02T24:00:00Z", "2026-10-02T16:03:60Z",
                     "2026-10-02T16:03:04+24:00", "2026-10-02T16:03:04+01:99",
                     "2026-10-02T16:03:04-00:00", "2026-10-02T16:03:04 EST",
                     "2026-10-02T16:03:04.1234567Z", 20261002160304, {}]
        for value in bad_dates:
            with self.subTest(date=value):
                detail = monitor.sec_submission_links(submissions(filingDate=[value]), "BE", SOURCE)[FILING_URL]
                self.assertNotIn("secFilingDate", detail)
                self.assertEqual(detail["secAcceptanceDateTime"], CLOCKS["secAcceptanceDateTime"])
        for value in bad_times:
            with self.subTest(acceptance=value):
                detail = monitor.sec_submission_links(submissions(acceptanceDateTime=[value]), "BE", SOURCE)[FILING_URL]
                self.assertNotIn("secAcceptanceDateTime", detail)
                self.assertEqual(detail["secFilingDate"], CLOCKS["secFilingDate"])
        for dates, accepted in (([], []), (None, None), ("2026-10-02", {})):
            detail = monitor.sec_submission_links(
                submissions(filingDate=dates, acceptanceDateTime=accepted), "BE", SOURCE)[FILING_URL]
            self.assertEqual(detail, {"title": "8-K · CURRENT REPORT", **IDENTITY})
        self.assertEqual(monitor.valid_sec_filing_date("2024-02-29"), "2024-02-29")
        offset_time = "2026-10-02T12:03:04-04:00"
        self.assertEqual(monitor.valid_sec_acceptance_datetime(offset_time), offset_time)

    def test_parser_rejects_invalid_identity_and_document_without_network(self):
        invalid_columns = [
            {"form": ["8-K/A"]}, {"form": ["10-Q"]}, {"form": [{}]},
            {"accessionNumber": ["000166470326000001"]}, {"accessionNumber": [17]},
            {"primaryDocument": ["../other.htm"]}, {"primaryDocument": ["dir/other.htm"]},
            {"primaryDocument": ["be.htm?other"]}, {"primaryDocument": ["be%2ehtm"]},
            {"primaryDocument": ["a" * 256 + ".htm"]}, {"primaryDocument": [{}]},
        ]
        for columns in invalid_columns:
            with self.subTest(columns=columns):
                self.assertEqual(monitor.sec_submission_links(submissions(**columns), "BE", SOURCE), {})
        for cik in (1664704, True, " 1664703", "00001664703", "１６６４７０３", {}):
            with self.subTest(cik=cik):
                body = json.loads(submissions())
                body["cik"] = cik
                with self.assertRaisesRegex(ValueError, "CIK mismatch"):
                    monitor.sec_submission_links(json.dumps(body).encode(), "BE", SOURCE)

    def test_filing_agent_accession_prefix_does_not_need_to_match_issuer_cik(self):
        links = monitor.sec_submission_links(
            submissions(accessionNumber=["0001193125-26-000001"]), "BE", SOURCE)
        expected = FILING_URL.replace("000166470326000001", "000119312526000001")
        self.assertEqual(list(links), [expected])
        self.assertEqual(links[expected]["secCik"], IDENTITY["secCik"])
        self.assertEqual(links[expected]["secAccession"], "0001193125-26-000001")

    def test_invalid_metadata_is_rejected_by_cache_and_writer_before_any_write(self):
        wrong_details = [
            {**IDENTITY, "secForm": "6-K"}, {**IDENTITY, "secForm": "8-K/A"},
            {**IDENTITY, "secCik": "0001046179"}, {**IDENTITY, "secCik": "1664703"},
            {**IDENTITY, "secAccession": "0001664703-26-000002"},
            {"secForm": "8-K"}, {"secFilingDate": "2026-10-02"},
        ]
        for detail in wrong_details:
            with self.subTest(detail=detail):
                self.assertIsNone(monitor.normalized_discovery_candidates("BE", {FILING_URL: detail}))
                with self.assertRaisesRegex(ValueError, "invalid-sec-discovery-metadata"):
                    monitor.save_discovery(self.db, "BE", RESULT, {FILING_URL: detail})
                self.assertIsNone(self.row())
        self.assertEqual(self.db.execute("SELECT count(*) FROM discovery_runs").fetchone()[0], 0)

    def test_metadata_requires_exact_configured_issuer_and_accession_path(self):
        wrong_urls = [
            FILING_URL.replace("/1664703/", "/1046179/"),
            FILING_URL.replace("000166470326000001", "000166470326000002"),
            FILING_URL.replace("www.sec.gov", "data.sec.gov"),
            FILING_URL.replace("www.sec.gov", "www.sec.gov:443"),
            FILING_URL.replace("https://", "http://"),
            FILING_URL + "?tracking=1", FILING_URL + "#fragment",
            FILING_URL.replace("be-20261002.htm", "../be-20261002.htm"),
        ]
        for url in wrong_urls:
            with self.subTest(url=url):
                self.assertIsNone(monitor.normalized_sec_discovery_metadata("BE", url, IDENTITY))
        self.assertIsNone(monitor.normalized_sec_discovery_metadata("TSM", FILING_URL, IDENTITY))

    def test_cache_normalizes_bad_optional_clocks_without_rejecting_legacy_strings(self):
        legacy = {FILING_URL: "8-K · CURRENT REPORT"}
        self.assertEqual(monitor.normalized_discovery_candidates("BE", legacy), legacy)
        bad_clocks = {"secFilingDate": "2026-02-30", "secAcceptanceDateTime": "2026-10-02T16:03:04"}
        self.assertEqual(monitor.normalized_discovery_candidates(
            "BE", {FILING_URL: {**IDENTITY, **bad_clocks}}), {FILING_URL: IDENTITY})
        monitor.save_discovery(self.db, "BE", RESULT, {FILING_URL: {**IDENTITY, **bad_clocks}})
        self.assertIsNone(self.row()["sec_filing_date"])
        self.assertIsNone(self.row()["sec_acceptance_datetime"])
        self.assertIsNone(self.row()["published_on"])

    def test_migration_adds_nullable_sec_columns_without_manufacturing_old_clocks(self):
        legacy_path = Path(self.temp) / "legacy.sqlite"
        old = sqlite3.connect(legacy_path)
        old.execute("""CREATE TABLE sources(
            url TEXT PRIMARY KEY,ticker TEXT NOT NULL,published_on TEXT,
            discovered_at TEXT NOT NULL,checked_at TEXT,sha256 TEXT,
            status TEXT NOT NULL DEFAULT 'pending',error TEXT)""")
        old.execute("INSERT INTO sources(url,ticker,published_on,discovered_at) VALUES(?,?,?,?)",
                    (FILING_URL, "BE", "2026-10-01", "2026-10-03T12:00:00Z"))
        old.commit()
        old.close()
        migrated = monitor.connect(legacy_path)
        try:
            row = migrated.execute("SELECT * FROM sources").fetchone()
            columns = {column[1]: column for column in migrated.execute("PRAGMA table_info(sources)")}
            for name in ("sec_form", "sec_cik", "sec_accession", "sec_filing_date", "sec_acceptance_datetime"):
                self.assertIsNone(row[name])
                self.assertEqual(columns[name][2], "TEXT")
                self.assertEqual(columns[name][3], 0)
            self.assertEqual(row["published_on"], "2026-10-01")
        finally:
            migrated.close()

    def test_legacy_cache_304_survives_and_natural_200_enriches_existing_row(self):
        legacy = {FILING_URL: "8-K · CURRENT REPORT"}
        monitor.save_discovery(self.db, "BE", RESULT, legacy)
        observed = self.row()["discovered_at"]
        monitor.save_discovery_source_cache(self.db, "BE", {
            SEC_URL: {"etag": '"sec-v1"', "lastModified": None, "candidates": legacy},
        })
        self.assertEqual(monitor.DISCOVERY_CACHE_PARSER_VERSION, 2)
        cache, stats = monitor.load_discovery_source_cache(self.db, "BE", include_stats=True)
        self.assertEqual(stats, {"storedSources": 1, "loadedSources": 1, "invalidatedSources": 0})
        requested = []
        fresh = False

        def transport(url, ticker, validators=None, include_metadata=False):
            requested.append(url)
            self.assertEqual((url, ticker), (SEC_URL, "BE"))
            self.assertTrue(include_metadata)
            self.assertEqual(validators["etag"], '"sec-v1"')
            return {
                "content": submissions() if fresh else None,
                "contentType": "application/json" if fresh else None,
                "etag": '"sec-v2"' if fresh else '"sec-v1"',
                "lastModified": None, "notModified": not fresh,
            }

        transport.supports_persistent_validators = True
        result, links = monitor.collect_discovery(
            "BE", transport, automatic=True, cached_sources=cache, source_scope="supplemental")
        self.assertEqual(links, legacy)
        self.assertEqual(result["_cacheMetrics"]["notModifiedResponses"], 1)
        self.assertEqual(monitor.save_discovery(self.db, "BE", result, links), [])
        for name in ("sec_form", "sec_cik", "sec_accession", "sec_filing_date", "sec_acceptance_datetime"):
            self.assertIsNone(self.row()[name])
        fresh = True
        result, links = monitor.collect_discovery(
            "BE", transport, automatic=True, cached_sources=cache, source_scope="supplemental")
        self.assertEqual(monitor.save_discovery(self.db, "BE", result, links), [])
        self.assertEqual(requested, [SEC_URL, SEC_URL])
        self.assertEqual(self.row()["discovered_at"], observed)
        self.assertEqual(self.row()["sec_acceptance_datetime"], CLOCKS["secAcceptanceDateTime"])
        self.assertIsNone(self.row()["published_on"])
        self.assertIsNone(self.row()["fetched_at"])
        restarted = monitor.connect(self.path)
        try:
            stored = monitor.load_discovery_source_cache(restarted, "BE")
            self.assertEqual(stored[SEC_URL]["candidates"], links)
            self.assertEqual(stored[SEC_URL]["etag"], '"sec-v2"')
        finally:
            restarted.close()

    def test_missing_later_clocks_preserve_retained_evidence_and_body_state(self):
        detail = {"title": "8-K · CURRENT REPORT", "publishedOn": "2026-09-30", **IDENTITY, **CLOCKS}
        monitor.save_discovery(self.db, "BE", RESULT, {FILING_URL: detail})
        with self.db:
            self.db.execute("""UPDATE sources SET status='error',error='http-403',
                checked_at='2026-10-03T12:00:00Z',next_fetch_at='2026-10-04T12:00:00Z',
                fetch_failures=3 WHERE url=?""", (FILING_URL,))
        before = dict(self.row())
        for candidate in ("8-K · CURRENT REPORT", IDENTITY, {**IDENTITY, "secAcceptanceDateTime": "bad"}):
            self.assertEqual(monitor.save_discovery(self.db, "BE", RESULT, {FILING_URL: candidate}), [])
            self.assertEqual(dict(self.row()), before)

    def test_sec_candidate_limit_and_titles_remain_bounded(self):
        columns = {key: [] for key in ("form", "accessionNumber", "primaryDocument", "primaryDocDescription")}
        for number in range(1, 106):
            columns["form"].append("8-K")
            columns["accessionNumber"].append(f"0001664703-26-{number:06d}")
            columns["primaryDocument"].append(f"be-{number}.htm")
            columns["primaryDocDescription"].append("report " * 200)
        links = monitor.sec_submission_links(submissions(**columns), "BE", {**SOURCE, "limit": 999})
        self.assertEqual(len(links), 100)
        self.assertTrue(all(len(detail["title"]) <= 300 for detail in links.values()))


if __name__ == "__main__":
    unittest.main()
