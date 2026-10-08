"""Run the Python test suite on the pinned test clock (scripts/test_clock)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_clock"))
import research_test_clock  # noqa: E402,F401

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
