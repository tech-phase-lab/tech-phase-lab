import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MonitorImageFiles(unittest.TestCase):
    def test_prior_backfill_coverage_file_is_in_the_image(self):
        # earnings_prior_backfill.py reads lib/research/calendar-coverage.json on the monitor; without it every pass failed
        # with FileNotFoundError in production (Nov 28).
        dockerfile = (ROOT / 'Dockerfile.research-monitor').read_text()
        self.assertIn('COPY lib/research/calendar-coverage.json lib/research/calendar-coverage.json', dockerfile)


if __name__ == '__main__':
    unittest.main()
