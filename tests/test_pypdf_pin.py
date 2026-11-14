"""Nov 14: pypdf 6.10-6.12 split numbers inside PDFs ("980 . 8", "1 , 962. 1"), so a Nebius release stored by the monitor never contained its own figures and every deep
analysis / research copy / headline that quoted them failed the number check. pypdf 6.14.0 reads the same PDF as "980.8" and "1,962.1" (checked on the Nebius Q3 2026 release)."""
from pathlib import Path
import re
import unittest

REQUIREMENTS = Path(__file__).resolve().parents[1] / 'scripts/research/requirements.txt'


class PypdfPin(unittest.TestCase):
    def test_the_monitor_pins_a_pypdf_that_keeps_numbers_whole(self):
        match = re.search(r'^pypdf==(\d+)\.(\d+)\.(\d+)$', REQUIREMENTS.read_text(), re.M)
        self.assertIsNotNone(match, 'pypdf must stay pinned to one version')
        self.assertGreaterEqual(tuple(int(part) for part in match.groups()), (6, 14, 0))


if __name__ == '__main__':
    unittest.main()
