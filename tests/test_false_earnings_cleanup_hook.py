import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "research"))
import service  # noqa: E402


class Hook(unittest.TestCase):
    def test_runs_once_only_when_asked(self):
        with tempfile.TemporaryDirectory() as d:
            app = service.AutomaticMonitor.__new__(service.AutomaticMonitor)
            app.db_path = str(Path(d) / "monitor.sqlite")
            import threading
            app.db_lock = threading.Lock()
            self.assertIsNone(app.run_false_earnings_cleanup(env={}))
            calls = []
            import false_earnings_cleanup
            orig = false_earnings_cleanup.main
            false_earnings_cleanup.main = lambda argv: calls.append(argv) or 0
            try:
                env = {"FALSE_EARNINGS_CLEANUP": "apply", "CLEANUP_CONFIRM": "COHR,LRCX"}
                self.assertEqual(app.run_false_earnings_cleanup(env=env), 0)
                self.assertIsNone(app.run_false_earnings_cleanup(env=env))
            finally:
                false_earnings_cleanup.main = orig
            self.assertEqual(len(calls), 1)
            self.assertIn("--apply", calls[0])
            self.assertTrue((Path(d) / "false-earnings-cleanup.done").exists())


if __name__ == "__main__":
    unittest.main()
