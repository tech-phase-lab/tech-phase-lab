from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import issuer_result_flash as flash
import release_extras

FIXTURES = Path(__file__).parent / 'fixtures'


def fixture(name):
    return (FIXTURES / name).read_text()


class ReleaseExtras(unittest.TestCase):
    """Nov 23 (owner: the results card was "unusable"): more figures from the company's own release, each as the release states it."""

    def extras(self, ticker, name):
        text = fixture(name)
        base = flash.PROFILES[ticker]['parse'](text)
        out = release_extras.supplement(text, base)
        # the table parser's figures are never replaced, and keep their order
        self.assertEqual([f for f in out['facts'] if f in base['facts']], base['facts'])
        keys = [f[0] for f in out['facts']]
        guidance = [i for i, k in enumerate(keys) if k.startswith('guidance-')]
        self.assertTrue(all(i >= len(keys) - len(guidance) for i in guidance), 'the outlook stays last')
        return [f for f in out['facts'] if f not in base['facts']]

    def test_crowdstrike_release_gives_adjusted_eps_cash_flow_arr_and_guidance(self):
        facts = {f[0]: f for f in self.extras('CRWD', 'crwd-results-q2fy27.txt')}
        self.assertEqual(facts['adjusted-eps'][1:3], ('$0.31', '$0.23'))
        self.assertEqual(facts['adjusted-net-income'][1:3], ('$322.9M', '$237.4M'))
        self.assertEqual(facts['free-cash-flow'][1:3], ('$377.4M', '$283.6M'))
        self.assertEqual(facts['operating-cash-flow'][1:3], ('$530.3M', '$332.8M'))
        self.assertEqual((facts['arr'][1], facts['arr'][4]), ('$5.84B', '+25%'))
        self.assertEqual(facts['guidance-revenue'][1], '$1.5232B-$1.5292B')
        self.assertEqual(facts['guidance-revenue'][3], ('会社予想 売上高（Q3 FY27）', 'Guidance revenue (Q3 FY27)'))
        self.assertEqual(facts['guidance-fy-revenue'][1], '$5.9911B-$6.0111B')
        self.assertEqual(facts['guidance-adjusted-eps'][1], '$0.31')
        self.assertEqual(facts['guidance-fy-adjusted-eps'][1], '$1.25-$1.26')

    def test_every_value_is_in_the_release(self):
        text = ' '.join(fixture('crwd-results-q2fy27.txt').split()).replace(',', '')
        for key, value, prior, *_ in self.extras('CRWD', 'crwd-results-q2fy27.txt'):
            if key.startswith('guidance-') or key == 'arr':
                continue
            number = value.strip('$MB')
            self.assertIn(number, text, key)

    def test_nvidia_data_center_revenue_and_existing_guidance_kept(self):
        facts = {f[0]: f for f in self.extras('NVDA', 'nvidia-results-q2fy27.txt')}
        self.assertEqual((facts['data-center-revenue'][1], facts['data-center-revenue'][4]), ('$89B', '+117%'))
        self.assertNotIn('guidance-revenue', facts)  # the table parser's guidance stays

    def test_a_figure_stated_with_two_values_is_left_out(self):
        text = fixture('crwd-results-q2fy27.txt').replace('Free cash flow was $377.4 million', 'Free cash flow was $377.4 million. Free cash flow was $300.0 million', 1)
        base = flash.PROFILES['CRWD']['parse'](text)
        keys = [f[0] for f in release_extras.supplement(text, base)['facts']]
        self.assertNotIn('free-cash-flow', keys)

    def test_an_unreadable_text_changes_nothing(self):
        parsed = {'period': 'Q1', 'facts': [('revenue', '$1B', None)]}
        self.assertIs(release_extras.supplement(None, parsed), parsed)
        self.assertEqual(release_extras.supplement('nothing here', parsed), parsed)

    def test_build_carries_the_stated_growth(self):
        text = fixture('crwd-results-q2fy27.txt')
        parsed = release_extras.supplement(text, flash.PROFILES['CRWD']['parse'](text))
        _, payload = flash.build('CRWD', 'https://www.sec.gov/Archives/edgar/data/1/2/x.htm', parsed, '2026-08-26T20:05:00.000+00:00')
        arr = next(f for f in payload['facts'] if f['key'] == 'arr')
        self.assertEqual(arr['comparisons'], {'growth': '+25%'})
        self.assertLessEqual(len(payload['facts']), 16)


if __name__ == '__main__':
    unittest.main()
