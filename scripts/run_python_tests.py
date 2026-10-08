"""Run the Python test suite on a pinned clock.

Many fixtures are dated (e.g. a release published 2026-09-30) and the code
under test keeps only the last 7 days. On the real clock those tests started
failing one by one as the calendar moved on (October 7-8). The suite now runs
as if the current time were RESEARCH_TEST_NOW (default below), still ticking.
Move the default forward only together with fixture dates.
"""
import datetime as _dt
import os
import sys
import time as _time
import unittest

PINNED = os.environ.get("RESEARCH_TEST_NOW", "2026-10-08T06:00:00+00:00")
_offset = _dt.datetime.fromisoformat(PINNED).timestamp() - _time.time()
_real_time = _time.time


def _time_now():
    return _real_time() + _offset


class _PinnedDatetime(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return _dt.datetime.fromtimestamp(_time_now(), tz)

    @classmethod
    def utcnow(cls):
        return _dt.datetime.utcfromtimestamp(_time_now())

    @classmethod
    def today(cls):
        return _dt.datetime.fromtimestamp(_time_now())


class _PinnedDate(_dt.date):
    @classmethod
    def today(cls):
        return _dt.date.fromtimestamp(_time_now())


_time.time = _time_now
_dt.datetime = _PinnedDatetime
_dt.date = _PinnedDate

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
