"""Seat counts read from the Wikipedia election infobox: real captures (Nov 5-6, 2026) and the checks that keep a wrong number off the page."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import event_results
import seat_counts

FIXTURES = Path(__file__).with_name("fixtures")
HOUSE = (FIXTURES / "wikipedia_house_infobox_2026-11-05.txt").read_text(encoding="utf-8")
SENATE = (FIXTURES / "wikipedia_senate_infobox_2026-11-05.txt").read_text(encoding="utf-8")
NOW = datetime(2026, 11, 6, 5, 0, tzinfo=timezone.utc)


class ReadingTests(unittest.TestCase):
    def test_the_house_count_and_the_share_of_districts_called_are_read(self):
        data = seat_counts.parse_infobox(HOUSE, "house")
        self.assertEqual((data["democrats"], data["republicans"], data["declared"]), (253, 157, 94.3))
        self.assertEqual(data["asOf"], "2026-11-06T02:00:00+00:00")  # 9:00 PM Nov 5 (ET) = 11:00 Nov 6 JST

    def test_the_senate_range_is_kept_as_a_range(self):
        data = seat_counts.parse_infobox(SENATE, "senate")
        self.assertEqual((data["democrats"], data["republicans"]), ((52, 54), (44, 46)))

    def test_numbers_that_cannot_be_right_are_refused(self):
        self.assertIsNone(seat_counts.parse_infobox(HOUSE.replace("'''253'''", "'''430'''"), "house"))   # 430 + 157 > 435
        self.assertIsNone(seat_counts.parse_infobox(HOUSE.replace("party1 = Democratic Party (US)", "party1 = Republican Party (US)"), "house"))
        self.assertIsNone(seat_counts.parse_infobox(HOUSE.replace("'''253'''", "many"), "house"))
        self.assertIsNone(seat_counts.parse_infobox("not an infobox", "house"))
        self.assertIsNone(seat_counts.parse_infobox(None, "house"))
        self.assertIsNone(seat_counts.parse_infobox(SENATE.replace("52–54", "152–154"), "senate"))

    def test_a_house_count_that_disagrees_with_the_outlets_call_is_left_out(self):
        figures = {"house": seat_counts.parse_infobox(HOUSE, "house"), "senate": seat_counts.parse_infobox(SENATE, "senate")}
        ja, en = seat_counts.describe(figures, {"house": "democrats", "senate": "democrats"})
        self.assertEqual(ja, "下院 民主党253・共和党157（当確94.3%）、上院 民主党52〜54・共和党44〜46（未確定の議席あり）")
        self.assertEqual(en, "House Democrats 253, Republicans 157 (94.3% of seats called); Senate Democrats 52-54, Republicans 44-46 (some seats still uncalled)")
        ja, en = seat_counts.describe(figures, {"house": "republicans", "senate": "democrats"})
        self.assertNotIn("下院", ja)
        self.assertIn("上院", ja)


class RefreshTests(unittest.TestCase):
    def watch(self):
        return {"id": "w", "seats": {"pages": {"house": "House_page", "senate": "Senate_page"}}}

    def test_pages_are_read_at_most_every_twenty_minutes_and_the_last_good_figures_survive_a_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            db = event_results.connect(Path(folder) / "e.sqlite")
            calls = []
            def reader(page):
                calls.append(page)
                return HOUSE if page == "House_page" else SENATE
            seat_counts.refresh(db, self.watch(), NOW, reader)
            self.assertEqual(calls, ["House_page", "Senate_page"])
            seat_counts.refresh(db, self.watch(), NOW + timedelta(minutes=5), reader)
            self.assertEqual(len(calls), 2, "not again within twenty minutes")
            def broken(page):
                raise OSError("rate limited")
            seat_counts.refresh(db, self.watch(), NOW + timedelta(minutes=30), broken)
            self.assertEqual(seat_counts.stored(db, "w")["house"]["democrats"], 253)
            self.assertEqual(seat_counts.stored(db, "w")["senate"]["democrats"], (52, 54))

    def test_a_published_result_carries_the_seats_and_the_wikipedia_link(self):
        config = json.loads((Path(event_results.CONFIG_PATH)).read_text(encoding="utf-8"))
        feed = ("<rss><channel>" + "".join(
            f"<item><title>Democrats win the House and the Senate</title><link>https://example.com/{n}</link><pubDate>Wed, 04 Nov 2026 10:00:00 +0000</pubDate></item>" for n in range(1)) + "</channel></rss>").encode()
        for watch in config["watches"]:
            watch["from"] = "2026-11-01T00:00:00Z"; watch["until"] = "2026-11-20T00:00:00Z"
        config["watches"] = [w for w in config["watches"] if w["id"] == "us-midterm-2026-11-03"]
        config["feeds"] = [dict(f, publisher=name) for f, name in zip(config["feeds"][:3], ("Fox News", "CBS News", "NPR"))]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "e.sqlite"
            event_results.run_once(path, NOW, config, transport=lambda url: feed, seat_fetcher=lambda page: HOUSE if "House" in page else SENATE)
            with event_results.connect(path) as db:
                result = event_results.public_view(db)[0]
        self.assertIn("｜下院 民主党253・共和党157", result["resultJa"])
        self.assertIn("Wikipedia", result["detailJa"])
        self.assertTrue(any(source["publisher"].startswith("Wikipedia") for source in result["sources"]))


if __name__ == "__main__":
    unittest.main()
