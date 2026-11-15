"""Pre-flight for the deep-analysis number check on REAL earnings releases (no AI is called).

Nov 14 (NBIS): a correct "$980.8 million" was rejected because the table said "In USD $ millions 980.8", and nobody noticed for 44 hours.
This runs the deterministic check over every stored release fixture: a figure of a table whose unit header is declared (in the same excerpt or in
another one), written the way the model writes it ("$X million"), must pass for the excerpt that holds it, and the same figure in a wrong scale must not.
"""
import glob
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import deep_analysis  # noqa: E402
import factual_validation  # noqa: E402
import official_research  # noqa: E402

FIXTURES = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', '*results*.txt')))
PER_RELEASE = 10
OTHER_SCALE = {'thousand': 'billion', 'million': 'billion', 'billion': 'thousand'}


def holding_excerpt(excerpts, figure):
    pattern = re.compile(r'(?<![\d.,])' + re.escape(figure) + r'(?![\d,]|\.\d)')
    return next((text for text in excerpts.values() if pattern.search(text)), None)


def sample(pairs, count):
    """An even spread over the release, deterministic."""
    if len(pairs) <= count:
        return pairs
    step = len(pairs) / count
    return [pairs[int(i * step)] for i in range(count)]


def passes(sentence, quote, release):
    try:
        factual_validation.validate_numbers(sentence, deep_analysis.table_scaled_figures(release, within=quote) + '\n' + quote)
        return True
    except ValueError:
        return False


class DeepAnalysisPreflight(unittest.TestCase):
    def test_correct_table_figures_pass_in_their_declared_unit_and_not_in_another(self):
        tested, releases = 0, 0
        for path in FIXTURES:
            with open(path, encoding='utf-8') as handle:
                release = handle.read()
            excerpts = official_research.evidence_excerpts(release)
            scaled = [tuple(item.rsplit(' ', 1)) for item in deep_analysis.table_scaled_figures(release).split('; ') if item]
            pairs = [(figure, unit) for figure, unit in scaled if holding_excerpt(excerpts, figure)]
            if not pairs:
                continue
            releases += 1
            for figure, unit in sample(pairs, PER_RELEASE):
                quote = holding_excerpt(excerpts, figure)
                name = '%s: %s %s' % (os.path.basename(path), figure, unit)
                self.assertTrue(passes('Revenue was $%s %s.' % (figure, unit), quote, release), name)
                self.assertTrue(passes('Revenue was €%s %s.' % (figure, unit), quote, release), name + ' (euro)')
                wrong = OTHER_SCALE[unit]
                if not re.search(re.escape(figure) + r'\s*' + wrong, release, re.I):  # unless the release itself prints that
                    self.assertFalse(passes('Revenue was $%s %s.' % (figure, wrong), quote, release), name + ' in the wrong scale')
                tested += 1
        self.assertGreaterEqual(releases, 35, 'too few releases with a declared table unit were checked')
        self.assertGreaterEqual(tested, 300)

    def test_figures_printed_with_their_unit_in_the_text_pass_for_every_release(self):
        # Prose releases (TSMC "NT$759.69 billion", ASML "EUR 7.5 billion", Nebius headline) need no table unit.
        # a guidance range ("$3.9 - $4.0 billion") is quoted whole, as the model writes it
        money = r'(?:US\$|NT\$|EUR\s|€|\$)\s?'
        literal = re.compile(r'(?:' + money + r'\d[\d,]*(?:\.\d+)?\s?-\s?)?' + money + r'(\d[\d,]*(?:\.\d+)?)\s(million|billion)\b')
        checked = 0
        for path in FIXTURES:
            with open(path, encoding='utf-8') as handle:
                release = handle.read()
            excerpts = official_research.evidence_excerpts(release)
            for match in sample(list(literal.finditer(release)), 5):
                quote = next((text for text in excerpts.values() if match.group(0) in text), None)
                if quote is None:
                    continue
                sentence = 'Revenue was %s.' % match.group(0)
                self.assertTrue(passes(sentence, quote, release), '%s: %s' % (os.path.basename(path), match.group(0)))
                checked += 1
        self.assertGreaterEqual(checked, 40)

    def test_every_tracked_release_fixture_is_covered(self):
        self.assertGreaterEqual(len(FIXTURES), 40)


if __name__ == '__main__':
    unittest.main()
