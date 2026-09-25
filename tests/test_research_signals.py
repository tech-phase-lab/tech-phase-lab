"""Synthetic regression cases for private multi-company intake, never live news."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import monitor
import signals
import service


def feed(title="ClusterMAX review", body="Nebius and CoreWeave receive Platinum ratings.", url="https://newsletter.semianalysis.com/p/test"):
    return f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
      <title>{title}</title><link>{url}</link><pubDate>Wed, 23 Sep 2026 21:20:29 GMT</pubDate>
      <content:encoded><![CDATA[<p>{body}</p>]]></content:encoded></item></channel></rss>'''.encode()


class SignalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "test.sqlite"
        self.db = monitor.connect(self.path)
        self.feed = signals.SOURCES[0]
        self.doc = next(s for s in signals.SOURCES if s["id"] == "nebius-preemptible")
        self.tickers = list(monitor.PROVIDERS)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def check_feed(self, content, **response):
        return signals.check(self.db, self.feed, self.tickers, lambda *_: {"body": content, **response})

    def test_signal_route_errors_have_safe_specific_diagnostic_codes(self):
        cases = {
            "unexpected-signal-content-type": "signal-content-type",
            "not-a-signal-feed": "signal-invalid-feed-root",
            "signal-index-no-articles": "signal-no-article-links",
            "signal-article-body-limit": "signal-article-body-invalid",
            "x-api-daily-limit": "x-api-daily-limit",
            "x-api-paced": "x-api-paced",
            "x-api-daily-limit-invalid": "x-api-budget-invalid",
        }
        for message, expected in cases.items():
            with self.subTest(message=message):
                self.assertEqual(monitor.source_error_code(ValueError(message)), expected)

    def test_body_only_multicompany_association_and_no_false_ticker(self):
        self.assertEqual(len(signals.ALIASES), 22)
        items = signals.parse(self.feed, feed(), self.tickers)
        self.assertEqual(set(items[0]["matches"]), {"NBIS", "CRWV"})
        self.assertNotIn("NBIS", items[0]["title"])
        self.assertEqual(signals.match_companies("a robot arm will be useful", self.tickers), {})
        self.assertEqual(set(signals.match_companies("$ARM, Arm Holdings and $MU", self.tickers)), {"ARM", "MU"})

    def test_baseline_restart_and_repeat_do_not_create_new_events(self):
        self.assertEqual(self.check_feed(feed())["events"], 1)
        self.db.close()
        self.db = monitor.connect(self.path)
        self.assertEqual(self.check_feed(feed())["events"], 0)
        queue = signals.queue(self.db)
        self.assertEqual(queue["counts"]["baseline"], 1)
        self.assertEqual(queue["counts"]["new"], 0)
        self.check_feed(feed(url="https://newsletter.semianalysis.com/p/new"))
        self.assertEqual(signals.queue(self.db)["counts"]["new"], 1)
        self.assertEqual(len(signals.queue(self.db, ticker="CRWV")["items"]), 2)
        self.assertEqual(len(signals.queue(self.db, ticker="MU")["items"]), 0)

    def test_same_url_document_change_and_navigation_noise(self):
        text = "Preemptible VMs support configurable pricing policies. " * 4
        def check(text, nav="Home"):
            return signals.check(self.db, self.doc, self.tickers, lambda *_: {
                "body": f"<html><nav>{nav}</nav><main><p>{text}</p></main></html>".encode()})
        check(text)
        self.assertEqual(check(text, "New navigation NVIDIA")["events"], 0)
        self.assertEqual(check(text + "Follow spot price is now available.")["events"], 1)
        items = signals.queue(self.db, view="changed")["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["tickers"], ["NBIS"])
        self.assertIn("Follow spot price", items[0]["diff"])
        self.assertIsNone(items[0]["publishedAt"])

    def test_unchanged_document_backfills_date_only_without_new_event(self):
        self.assertEqual(self.check_feed(feed())["events"], 1)
        items = signals.parse(self.feed, feed(), self.tickers)
        items[0]["publishedOn"] = "2026-09-23"
        count = signals.save(
            self.db, self.feed, items, {}, signals.stamp(), "backfill-test", 1
        )
        queue = signals.queue(self.db)
        self.assertEqual(count, 0)
        self.assertEqual(queue["counts"]["all"], 1)
        self.assertEqual(queue["items"][0]["publishedOn"], "2026-09-23")

    def test_persisted_validators_and_304(self):
        self.check_feed(feed(), etag='"v1"')
        self.db.close()
        self.db = monitor.connect(self.path)
        def unchanged(source, validators):
            self.assertEqual(validators["etag"], '"v1"')
            return {"not_modified": True}
        result = signals.check(self.db, self.feed, self.tickers, unchanged)
        self.assertEqual(result["status"], "unchanged")
        self.assertEqual(signals.queue(self.db)["counts"]["all"], 1)

    def test_configuration_change_invalidates_validators(self):
        self.check_feed(feed(), etag='"v1"')
        def changed_config(source, validators):
            self.assertEqual(validators, {})
            return {"body": feed(body="Micron launches a memory product.")}
        signals.check(self.db, self.feed, ["MU"], changed_config)
        self.assertEqual(signals.queue(self.db, ticker="MU")["items"][0]["eventKind"], "baseline")

    def test_failed_initial_fetch_does_not_establish_baseline_and_retries_back_off(self):
        def failure(*_):
            raise HTTPError(self.feed["url"], 429, "limit", {"Retry-After": "900"}, None)
        result = signals.check(self.db, self.feed, self.tickers, failure)
        self.assertEqual(result["error"], "http-429")
        self.assertEqual(signals.due(self.db, [self.feed]), [])
        self.check_feed(feed())
        self.assertEqual(signals.queue(self.db)["counts"]["baseline"], 1)
        self.assertIsNone(signals.queue(self.db)["routes"][0]["error"])

    def test_x_api_attempt_budget_is_persistent_bounded_and_redacted(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120}
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {
            "X_API_ENABLED": "true", "X_BEARER_TOKEN": "secret-token",
            "X_API_DAILY_REQUEST_LIMIT": "2",
        }, clear=False):
            first = signals.reserve_x_api_request(self.db, source, now)
            second = signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12))
            self.assertEqual(first["attemptsLast24Hours"], 1)
            self.assertEqual(second["attemptsLast24Hours"], 2)
            with self.assertRaises(signals.XApiDailyLimit) as blocked:
                signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12, minutes=1))
            self.assertEqual(blocked.exception.retry_at, "2026-09-26T01:00:00+00:00")
            self.db.executemany(
                "INSERT INTO signal_x_request_attempts(source_id,attempted_at) VALUES('x-test',?)",
                [("not-a-time",), ((now + timedelta(days=30)).isoformat(),)],
            )
            self.db.commit()
            usage = signals.x_api_usage(self.db, now + timedelta(hours=12, minutes=1), sources=[])
            self.assertEqual(usage["attemptsLast24Hours"], 2)
            self.assertNotIn("token", json.dumps(usage).lower())

    def test_x_api_plan_exposes_only_bounded_aggregate_demand(self):
        sources = [
            {"id": "x-fast", "format": "x-api", "intervalSeconds": 120,
             "query": "secret-query", "url": "https://example.invalid"},
            {"id": "x-slow", "format": "x-api", "intervalSeconds": 3600},
            {"id": "free", "format": "rss", "intervalSeconds": 5},
        ]
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "100"}, clear=False):
            plan = signals.x_api_request_plan(sources)
        self.assertEqual(plan["sourceCount"], 2)
        self.assertEqual(plan["scope"], "analyst-price-target-or-earnings")
        self.assertEqual(plan["configuredMaxRequestsPerDay"], 744)
        self.assertEqual(plan["localMaxRequestsPerDay"], 100)
        self.assertTrue(plan["budgetCapped"])
        self.assertEqual(plan["minimumSpacingSeconds"], 864)
        self.assertEqual(plan["minimumSourceSpacingSeconds"], 1728)
        serialized = json.dumps(plan)
        self.assertNotIn("secret-query", serialized)
        self.assertNotIn("example.invalid", serialized)

    def test_mu_earnings_window_increases_polling_only_during_release(self):
        sources = [source for source in signals.SOURCES if source.get("format") == "x-api"]
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "2300"}):
            plan = signals.x_api_request_plan(sources)
        self.assertEqual(plan["configuredMaxRequestsPerDay"], 2286)
        self.assertFalse(plan["budgetCapped"])
        self.assertFalse(plan["pacingEnabled"])
        source = sources[0]
        for moment, expected in [
            ("2026-09-30T19:29:59+00:00", 120),
            ("2026-09-30T19:30:00+00:00", 60),
            ("2026-09-30T20:49:59+00:00", 60),
            ("2026-09-30T20:50:00+00:00", 120),
        ]:
            with self.subTest(moment=moment):
                self.assertEqual(
                    signals.source_interval_seconds(source, datetime.fromisoformat(moment)),
                    expected,
                )
        with patch.object(signals, "stamp", return_value="2026-09-30T19:35:00+00:00"):
            signals.check(self.db, source, self.tickers, lambda *_: {"_items": []})
        next_at = self.db.execute(
            "SELECT next_check_at FROM signal_routes WHERE id=?", (source["id"],)
        ).fetchone()[0]
        self.assertEqual(next_at, "2026-09-30T19:36:00+00:00")

    def test_x_api_budget_is_evenly_paced_and_rotates_due_sources(self):
        sources = [
            {"id": source_id, "format": "x-api", "intervalSeconds": 120}
            for source_id in ("x-a", "x-b", "x-c")
        ]
        due_ids = [source["id"] for source in sources]
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "100"}, clear=False), \
                patch.object(signals, "SOURCES", sources):
            first = signals.reserve_x_api_request(
                self.db, sources[0], now, eligible_source_ids=due_ids
            )
            self.assertEqual(first["pacedUntil"], "2026-09-25T01:14:24+00:00")
            with self.assertRaises(signals.XApiPacing) as early:
                signals.reserve_x_api_request(
                    self.db, sources[1], now + timedelta(minutes=1), eligible_source_ids=due_ids
                )
            self.assertEqual(early.exception.retry_at, "2026-09-25T01:14:24+00:00")
            with self.assertRaises(signals.XApiPacing):
                signals.reserve_x_api_request(
                    self.db, sources[0], now + timedelta(seconds=864), eligible_source_ids=due_ids
                )
            signals.reserve_x_api_request(
                self.db, sources[1], now + timedelta(seconds=864), eligible_source_ids=due_ids
            )
            signals.reserve_x_api_request(
                self.db, sources[2], now + timedelta(seconds=1728), eligible_source_ids=due_ids
            )
        attempts = [row["source_id"] for row in self.db.execute(
            "SELECT source_id FROM signal_x_request_attempts ORDER BY attempted_at"
        )]
        self.assertEqual(attempts, ["x-a", "x-b", "x-c"])

    def test_x_api_rolling_window_excludes_exactly_twenty_four_hours_old_attempt(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120}
        now = datetime(2026, 9, 25, 1, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "2"}, clear=False):
            signals.reserve_x_api_request(self.db, source, now)
            signals.reserve_x_api_request(self.db, source, now + timedelta(hours=12))
            usage = signals.reserve_x_api_request(self.db, source, now + timedelta(hours=24))
        self.assertEqual(usage["attemptsLast24Hours"], 2)

    def test_x_api_budget_block_sets_next_check_without_transport(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120,
                  "name": "X test", "kind": "publisher-update", "reuse": "review-required"}
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "1"}, clear=False):
            signals.reserve_x_api_request(self.db, source)
            usage = signals.x_api_usage(self.db)
            result = signals.check(
                self.db, source, self.tickers,
                lambda *_: (_ for _ in ()).throw(signals.XApiDailyLimit(usage["nextAvailableAt"])),
            )
        self.assertEqual(result["error"], "x-api-daily-limit")
        route = self.db.execute("SELECT next_check_at FROM signal_routes WHERE id='x-test'").fetchone()
        self.assertEqual(route["next_check_at"], usage["nextAvailableAt"])

    def test_signal_worker_reserves_x_budget_before_network(self):
        source = {"id": "x-test", "format": "x-api", "intervalSeconds": 120,
                  "name": "X test", "kind": "publisher-update", "reuse": "review-required"}
        self.db.close()
        with patch.dict(os.environ, {"X_API_DAILY_REQUEST_LIMIT": "1"}, clear=False):
            with monitor.connect(self.path) as db:
                signals.reserve_x_api_request(db, source)
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
            with patch.object(signals, "acquire") as acquire:
                app.check_signal_source(source)
                acquire.assert_not_called()
            with monitor.connect(self.path) as db:
                route = db.execute(
                    "SELECT error,next_check_at FROM signal_routes WHERE id='x-test'"
                ).fetchone()
                usage = signals.x_api_usage(db)
        self.db = monitor.connect(self.path)
        self.assertEqual(route["error"], "x-api-daily-limit")
        self.assertEqual(route["next_check_at"], usage["nextAvailableAt"])
        self.assertEqual(usage["attemptsLast24Hours"], 1)

    def test_invalid_xml_is_not_a_successful_empty_feed(self):
        result = self.check_feed(b"<rss><channel><item>")
        self.assertEqual(result["status"], "error")
        self.assertEqual(signals.queue(self.db)["counts"]["all"], 0)

    def test_atom_feeds_and_no_match_are_valid(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Memory systems</title>
        <link rel="alternate" href="https://newsletter.semianalysis.com/p/atom"/>
        <published>2026-09-23T12:00:00Z</published><content type="html">Micron and NVIDIA.</content></entry></feed>'''
        self.assertEqual(set(signals.parse(self.feed, atom, self.tickers)[0]["matches"]), {"MU", "NVDA"})
        self.assertEqual(self.check_feed(feed(body="An unrelated travel update."))["matchedItems"], 0)

    def test_untrusted_urls_entities_and_tracking_variants(self):
        for url in ["http://newsletter.semianalysis.com/p/a", "https://127.0.0.1/", "https://user:password@newsletter.semianalysis.com/p/a", "https://newsletter.semianalysis.com.evil.test/a"]:
            with self.assertRaises(ValueError): signals.safe_url(url, self.feed)
            self.assertEqual(signals.parse(self.feed, feed(url=url), self.tickers), [])
        self.assertEqual(signals.safe_url("https://newsletter.semianalysis.com/p/a?utm_source=x#top", self.feed), "https://newsletter.semianalysis.com/p/a")
        with self.assertRaisesRegex(ValueError, "unsafe-signal-xml"):
            signals.parse(self.feed, b'<!DOCTYPE rss [<!ENTITY a "boom">]><rss/>', self.tickers)

    def test_editor_auth_and_no_public_snapshot_leak(self):
        self.check_feed(feed())
        app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        token = "editor-token-at-least-24-characters"
        try:
            url = f"http://127.0.0.1:{server.server_port}/admin/signals"
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": token}):
                with self.assertRaises(HTTPError) as failed:
                    urlopen(url)
                self.assertEqual(failed.exception.code, 401)
                with urlopen(Request(url, headers={"Authorization": "Bearer " + token})) as response:
                    payload = json.load(response)
                self.assertEqual(payload["items"][0]["tickers"], ["CRWV", "NBIS"])
                self.assertFalse(payload["publicationEnabled"])
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": ""}):
                with self.assertRaises(HTTPError):
                    urlopen(Request(url, headers={"Authorization": "Bearer " + token}))
            self.assertNotIn("ClusterMAX", json.dumps(monitor.snapshot(self.db)))
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_html_index_body_matching_and_unassigned_articles(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<main><a href="/news/test">Infrastructure update</a><a href="/root-article" class="FeaturedGrid-module__content">Other</a><a href="https://evil.test/news/a">No</a></main>'}
            text = ("Nebius and NVIDIA collaborate on infrastructure. " if route["url"].endswith("test")
                    else "A new model evaluation method is available. ") * 6
            return {"body": ('<html><nav>Micron</nav><main><h1>Infrastructure update</h1><p>' + text + '</p></main></html>').encode(), "etag": '"v1"'}
        with patch.object(signals, "fetch", side_effect=request) as fetched:
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result["events"], 2)
        self.assertEqual(fetched.call_count, 3)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue["counts"]["baseline"], 2)
        assigned = next(item for item in queue["items"] if item["tickers"])
        self.assertEqual(assigned["tickers"], ["NBIS", "NVDA"])
        self.assertIsNone(assigned["publishedAt"])
        self.assertTrue(any(not item["tickers"] for item in queue["items"]))

    def test_html_index_deferred_baselines_restart_and_new_arrivals(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        urls = [f"/news/item-{i}" for i in range(5)]
        calls = []
        def request(route, validators):
            calls.append(route["url"])
            if route["url"] == source["url"]:
                return {"body": ''.join(f'<a href="{url}">Article</a>' for url in urls).encode()}
            return {"body": ('<main><h1>Example</h1><p>' + 'Nebius builds infrastructure. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])["routes"][0]["pendingArticles"], 2)
            self.db.close()
            self.db = monitor.connect(self.path)
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])["counts"]["baseline"], 5)
            urls.insert(0, '/news/new')
            signals.check(self.db, source, self.tickers)
        self.assertEqual(signals.queue(self.db, sources=[source])["counts"]["new"], 1)
        self.assertEqual(calls.count(source["url"] + '/item-0'), 1)

    def test_html_index_article_errors_remain_visible_and_retry_as_baseline(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            raise HTTPError(route["url"], 403, "forbidden", {}, None)
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue["routes"][0]["error"], "article-fetch-failed:1")
        self.assertEqual(queue["routes"][0]["pendingArticles"], 1)
        self.assertEqual(queue["counts"]["all"], 0)
        state = json.loads(self.db.execute("SELECT body FROM signal_index_state").fetchone()[0])
        child = state['children'][source['url'] + '/test']
        self.assertTrue(child['baseline'])
        self.assertEqual(child['error'], 'http-403')
        self.assertEqual(queue['routes'][0]['articleErrors'][0]['url'], source['url'] + '/test')
        self.assertEqual(queue['routes'][0]['articleErrors'][0]['error'], 'http-403')
        self.assertTrue(queue['routes'][0]['articleErrors'][0]['nextCheckAt'])

    def test_html_index_unchanged_index_still_rechecks_article_changes(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        version = 'v1'
        def request(route, validators):
            if route["url"] == source["url"]:
                return {"body": b'<a href="/news/test">Article</a>'}
            return {"body": ('<main><h1>Example</h1><p>' + 'Nebius builds infrastructure. ' * 10 + version + '</p></main>').encode()}
        with patch.object(signals, "fetch", side_effect=request):
            signals.check(self.db, source, self.tickers)
            state = json.loads(self.db.execute("SELECT body FROM signal_index_state").fetchone()[0])
            state['children'][source['url'] + '/test']['next_check'] = ''
            self.db.execute("UPDATE signal_index_state SET body=?", (json.dumps(state),))
            self.db.commit()
            version = 'v2'
            signals.check(self.db, source, self.tickers)
        queue = signals.queue(self.db, sources=[source], view='changed')
        self.assertEqual(len(queue['items']), 1)
        self.assertIn('v2', queue['items'][0]['diff'])

    def test_html_index_empty_shell_is_not_healthy(self):
        source = next(s for s in signals.SOURCES if s["id"] == "anthropic-news")
        with patch.object(signals, "fetch", return_value={"body": b'<main>Enable JavaScript</main>'}):
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(signals.queue(self.db, sources=[source])['counts']['all'], 0)

    def test_public_next_listing_discovers_body_without_article_anchors(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'nebius-blog')
        payload = {'props': {'pageProps': {'initialListing': {'items': [
            {'url': '/blog/posts/platinum'}, {'url': 'https://evil.test/blog/posts/trap'}]}}}}
        requested = []
        def request(route, validators):
            requested.append(route['url'])
            if route['url'] == source['url']:
                return {'body': ('<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + '</script>').encode()}
            return {'body': ('<main><h1>Platinum rating</h1><p>' + 'We improved cluster reliability. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        self.assertEqual(len(requested), 2)
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['tickers'], ['NBIS'])
        self.assertEqual(item['eventKind'], 'baseline')
        self.assertIsNone(item['publishedAt'])

    def test_palantir_sitemap_extracts_only_english_shareholder_letter_next_data(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'palantir-shareholder-letters')
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.palantir.com/q2-2026-letter/</loc></url>
          <url><loc>https://www.palantir.com/q2-2026-letter/fr/</loc></url>
          <url><loc>https://www.palantir.com/q2-2026-letter/en/</loc></url>
          <url><loc>https://www.palantir.com/newsroom/media/not-a-letter/</loc></url>
          <url><loc>https://evil.test/q2-2026-letter/en/</loc></url>
        </urlset>'''
        payload = {'props': {'pageProps': {'page': {'fields': {
            'pageTitle': 'Q2 2026 | Letter to Shareholders',
            'blocks': [{'fields': {'text': {'nodeType': 'document', 'content': [
                {'nodeType': 'paragraph', 'content': [
                    {'nodeType': 'text', 'value': 'August 3, 2026', 'marks': [], 'data': {}}]},
                {'nodeType': 'paragraph', 'content': [
                    {'nodeType': 'text', 'value': 'Our revenue grew as customers adopted the Artificial Intelligence Platform. ' * 4,
                     'marks': [], 'data': {}}]},
            ]}}, 'sys': {'createdAt': 'do-not-extract'}}],
        }}}}}
        requested = []
        def request(route, validators):
            requested.append(route['url'])
            if route['url'] == source['url']:
                return {'body': sitemap}
            return {'body': ('<script id="__NEXT_DATA__" type="application/json">'
                             + json.dumps(payload) + '</script>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        self.assertEqual(requested, [source['url'], 'https://www.palantir.com/q2-2026-letter/en/'])
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['title'], 'Q2 2026 | Letter to Shareholders')
        self.assertEqual(item['tickers'], ['PLTR'])
        self.assertEqual(item['publishedOn'], '2026-08-03')
        self.assertIsNone(item['publishedAt'])
        self.assertIn('August 3, 2026', item['excerpt'])
        self.assertNotIn('do-not-extract', item['excerpt'])

    def test_next_data_rich_text_rejects_excessive_nesting(self):
        import html_signals
        nested = {'nodeType': 'text', 'value': 'evidence'}
        for _ in range(21):
            nested = {'content': [nested]}
        with self.assertRaisesRegex(ValueError, 'signal-article-next-data-limit'):
            html_signals.rich_text(nested)

    def test_visible_article_date_rejects_impossible_calendar_date(self):
        import html_signals
        with self.assertRaisesRegex(ValueError, 'signal-article-published-date'):
            html_signals.visible_date(
                'February 30, 2026', r'\b[A-Z][a-z]+ [0-9]{1,2}, 20[0-9]{2}\b', '%B %d, %Y'
            )

    def test_signal_schema_migrates_date_only_publication_column(self):
        self.db.execute('''CREATE TABLE signal_events (
          id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
          sha TEXT NOT NULL, previous_sha TEXT, title TEXT NOT NULL,
          tickers_json TEXT NOT NULL, matches_json TEXT NOT NULL,
          event_kind TEXT NOT NULL, published_at TEXT, observed_at TEXT NOT NULL,
          excerpt TEXT NOT NULL, diff TEXT NOT NULL, truncated INTEGER NOT NULL,
          UNIQUE(source_id,url,sha,previous_sha)
        )''')
        signals.schema(self.db)
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(signal_events)')}
        self.assertIn('published_on', columns)

    def test_specific_article_body_excludes_related_stories_and_duplicate_title(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'coreweave-blog')
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': b'<a href="/blog/example">Read</a>'}
            return {'body': ('<main><h1>Storage update</h1><article><div class="article-content-container w-richtext"><p>'
                             + 'We improved archive storage. ' * 10
                             + '</p></div></article><h1>Storage update</h1><aside>NVIDIA and Micron related stories</aside></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
        item = signals.queue(self.db, sources=[source])['items'][0]
        self.assertEqual(item['title'], 'Storage update')
        self.assertEqual(item['tickers'], ['CRWV'])
        self.assertNotIn('related stories', item['excerpt'])

    def test_new_article_retry_precedes_baseline_backlog_and_respects_backoff(self):
        from html_signals import collect
        source = next(s for s in signals.SOURCES if s['id'] == 'anthropic-news')
        base = source['url'] + '/'
        children = {base + f'old-{i}': {'baseline': True} for i in range(8)}
        for i in range(4):
            children[base + f'new-{i}'] = {
                'baseline': False, 'checked': '2026-01-01T00:00:00.000+00:00',
                'next_check': '', 'failures': 1, 'error': 'http-503'}
        children[base + 'new-3']['next_check'] = '2099-01-01T00:00:00.000+00:00'
        calls = []
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': ''.join(f'<a href="{url}">Story</a>' for url in children).encode()}
            calls.append(route['url'])
            return {'body': ('<main><h1>Infrastructure</h1><p>'
                             + 'Nebius infrastructure update. ' * 10 + '</p></main>').encode()}
        response = collect(source, {'index_state': json.dumps({
            'initialized': True, 'children': children})}, self.tickers, request)
        self.assertEqual(calls, [base + 'new-0', base + 'new-1', base + 'old-0'])
        self.assertEqual([item['baseline'] for item in response['_items']], [False, False, True])
        state = json.loads(response['index_state'])
        calls.clear()
        collect(source, {'index_state': json.dumps(state)}, self.tickers, request)
        self.assertEqual(calls, [base + 'new-2', base + 'old-1', base + 'old-2'])
        self.assertNotIn(base + 'new-3', calls)

    def test_sitemap_baselines_survive_restart_and_new_url_is_prioritized(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'micron-blog')
        urls = [f'https://www.micron.com/about/blog/memory/dram/article-{i}' for i in range(130)]
        urls += ['https://www.micron.com/about/blog/blog-authors/author-bio/person',
                 'https://www.micron.com/about/blog/memory/dram',
                 'https://evil.test/about/blog/memory/dram/attack']
        calls = []
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                 + ''.join(f'<url><loc>{u}</loc></url>' for u in urls) + '</urlset>').encode()}
            calls.append(route['url'])
            return {'body': ('<main><h1>Memory update</h1><p>' + 'Micron memory innovation. ' * 10 + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            signals.check(self.db, source, self.tickers)
            self.assertEqual(signals.queue(self.db, sources=[source])['routes'][0]['pendingArticles'], 127)
            self.db.close(); self.db = monitor.connect(self.path)
            urls.append('https://www.micron.com/about/blog/memory/dram/new-arrival')
            calls.clear()
            signals.check(self.db, source, self.tickers)
        self.assertTrue(calls[0].endswith('/new-arrival'))
        self.assertEqual(len(calls), 3)
        queue = signals.queue(self.db, sources=[source])
        self.assertEqual(queue['counts']['baseline'], 5)
        self.assertEqual(queue['counts']['new'], 1)

    def test_sitemap_rejects_entities_and_nested_sitemaps(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'micron-blog')
        for body in [b'<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset/>',
                     b'<sitemapindex><sitemap><loc>https://evil.test/a.xml</loc></sitemap></sitemapindex>']:
            with patch.object(signals, 'fetch', return_value={'body': body}):
                self.assertEqual(signals.check(self.db, source, self.tickers)['status'], 'error')
        self.assertEqual(signals.queue(self.db, sources=[source])['counts']['all'], 0)

    def test_specific_title_skips_generic_site_heading(self):
        from html_signals import NewsHTML
        parser = NewsHTML('article-body', 'story-title')
        parser.feed('<h1>All blogs</h1><h1 class="story-title">New chips</h1>'
                    '<div class="article-body"><p>New memory platform</p></div><aside>NVIDIA</aside>')
        self.assertEqual(parser.title, ['New chips'])
        self.assertNotIn('NVIDIA', ''.join(parser.selected))

    def test_long_article_is_bounded_and_flagged_instead_of_retried_forever(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'anthropic-news')
        def request(route, validators):
            if route['url'] == source['url']:
                return {'body': b'<a href="/news/long-report">Report</a>'}
            return {'body': ('<main><h1>Long report</h1><p>' + 'Nebius infrastructure. ' * 10000
                             + '</p></main>').encode()}
        with patch.object(signals, 'fetch', side_effect=request):
            result = signals.check(self.db, source, self.tickers)
        self.assertEqual(result['status'], 'ok')
        queue = signals.queue(self.db, sources=[source])
        self.assertTrue(queue['items'][0]['truncated'])
        self.assertEqual(queue['routes'][0]['articleErrors'], [])
        self.assertEqual(queue['routes'][0]['pendingArticles'], 0)

    def test_worker_is_opt_in_and_stops(self):
        with patch.dict(os.environ, {"RESEARCH_SIGNALS_ENABLED": ""}):
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        with patch.object(signals, "fetch") as fetch:
            app.run_signals()
            fetch.assert_not_called()
        with patch.dict(os.environ, {"RESEARCH_SIGNALS_ENABLED": "1"}):
            app = service.AutomaticMonitor(self.path, Path(self.temp.name) / "snapshot.json")
        def fetch(*_):
            app.stop_event.set()
            return {"body": feed()}
        with patch.object(signals, "fetch", side_effect=fetch):
            app.run_signals()
        self.assertEqual(app.signal_queue()["counts"]["baseline"], 1)


if __name__ == "__main__":
    unittest.main()
