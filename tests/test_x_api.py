"""Synthetic tests for the disabled-by-default X adapter; no live X requests."""
import os
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import monitor
import signals
import x_api


class XApiTests(unittest.TestCase):
    def test_requested_market_accounts_only_accept_the_requested_topics(self):
        samples = {
            'TrendSpider': [('S&P 500 rebalance: additions $VYLR $TWLO; removals $CTVA $WDB', 'index-membership'), ('$MRNA will join Nasdaq 100, replacing $WBD', 'index-membership'), ('Nasdaq trading tools: add a chart indicator for $MRNA', None), ('$MU reports Q4 earnings', None)],
            'Barchart': [('US 30-year Treasury yield rises to its highest since 2002', 'government-bonds'), ('Japanese 10-year bond yields reach a 30-year high', 'government-bonds'), ('Brent crude oil rises 3%', 'crude-oil'), ('Treasury Secretary announces tariffs', None), ('$MU reports earnings', None)],
        }
        for account, posts in samples.items():
            source = next(s for s in signals.SOURCES if s['id'] == 'x-' + account.lower())
            self.assertLessEqual(len(source['query']), 512)
            self.assertIn('-is:reply', source['query'])
            payload = {'includes': {'users': [{'id': '1', 'username': account}]}, 'data': [
                {'id': str(9000 + n), 'author_id': '1', 'text': text} for n, (text, _) in enumerate(posts)]}
            accepted = x_api.parse_response(source, payload, list(monitor.PROVIDERS))
            self.assertEqual([p['text'] for p in accepted], [text for text, topic in posts if topic])
            for text, topic in posts:
                self.assertEqual(x_api.market_topic(account, text), topic)

    def test_blocked_supplemental_routes_do_not_remove_company_ir(self):
        for source_id in ('marvell-blog', 'tsmc-press-center'):
            self.assertIs(next(s for s in signals.SOURCES if s['id'] == source_id)['enabled'], False)
        self.assertIn('MRVL', monitor.PROVIDERS)
        self.assertIn('TSM', monitor.PROVIDERS)
        self.assertIsNot(next(s for s in signals.SOURCES if s['id'] == 'marvell-investor-news').get('enabled'), False)

    def setUp(self):
        self.source = {**next(s for s in signals.SOURCES if s["id"] == "x-tipranks"), "enabled": True}

    def test_rating_start_and_changes_without_numeric_targets(self):
        payload = {"data": [{"id": "6001", "author_id": "1", "text": "Nebius $NBIS initiated with an Outperform at William Blair"}, {"id": "6002", "author_id": "1", "text": "$MU downgraded to Neutral"}, {"id": "6003", "author_id": "1", "text": "$NBIS interesting stock today"}], "includes": {"users": [{"id": "1", "username": "TipRanks"}]}}
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        self.assertEqual(len(items), 2)
        self.assertTrue(all(word in self.source["query"] for word in ("initiated", "upgraded", "downgraded", "reiterated")))

    def test_the_fly_is_not_requested_or_accepted_even_from_stale_route_config(self):
        for source in signals.SOURCES:
            if source.get('format') == 'x-api':
                self.assertNotIn('theflynews',source['query'].lower())
                self.assertNotIn('theflynews',{a.lower() for a in source['accounts']})
        self.assertFalse(any(source['id']=='x-thefly' for source in signals.SOURCES))
        stale={**self.source,'accounts':['theflynews']}
        payload={'data':[{'id':'999','author_id':'1','text':'$MU Q4 earnings Revenue $54.23B'}],
                 'includes':{'users':[{'id':'1','username':'theflynews'}]}}
        self.assertEqual(x_api.parse_response(stale,payload,list(monitor.PROVIDERS)),[])

    def test_x_source_scope_adds_requested_x_only_companies(self):
        x_sources = [source for source in signals.SOURCES if source.get("format") == "x-api" and not source.get("marketTopics")]
        added = {"LITE", "COHR", "VST", "IREN", "ALAB", "APH", "INTC",
                 "AMAT", "SIMO", "AAOI", "META"}
        self.assertEqual({source["accounts"][0].lower() for source in x_sources},
                         {"tipranks", "wallstengine", "nebiusai"})
        self.assertEqual({ticker for source in x_sources for ticker in source["tickers"]},
                         set(monitor.PROVIDERS) | added)
        for source in x_sources:
            if source.get("officialUpdates"):
                self.assertEqual(source["accounts"], ["nebiusai"])
                self.assertEqual(source["tickers"], ["NBIS"])
                continue
            self.assertLessEqual(len(source["query"]), 512)
            self.assertEqual(set(source["extraTickers"]), added)
            self.assertEqual(len(source["tickers"]), 33)
            if source["id"] != "x-wallstengine":
                self.assertTrue(all(f"${ticker}" in source["query"] for ticker in added))
            self.assertEqual(source["intervalSeconds"], 30 if source["id"] == "x-wallstengine" else 60)
            self.assertEqual(source["maxResults"], 30)
            self.assertIn('"price target"', source["query"])
            self.assertIn('"target price"', source["query"])
            self.assertIn('"PT to"', source["query"])
            self.assertIn('"quarterly results"', source["query"])

    def test_x_sources_are_disabled_without_both_explicit_flag_and_token(self):
        with patch.dict(os.environ, {"X_API_ENABLED": "true", "X_BEARER_TOKEN": ""}, clear=False):
            self.assertNotIn(self.source, signals.enabled_sources())
        with patch.dict(os.environ, {"X_API_ENABLED": "false", "X_BEARER_TOKEN": "secret"}, clear=False):
            self.assertNotIn(self.source, signals.enabled_sources())

    def test_only_configured_publishers_and_ticker_matches_are_retained(self):
        payload = {
            "data": [
                {"id": "1001", "author_id": "1", "created_at": "2026-09-25T00:00:00Z",
                 "text": "Micron price target raised to $500"},
                {"id": "1002", "author_id": "2", "created_at": "2026-09-25T00:01:00Z",
                 "text": "Unrelated market note"},
                {"id": "1003", "author_id": "3", "created_at": "2026-09-25T00:02:00Z",
                 "text": "$NBIS price target raised to $250"},
                {"id": "1004", "author_id": "1", "created_at": "2026-09-25T00:03:00Z",
                 "text": "$MU releases new product lineup"},
                {"id": "1005", "author_id": "1", "created_at": "2026-09-25T00:04:00Z",
                 "text": "$NBIS analyst lifts PT to $399"},
            ],
            "includes": {"users": [
                {"id": "1", "username": "TipRanks"},
                {"id": "2", "username": "TipRanks"},
                {"id": "3", "username": "unapproved_account"},
            ]},
        }
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["url"], "https://x.com/TipRanks/status/1001")
        self.assertIn("MU", items[0]["matches"])
        self.assertEqual(items[1]["url"], "https://x.com/TipRanks/status/1005")

    def test_fetched_x_post_reaches_private_editorial_queue(self):
        payload = {
            "data": [{"id": "1001", "author_id": "1", "created_at": "2026-09-25T00:00:00Z",
                      "text": "Micron price target raised to $500"}],
            "includes": {"users": [{"id": "1", "username": "TipRanks"}]},
        }
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        with patch.dict(os.environ, {"X_API_ENABLED": "true", "X_BEARER_TOKEN": "test-token"}):
            with patch.object(x_api, "fetch_posts", return_value={"_items": items}):
                with sqlite3.connect(":memory:") as db:
                    db.row_factory = sqlite3.Row
                    result = signals.check(db, self.source, list(monitor.PROVIDERS))
                    self.assertEqual(result["status"], "ok")
                    self.assertEqual(result["matchedItems"], 1)
                    queue = signals.queue(db, ticker="MU")
                    self.assertEqual(queue["counts"]["baseline"], 1)
                    self.assertEqual(queue["items"][0]["url"], "https://x.com/TipRanks/status/1001")

    def test_wall_st_engine_post_is_kept_only_for_a_monitored_company(self):
        source = next(s for s in signals.SOURCES if s["id"] == "x-wallstengine")
        payload = {"data": [
            {"id": "2001", "author_id": "2", "text": "$NBIS price target raised to $399"},
            {"id": "2002", "author_id": "2", "text": "$XYZ price target raised to $20"},
        ], "includes": {"users": [{"id": "2", "username": "wallstengine"}]}}
        items = x_api.parse_response(source, payload, list(monitor.PROVIDERS))
        self.assertEqual([item["url"] for item in items], ["https://x.com/wallstengine/status/2001", "https://x.com/wallstengine/status/2002"])

    def test_earnings_posts_are_kept_separate_from_target_changes_and_previews(self):
        source = self.source
        payload = {"data": [
            {"id": "3001", "author_id": "1", "text": "$MU reports Q2 earnings, revenue rose 25%"},
            {"id": "3002", "author_id": "1", "text": "$MU earnings preview: revenue is expected to rise"},
            {"id": "3003", "author_id": "1", "text": "$MU price target raised to $500"},
            {"id": "3004", "author_id": "1", "text": "$NBIS quarterly results: revenue beat forecasts"},
        ], "includes": {"users": [{"id": "1", "username": "TipRanks"}]}}
        self.assertEqual([item["url"] for item in x_api.parse_response(source, payload, list(monitor.PROVIDERS))],
                         ["https://x.com/TipRanks/status/3001", "https://x.com/TipRanks/status/3003",
                          "https://x.com/TipRanks/status/3004"])

    def test_x_only_tickers_accept_targets_and_earnings_but_not_other_posts(self):
        payload = {"data": [
            {"id": "4101", "author_id": "1", "text": "$LITE price target raised to $400"},
            {"id": "4102", "author_id": "1", "text": "$COHR reports quarterly results"},
            {"id": "4103", "author_id": "1", "text": "$VST opens a new power plant"},
            {"id": "4104", "author_id": "1", "text": "$XYZ price target raised to $20"},
            {"id": "4105", "author_id": "1", "text": "$IREN price target raised to $70"},
            {"id": "4106", "author_id": "1", "text": "$META earnings beat expectations"},
            {"id": "4107", "author_id": "1", "text": "$INTC launches new chips"},
        ], "includes": {"users": [{"id": "1", "username": "TipRanks"}]}}
        items = x_api.parse_response(self.source, payload, list(monitor.PROVIDERS))
        self.assertEqual([list(item["matches"]) for item in items],
                         [["LITE"], ["COHR"], ["XYZ"], ["IREN"], ["META"]])
        self.assertIn("VST", signals.X_EXTRA_TICKERS)

    def test_pagination_keeps_high_watermark_until_every_page_is_consumed(self):
        import io, json
        from email.message import Message
        from urllib.parse import urlsplit, parse_qs
        requests = []
        pages = [{"meta":{"newest_id":"9000","next_token":"page2"}}, {"meta":{"newest_id":"8000"}}]
        class Response(io.BytesIO):
            headers = Message()
        Response.headers['Content-Type']='application/json'
        class Opener:
            def open(self, request, timeout):
                requests.append(parse_qs(urlsplit(request.full_url).query))
                return Response(json.dumps(pages.pop(0)).encode())
        with patch.dict(os.environ, {"X_API_ENABLED":"true","X_BEARER_TOKEN":"synthetic"}):
            first=x_api.fetch_posts(self.source, [], lambda:Opener(), {'index_state':json.dumps({'sinceId':'7000'})})
            cursor=json.loads(first['cursor_update'])
            self.assertEqual(cursor['sinceId'],'7000')
            self.assertEqual(cursor['newestId'],'9000')
            second=x_api.fetch_posts(self.source, [], lambda:Opener(), {'index_state':first['cursor_update']})
            self.assertEqual(json.loads(second['cursor_update']), {'sinceId':'9000'})
        self.assertEqual(requests[1]['next_token'],['page2'])
        self.assertEqual(requests[1]['since_id'],['7000'])
        self.assertNotIn('start_time', requests[1])
        self.assertEqual(requests[0]['post.fields'],['created_at,author_id,lang,note_post'])

    def test_direct_adapter_call_fails_closed(self):
        with patch.dict(os.environ, {"X_API_ENABLED": "false", "X_BEARER_TOKEN": "secret"}, clear=False):
            with self.assertRaisesRegex(ValueError, "x-api-disabled"):
                x_api.fetch_posts(self.source, list(monitor.PROVIDERS), opener_factory=lambda: self.fail("network called"))


if __name__ == "__main__":
    unittest.main()
