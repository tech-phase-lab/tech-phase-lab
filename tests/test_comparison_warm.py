"""The comparison refresh clock: off without settings, one authorized call per run, secret never in the result."""
import io
import json
import unittest

import comparison_warm

SECRET = "s" * 40


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ComparisonWarmTest(unittest.TestCase):
    def test_off_unless_https_url_and_long_secret(self):
        self.assertIsNone(comparison_warm.config({}))
        self.assertIsNone(comparison_warm.config({"COMPARISON_WARM_URL": "http://techphase.app/api/research/compare/warm", "COMPARISON_WARM_SECRET": SECRET}))
        self.assertIsNone(comparison_warm.config({"COMPARISON_WARM_URL": "https://techphase.app/api/research/compare/warm", "COMPARISON_WARM_SECRET": "short"}))
        self.assertEqual(comparison_warm.run_once({}), {"status": "off"})

    def test_one_call_with_bearer_secret_and_no_secret_in_result(self):
        seen = []

        def opener(request, timeout):
            seen.append((request.full_url, request.get_header("Authorization"), timeout))
            return FakeResponse(json.dumps({"ok": True, "spent": 255, "tickers": ["AAPL", "MSFT"]}).encode())

        env = {"COMPARISON_WARM_URL": "https://techphase.app/api/research/compare/warm", "COMPARISON_WARM_SECRET": SECRET}
        result = comparison_warm.run_once(env, opener)
        self.assertEqual(result, {"status": "ok", "spent": 255, "tickers": 2})
        self.assertEqual(seen, [("https://techphase.app/api/research/compare/warm", f"Bearer {SECRET}", 55)])
        self.assertNotIn(SECRET, json.dumps(result))

    def test_failure_is_reported_without_details(self):
        def opener(request, timeout):
            raise TimeoutError("slow " + SECRET)

        env = {"COMPARISON_WARM_URL": "https://techphase.app/x", "COMPARISON_WARM_SECRET": SECRET}
        self.assertEqual(comparison_warm.run_once(env, opener), {"status": "error", "error": "TimeoutError"})

    def test_waits_until_just_after_the_next_minute(self):
        self.assertEqual(comparison_warm.seconds_to_next_minute(120.0), 61)
        self.assertEqual(comparison_warm.seconds_to_next_minute(179.5), 1.5)


if __name__ == "__main__":
    unittest.main()
