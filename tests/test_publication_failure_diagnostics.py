from contextlib import ExitStack, redirect_stdout
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))


PRIVATE = 'secret-token SELECT private_body FROM articles; article text\n{"forged":"log"}'


class PublicationFailureDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        # Discovery replaces research dependencies in test_research_service.
        # Import only at execution time so later tests patch the same modules.
        global service
        import service

    def diagnostic(self, error, lane="public-news-unavailable"):
        output = io.StringIO()
        with redirect_stdout(output):
            service.log_publication_failure(lane, error)
        text = output.getvalue()
        self.assertEqual(len(text.splitlines()), 1)
        self.assertLess(len(text.encode()), 256)
        self.assertNotIn(PRIVATE, text)
        value = json.loads(text)
        self.assertEqual(set(value), {
            "lane", "exceptionClass", "sqliteErrorCode", "sqliteErrorName",
        })
        return value

    def test_actual_sqlite_error_logs_only_native_class_and_codes(self):
        with sqlite3.connect(":memory:") as db:
            try:
                db.execute('SELECT * FROM "' + PRIVATE.replace('"', '""') + '"')
            except sqlite3.Error as error:
                self.assertIn(PRIVATE, str(error))
                value = self.diagnostic(error)
            else:
                self.fail("fixture must raise a SQLite error")
        self.assertEqual(value, {
            "lane": "public-news-unavailable", "exceptionClass": "OperationalError",
            "sqliteErrorCode": sqlite3.SQLITE_ERROR, "sqliteErrorName": "SQLITE_ERROR",
        })

    def test_native_extended_code_uses_canonical_name_not_supplied_text(self):
        error = sqlite3.OperationalError(PRIVATE)
        error.sqlite_errorcode = sqlite3.SQLITE_BUSY_SNAPSHOT
        error.sqlite_errorname = PRIVATE
        error.add_note(PRIVATE)
        error.__cause__ = ValueError(PRIVATE)
        self.assertEqual(self.diagnostic(error), {
            "lane": "public-news-unavailable", "exceptionClass": "OperationalError",
            "sqliteErrorCode": sqlite3.SQLITE_BUSY_SNAPSHOT,
            "sqliteErrorName": "SQLITE_BUSY_SNAPSHOT",
        })

    def test_missing_invalid_and_unbounded_codes_are_null(self):
        for candidate in (None, True, "5", PRIVATE, -1, 0, 999999999999999999999999, [], {}):
            with self.subTest(candidate=type(candidate).__name__):
                error = sqlite3.OperationalError(PRIVATE)
                if candidate is not None:
                    error.sqlite_errorcode = candidate
                error.sqlite_errorname = "SQLITE_" + PRIVATE
                value = self.diagnostic(error)
                self.assertEqual(value["exceptionClass"], "OperationalError")
                self.assertIsNone(value["sqliteErrorCode"])
                self.assertIsNone(value["sqliteErrorName"])

    def test_non_sqlite_exception_cannot_spoof_sqlite_metadata(self):
        for error in (ValueError(PRIVATE), TypeError(PRIVATE), OSError(PRIVATE)):
            with self.subTest(kind=type(error).__name__):
                error.sqlite_errorcode = sqlite3.SQLITE_BUSY
                error.sqlite_errorname = "SQLITE_BUSY"
                value = self.diagnostic(error)
                self.assertEqual(value["exceptionClass"], type(error).__name__)
                self.assertIsNone(value["sqliteErrorCode"])
                self.assertIsNone(value["sqliteErrorName"])

    def test_custom_names_message_formatters_and_failing_attributes_cannot_leak(self):
        def forbidden(*_args):
            raise AssertionError(PRIVATE)

        error_type = type(PRIVATE, (sqlite3.OperationalError,), {
            "__str__": forbidden, "__repr__": forbidden,
            "sqlite_errorcode": property(forbidden),
            "sqlite_errorname": property(forbidden),
        })
        value = self.diagnostic(error_type(PRIVATE), lane=PRIVATE)
        self.assertEqual(value, {
            "lane": "publication-unavailable", "exceptionClass": "OperationalError",
            "sqliteErrorCode": None, "sqliteErrorName": None,
        })

    def test_all_authorized_lanes_keep_fixed_schema_and_bounded_output(self):
        for lane in service.PUBLICATION_FAILURE_LANES:
            with self.subTest(lane=lane):
                self.assertEqual(self.diagnostic(RuntimeError(PRIVATE), lane)["lane"], lane)

    def test_workers_recover_and_keep_waits_and_independent_publication_calls(self):
        cases = (
            ("run_headline_translation", service.headline_translation, "headlines",
             "headline-translation-unavailable"),
            ("run_market_translation", service.x_market_news, "market",
             "market-translation-unavailable"),
            ("run_results", service.analyst_news, "results",
             "analyst-news-publication-unavailable"),
            ("run_official_research", service.official_research, "official",
             "official-research-unavailable"),
        )
        for method, failing_module, wake_name, lane in cases:
            with self.subTest(method=method), ExitStack() as stack:
                app = service.AutomaticMonitor.__new__(service.AutomaticMonitor)
                app.db_path = Path("fixture-never-opened.sqlite")
                app.stop_event = Mock()
                app.stop_event.is_set.side_effect = [False, False, False, False, True]
                wake = Mock()
                app.publication_wakes = {wake_name: wake}
                stack.enter_context(patch.dict(os.environ, {
                    "OFFICIAL_HEADLINE_TRANSLATION_ENABLED": "true",
                }))
                stack.enter_context(patch.object(service.headline_translation, "configuration", return_value={}))
                result = stack.enter_context(patch.object(service.market_results, "run_once"))
                direct = stack.enter_context(patch.object(service.x_market_news, "publish_direct_once"))
                syndication = stack.enter_context(patch.object(service.issuer_syndication, "run_once"))
                attempt = stack.enter_context(patch.object(
                    failing_module, "run_once", side_effect=[RuntimeError(PRIVATE), "idle"],
                ))
                output = stack.enter_context(redirect_stdout(io.StringIO()))
                self.assertIsNone(getattr(app, method)())
                self.assertEqual(attempt.call_count, 2)
                self.assertEqual(wake.clear.call_count, 2)
                self.assertEqual(wake.wait.call_args_list, [((5,),), ((5,),)])
                self.assertEqual(json.loads(output.getvalue()), {
                    "lane": lane, "exceptionClass": "RuntimeError",
                    "sqliteErrorCode": None, "sqliteErrorName": None,
                })
                self.assertEqual(result.call_count, 2 if method == "run_results" else 0)
                self.assertEqual(direct.call_count, 2 if method == "run_results" else 0)
                self.assertEqual(syndication.call_count, 2 if method == "run_official_research" else 0)

    def handler(self, path="/news"):
        handler = service.Handler.__new__(service.Handler)
        handler.path = path
        handler.server = SimpleNamespace(app=Mock())
        handler.authorized = Mock(return_value=True)
        handler.send_json = Mock()
        return handler

    def test_news_failure_keeps_existing_503_response_and_no_partial_content(self):
        handler = self.handler("/news?unused=" + PRIVATE)
        handler.app.public_news.side_effect = sqlite3.OperationalError(PRIVATE)
        with redirect_stdout(io.StringIO()) as output:
            handler.do_GET()
        handler.app.public_news.assert_called_once_with()
        handler.send_json.assert_called_once_with(503, {"ok": False, "error": "snapshot-unavailable"})
        self.assertEqual(json.loads(output.getvalue()), {
            "lane": "public-news-unavailable", "exceptionClass": "OperationalError",
            "sqliteErrorCode": None, "sqliteErrorName": None,
        })

    def test_success_keeps_response_and_emits_no_diagnostic(self):
        handler = self.handler()
        payload = {"ok": True, "enabled": False, "items": [], "officialUpdates": [{"body": PRIVATE}]}
        handler.app.public_news.return_value = payload
        with redirect_stdout(io.StringIO()) as output:
            handler.do_GET()
        handler.send_json.assert_called_once_with(200, payload)
        self.assertIs(handler.send_json.call_args.args[1], payload)
        self.assertEqual(output.getvalue(), "")

    def test_unauthorized_news_and_other_endpoint_failures_have_no_new_diagnostic(self):
        handler = self.handler()
        handler.authorized.return_value = False
        with redirect_stdout(io.StringIO()) as output:
            handler.do_GET()
        handler.app.public_news.assert_not_called()
        handler.send_json.assert_called_once_with(401, {"ok": False, "error": "unauthorized"})
        self.assertEqual(output.getvalue(), "")
        for path in ("/snapshot", "/live", "/price-targets", "/posts"):
            with self.subTest(path=path), redirect_stdout(io.StringIO()) as output:
                handler = self.handler(path)
                handler.app.public_snapshot.side_effect = RuntimeError(PRIVATE)
                handler.app.public_price_targets.side_effect = RuntimeError(PRIVATE)
                handler.app.posts_queue.side_effect = RuntimeError(PRIVATE)
                handler.do_GET()
                handler.send_json.assert_called_once_with(503, {"ok": False, "error": "snapshot-unavailable"})
                self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
