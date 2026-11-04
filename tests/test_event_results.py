"""Big-event results (an election): only a clear call counts, two different outlets must agree, conflicts are held, owner can withdraw."""
import json
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import event_results as ev

CONFIG = ev.load_config()
WATCH = CONFIG["watches"][0]
OPEN = datetime(2026, 11, 4, 8, 0, tzinfo=timezone.utc)
claim = lambda party, chamber: {"party": party, "chamber": chamber}


def rss(*items):
    rows = "".join(f"<item><title>{t}</title><link>{u}</link><pubDate>{d}</pubDate></item>" for t, u, d in items)
    return f"<?xml version='1.0'?><rss><channel>{rows}</channel></rss>".encode()


def at(hour, minute=0, day=4):
    return datetime(2026, 11, day, hour, minute, tzinfo=timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


class ShapeTests(unittest.TestCase):
    def test_only_a_stated_result_counts_not_a_hedge_a_single_seat_or_another_party(self):
        yes = [("Democrats win the House, CBS News projects", "democrats", "house"),
               ("Democrats win control of both the House and the Senate", "democrats", "senate"),
               ("Democrats win control of both the House and the Senate", "democrats", "house"),
               ("Democrats take control of the Senate in a stunning night", "democrats", "senate"),
               ("Democrats flip the House", "democrats", "house"), ("Democrats narrowly win the House", "democrats", "house"),
               ("Democrats will win the House, networks project", "democrats", "house"),
               ("Democrats win House, Republicans keep Senate", "democrats", "house"),
               ("Democrats win House, Republicans keep Senate", "republicans", "senate"),
               ("Republicans hold the Senate", "republicans", "senate"), ("GOP retains control of the House", "republicans", "house"),
               ("Election 2026 live updates: Democrats win Senate majority", "democrats", "senate")]
        no = [("Democrats win House, Republicans keep Senate", "democrats", "senate"), ("Democrats win Senate seat in Iowa", "democrats", "senate"),
              ("Democrats could win the House, polls show", "democrats", "house"), ("Can Democrats win the House?", "democrats", "house"),
              ("Democrats win White House bid", "democrats", "house"), ("Democrat wins Senate race in Maine", "democrats", "senate"),
              ("Democrats lose the House", "democrats", "house"), ("Democrats need to win the House", "democrats", "house"),
              ("Democrats still fighting to win the Senate", "democrats", "senate"), ("x" * 400 + " Democrats win the House", "democrats", "house")]
        for title, party, chamber in yes:
            self.assertTrue(ev.reads_as_call(title, claim(party, chamber)), title)
        for title, party, chamber in no:
            self.assertFalse(ev.reads_as_call(title, claim(party, chamber)), title)

    def test_every_date_form_real_feeds_use_is_read_including_GMT_and_Z(self):
        forms = ["Wed, 04 Nov 2026 13:20:00 GMT", "Wed, 04 Nov 2026 13:20:00 +0000", "Wed, 04 Nov 2026 08:20:00 -0500", "Wed, 04 Nov 2026 13:20:00 UT"]
        for form in forms:
            rows = ev.parse_feed(rss(("Headline", "https://a.example/1", form)))
            self.assertEqual(len(rows), 1, form)
            self.assertEqual(rows[0][2].strftime("%Y-%m-%d %H:%M"), "2026-11-04 13:20", form)
        atom = lambda stamp: f"<feed xmlns='http://www.w3.org/2005/Atom'><entry><title>H</title><link href='https://b.example/x'/><updated>{stamp}</updated></entry></feed>".encode()
        for stamp in ["2026-11-04T13:20:00Z", "2026-11-04T13:20:00+00:00", "2026-11-04T22:20:00+09:00"]:
            self.assertEqual(ev.parse_feed(atom(stamp))[0][2].strftime("%Y-%m-%d %H:%M"), "2026-11-04 13:20", stamp)

    def test_rss_and_atom_bodies_are_read_and_unsafe_ones_are_refused(self):
        rows = ev.parse_feed(rss(("Democrats win the House", "https://a.example/1", at(3)), ("bad link", "http://a.example/2", at(3)), ("no date", "https://a.example/3", "")))
        self.assertEqual([r[0] for r in rows], ["Democrats win the House"])
        atom = b"<feed xmlns='http://www.w3.org/2005/Atom'><entry><title>Republicans hold the Senate</title><link href='https://b.example/x'/><updated>2026-11-04T03:00:00Z</updated></entry></feed>"
        self.assertEqual(ev.parse_feed(atom)[0][1], "https://b.example/x")
        with self.assertRaises(ET.ParseError):
            ev.parse_feed(b"not xml")


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "e.sqlite"
        self.addCleanup(self.temp.cleanup)

    def run_feeds(self, headlines, now=OPEN):
        """headlines: {publisher: [(title, hour)]}"""
        urls = {feed["url"]: feed["publisher"] for feed in CONFIG["feeds"]}

        def transport(url):
            name = urls[url]
            if name not in headlines:
                raise OSError("unreachable")
            return rss(*[(title, f"https://{name.replace(' ', '').lower()}.example/{index}", at(hour)) for index, (title, hour) in enumerate(headlines[name])])
        return ev.run_once(self.path, now, CONFIG, transport)

    def view(self):
        with ev.connect(self.path) as db:
            return ev.public_view(db), ev.owner_view(db)


class ResultTests(Base):
    def test_one_outlet_is_not_enough_two_different_outlets_publish_the_result(self):
        self.run_feeds({"CBS News": [("Democrats win the House, CBS News projects", 3)]})
        self.assertEqual(self.view()[0], [])
        self.run_feeds({"CBS News": [("Democrats win the House, CBS News projects", 3)], "NPR": [("Democrats win the House", 4)]})
        public = self.view()[0]
        self.assertEqual(len(public), 1)
        row = public[0]
        self.assertEqual(row["resultJa"], "民主党が下院で多数を獲得（2社が当確を報道）")
        self.assertEqual(row["id"], "us-midterm-2026-11-03")
        self.assertEqual({s["publisher"] for s in row["sources"]}, {"CBS News", "NPR"})
        self.assertTrue(all(s["url"].startswith("https://") for s in row["sources"]))
        self.assertIn("認定は数週間", row["detailJa"])
        self.assertEqual(row["releasedAt"][:13], "2026-11-04T04", "the time the second outlet had said it")

    def test_house_and_senate_are_combined_and_no_number_is_ever_in_the_result(self):
        self.run_feeds({"CBS News": [("Democrats win control of both the House and the Senate", 4)], "BBC News": [("Democrats win the Senate", 5), ("Democrats take the House", 3)],
                        "The Guardian": [("Democrats win House and Senate, networks say", 5)]})
        row = self.view()[0][0]
        self.assertTrue(row["resultJa"].startswith("民主党が下院・上院とも多数を獲得"))
        self.assertTrue(row["resultEn"].startswith("Democrats win control of both the House and the Senate"))
        self.assertEqual(len(row["sources"]), 3)
        self.assertIsNone(re.search(r"\d+\s*(?:議席|seats)", row["resultJa"] + row["detailJa"] + row["resultEn"] + row["detailEn"]))

    def test_hedged_headlines_and_headlines_outside_the_window_never_count(self):
        self.run_feeds({"CBS News": [("Democrats could win the House, polls show", 3)], "NPR": [("Can Democrats win the House?", 3)], "BBC News": [("Democrats win Senate seat in Iowa", 3)]})
        self.assertEqual(self.view()[0], [])
        before = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
        self.assertIsNone(self.run_feeds({"CBS News": [("Democrats win the House", 3)]}, now=before), "no watch is open yet")
        self.run_feeds({"CBS News": [("Democrats win the House", 3)], "NPR": [("Democrats win the House", 3)]}, now=datetime(2026, 11, 20, tzinfo=timezone.utc))
        self.assertEqual(self.view()[0], [])

    def test_two_parties_both_said_to_win_the_same_chamber_is_held_not_published(self):
        self.run_feeds({"CBS News": [("Democrats win the House", 3)], "NPR": [("Democrats win the House", 3)],
                        "BBC News": [("Republicans hold the House", 3)], "The Guardian": [("Republicans keep the House", 3)]})
        public, owner = self.view()
        self.assertEqual(public, [])
        self.assertEqual(owner["results"][0]["state"], "conflict")

    def test_an_unreachable_outlet_is_noted_and_the_others_still_count_and_a_withdrawn_result_stays_down(self):
        self.run_feeds({"CBS News": [("Democrats win the House", 3)], "NPR": [("Democrats win the House", 3)]})
        _, owner = self.view()
        status = {feed["publisher"]: feed for feed in owner["feeds"]}
        self.assertEqual((status["CBS News"]["ok"], status["The Guardian"]["ok"]), (1, 0))
        self.assertIn("OSError", status["The Guardian"]["error"])
        with ev.connect(self.path) as db:
            ev.withdraw(db, {"id": "us-midterm-2026-11-03"})
            with self.assertRaises(ValueError):
                ev.withdraw(db, {"id": "nope"})
        self.run_feeds({"CBS News": [("Democrats win the House", 3)], "NPR": [("Democrats win the House", 3)], "BBC News": [("Democrats win the House", 3)]})
        self.assertEqual(self.view()[0], [], "a withdrawn result is never published again")

    def test_the_watch_file_is_valid(self):
        self.assertTrue(CONFIG["feeds"] and all(f["url"].startswith("https://") for f in CONFIG["feeds"]))
        self.assertTrue(ev.active(CONFIG, OPEN))
        self.assertFalse(ev.active(CONFIG, datetime(2026, 12, 1, tzinfo=timezone.utc)))
        for watch in CONFIG["watches"]:
            self.assertGreaterEqual(watch["requirePublishers"], 2)
            self.assertTrue(all(c["ja"] and c["en"] for c in watch.get("claims", [])))
            self.assertTrue(watch.get("claims") or watch.get("numeric"), "a watch states what to look for")


ADP = CONFIG["watches"][1]
ADP_OPEN = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
MARKETS = [feed for feed in CONFIG["feeds"] if feed["group"] == "markets"]


class FigureTests(Base):
    """ADP's private payrolls (Nov 4): a figure is published only when two different outlets give the very same signed figure."""
    def run_markets(self, headlines, now=ADP_OPEN):
        urls = {feed["url"]: feed["publisher"] for feed in CONFIG["feeds"]}

        def transport(url):
            name = urls[url]
            if name not in headlines:
                raise OSError("unreachable")
            return rss(*[(title, f"https://{name.replace(' ', '').lower()}.example/{i}", at(hour, minute)) for i, (title, hour, minute) in enumerate(headlines[name])])
        return ev.run_once(self.path, now, CONFIG, transport)

    def test_the_figure_is_read_only_from_a_plain_statement_of_the_result(self):
        spec = ADP["numeric"]
        yes = [("Private employers added 42,000 jobs in October, ADP says", 42000), ("ADP: Private payrolls fell by 32,000 in October", -32000), ("ADP private payrolls +42K in October", 42000),
               ("ADP shows private employers shed 12,500 jobs", -12500), ("ADP: private employers cut 30K jobs in October", -30000),
               ("Private employers added 42,000 jobs in October, below the 90,000 expected, ADP says", 42000), ("Private payrolls rose 38,000 vs 90,000 forecast, ADP reports", 38000),
               ("ADP private payrolls rose 42,000, up from 10,000 revised in September", 42000), ("ADP: private payrolls rise by 42,000 in October", 42000),
               ("ADP: private payrolls fall by 12,000 in October", -12000), ("Private employers lose 5,000 jobs in October, ADP says", -5000)]
        no = ["Economists expect ADP to show private employers added 90,000 jobs", "ADP report preview: private payrolls likely rose by 40,000",
              "ADP weekly: private employers added an average of 11,250 jobs a week", "ADP: hiring slowed in October", "ADP: jobs growth slows to 42,000 from 133,000",
              "Private employers added 42,000 jobs in October", "x" * 400 + " ADP private employers added 42,000 jobs"]
        for title, figure in yes:
            self.assertEqual(ev.read_figure(title, spec), figure, title)
        for title in no:
            self.assertIsNone(ev.read_figure(title, spec), title)

    def test_two_different_outlets_with_the_same_figure_publish_one_does_not(self):
        self.run_markets({"CNBC": [("Private employers added 42,000 jobs in October, ADP says", 13, 20)]})
        self.assertEqual(self.view()[0], [])
        self.run_markets({"CNBC": [("Private employers added 42,000 jobs in October, ADP says", 13, 20)], "MarketWatch": [("ADP: private payrolls rise by 42,000 in October", 13, 25)]})
        row = self.view()[0][0]
        self.assertEqual(row["id"], "adp-2026-10")
        self.assertEqual(row["resultJa"], "民間の雇用者数 +42,000人（2社が同じ数字を報道）")
        self.assertEqual({s["publisher"] for s in row["sources"]}, {"CNBC", "MarketWatch"})
        self.assertIn("ADPの公式発表で確認してください", row["detailJa"])
        self.assertEqual(row["releasedAt"][:16], "2026-11-04T13:25")

    def test_different_figures_from_different_outlets_never_publish_and_two_solid_but_different_figures_are_held(self):
        self.run_markets({"CNBC": [("Private employers added 42,000 jobs, ADP says", 13, 20)], "MarketWatch": [("ADP: private payrolls rise by 41,000", 13, 25)]})
        self.assertEqual(self.view()[0], [], "42,000 and 41,000 are not the same figure")
        self.run_markets({"CNBC": [("Private employers added 42,000 jobs, ADP says", 13, 20)], "MarketWatch": [("ADP: private payrolls rise by 42,000", 13, 25)],
                          "Yahoo Finance": [("ADP private employers shed 42,000 jobs", 13, 30)], "BBC News Business": [("ADP: private payrolls fall by 42,000", 13, 31)]})
        public, owner = self.view()
        self.assertEqual(public, [])
        self.assertEqual(owner["results"][0]["state"], "conflict")

    def test_the_two_groups_of_feeds_do_not_mix_and_a_headline_before_the_release_is_ignored(self):
        self.run_markets({"CNBC": [("Private employers added 42,000 jobs, ADP says", 12, 0)], "MarketWatch": [("ADP: private payrolls rise by 42,000", 12, 5)]})
        self.assertEqual(self.view()[0], [], "published before the release time")
        # While both watches are open, a politics headline never counts for ADP and a markets headline never counts for the election.
        self.run_markets({"CBS News": [("Democrats win the House", 13, 40)], "NPR": [("Democrats win the House", 13, 41)],
                          "CNBC": [("Democrats win the House", 13, 40)], "MarketWatch": [("Democrats win the House", 13, 41)]})
        public = self.view()[0]
        self.assertEqual([row["id"] for row in public], ["us-midterm-2026-11-03"])
        self.assertEqual({s["publisher"] for s in public[0]["sources"]}, {"CBS News", "NPR"})
        self.assertTrue(MARKETS and len({f["publisher"] for f in MARKETS}) == len(MARKETS), "each outlet is one feed, so one outlet can never count twice")
        self.assertFalse({f["publisher"] for f in MARKETS} & {f["publisher"] for f in CONFIG["feeds"] if f["group"] == "politics"}, "no outlet name is shared between the groups")

    def test_real_headlines_from_the_night_of_the_release_are_read_the_weekly_figure_and_the_vague_ones_are_not(self):
        spec = ADP["numeric"]
        for title, figure in [("Private companies added 86,000 jobs in October, slightly higher than expected, ADP says", 86000),
                              ("ADP National Employment Report: Private-Sector Employment Increased by 86,000 Jobs in October", 86000),
                              ("ADP October employment report: 86,000 jobs added", 86000), ("ADP: private employers lost 33,000 jobs in October", -33000)]:
            self.assertEqual(ev.read_figure(title, spec), figure, title)
        for title in ["ADP estimates private payrolls fell by 11,250 per week in 4 weeks ended Oct. 25", "Strong Private Payrolls for October", "US private payrolls rise in October, ADP says"]:
            self.assertIsNone(ev.read_figure(title, spec), title)

    def test_a_news_search_feed_names_each_outlet_and_the_issuers_own_release_stands_alone(self):
        def search(*items):
            rows = "".join(f"<item><title>{t} - {o}</title><link>https://{o.replace(' ', '').lower()}.example/{i}</link><pubDate>{at(14, i)}</pubDate><source url='https://x'>{o}</source></item>" for i, (t, o) in enumerate(items))
            return f"<?xml version='1.0'?><rss><channel>{rows}</channel></rss>".encode()
        search_urls = {feed["url"] for feed in CONFIG["feeds"] if feed["publisher"].startswith("Google News ADP")}

        def run(*items):
            def transport(url):
                if url in search_urls:
                    return search(*items)
                raise OSError("unreachable")
            return ev.run_once(self.path, ADP_OPEN, CONFIG, transport)
        run(("Private companies added 86,000 jobs in October, ADP says", "CNBC"))
        self.assertEqual(self.view()[0], [], "one outlet is not enough")
        run(("Private companies added 86,000 jobs in October, ADP says", "CNBC"), ("ADP October employment report: 86,000 jobs added", "Stock Titan"))
        row = self.view()[0][0]
        self.assertEqual(row["resultJa"], "民間の雇用者数 +86,000人（2社が同じ数字を報道）")
        self.assertEqual({s["publisher"] for s in row["sources"]}, {"CNBC", "Stock Titan"})

    def test_the_issuers_release_from_its_distributor_counts_alone_but_the_same_words_from_anyone_else_do_not(self):
        title = "ADP National Employment Report: Private-Sector Employment Increased by 86,000 Jobs in October"

        def run(outlet):
            urls = {feed["url"] for feed in CONFIG["feeds"] if feed["publisher"] == "Google News ADP 2"}

            def transport(url):
                if url in urls:
                    return f"<?xml version='1.0'?><rss><channel><item><title>{title} - {outlet}</title><link>https://example.com/r</link><pubDate>{at(14, 0)}</pubDate><source url='https://x'>{outlet}</source></item></channel></rss>".encode()
                raise OSError("unreachable")
            return ev.run_once(self.path, ADP_OPEN, CONFIG, transport)
        run("Some Blog")
        self.assertEqual(self.view()[0], [], "a copy on a blog is one outlet")
        run("PR Newswire")
        row = self.view()[0][0]
        self.assertTrue(row["resultJa"].startswith("民間の雇用者数 +86,000人"))
        self.assertEqual(row["sources"][0]["publisher"], "ADP（公式発表）")


class HttpTests(Base):
    def test_the_owner_lists_results_and_feeds_and_can_withdraw_through_the_editor_token(self):
        import os
        import threading
        from unittest.mock import patch
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        import service
        self.run_feeds({"CBS News": [("Democrats win the House", 3)], "NPR": [("Democrats win the House", 3)]})
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_port}"

        def call(path, token, payload=None):
            request = Request(base + path, data=None if payload is None else json.dumps(payload).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urlopen(request, timeout=10) as response:
                return json.load(response)
        try:
            with patch.dict(os.environ, {"RESEARCH_API_TOKEN": "member-api-token", "RESEARCH_EDITOR_TOKEN": "editor-api-token"}):
                with self.assertRaises(HTTPError) as denied:
                    call("/admin/event-results", "member-api-token")
                self.assertEqual(denied.exception.code, 401)
                listed = call("/admin/event-results", "editor-api-token")
                self.assertEqual(listed["results"][0]["state"], "published")
                self.assertTrue(any(feed["publisher"] == "CBS News" for feed in listed["feeds"]))
                with self.assertRaises(HTTPError) as missing:
                    call("/admin/event-results/withdraw", "editor-api-token", {"id": "nope"})
                self.assertEqual(missing.exception.code, 404)
                self.assertEqual(call("/admin/event-results/withdraw", "editor-api-token", {"id": "us-midterm-2026-11-03"})["withdrawn"], "us-midterm-2026-11-03")
                self.assertEqual(call("/admin/event-results", "editor-api-token")["results"][0]["state"], "withdrawn")
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
        self.assertEqual(self.view()[0], [])


if __name__ == "__main__":
    unittest.main()
