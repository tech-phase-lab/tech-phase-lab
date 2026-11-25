"""The earnings alert names the same EPS as the site (owner, Nov 25).

DELL Q3 FY27 (Nov 24, 2026): the member alert said 「DELL Q3決算：売上高$54.9B、EPS$9.45」 from an X post's "Adj EPS", while the
site showed the diluted EPS $8.82 from Dell's own release ($9.45 is the non-GAAP diluted EPS). An adjusted EPS is never the EPS:
the alert shows the diluted EPS when the brief has it, and an adjusted EPS only when it is the only one, always named 調整後EPS.
"""
import json
from pathlib import Path
import unittest

import market_results as results
import web_push as push

FIXTURES = Path(__file__).resolve().parent / 'fixtures'


def fixture(name):
    return (FIXTURES / name).read_text()


class EpsBasisTests(unittest.TestCase):
    def test_post_adjusted_eps_is_not_the_eps(self):
        # The shape of a Wall St Engine results post (the reported figures of Dell's Nov 24 release).
        item = results.projection(fixture('dell-wallstengine-q3fy27.txt'), ['DELL'])
        values = {f['key']: f['value'] for f in item['facts']}
        self.assertEqual(values['adjusted-eps'], '$9.45')
        self.assertNotIn('eps', values)
        self.assertIn('調整後EPS$9.45', item['titleJa'])
        for label in ('Adj EPS', 'Adj. EPS', 'Adjusted EPS', 'Non-GAAP EPS', 'non GAAP EPS'):
            facts = results.projection(f'$DELL Q3 earnings Revenue $54.9B; {label} $9.45', ['DELL'])['facts']
            self.assertEqual([f['key'] for f in facts], ['revenue', 'adjusted-eps'], label)
        facts = results.projection('$DELL Q3 earnings Revenue $54.9B; EPS $8.82', ['DELL'])['facts']
        self.assertEqual([f['key'] for f in facts], ['revenue', 'eps'])

    def test_alert_from_a_post_names_the_adjusted_eps(self):
        item = results.projection(fixture('dell-wallstengine-q3fy27.txt'), ['DELL'])
        titles = push.figure_titles('DELL', item['period'], item['facts'])
        self.assertIn('調整後EPS$9.45', titles['ja'])
        self.assertNotIn('、EPS$9.45', titles['ja'])
        self.assertIn('adj. EPS $9.45', titles['en'])

    def test_alert_from_the_site_brief_shows_the_sites_diluted_eps(self):
        brief = json.loads(fixture('dell-result-brief-q3fy27.json'))
        self.assertEqual(next(f['value'] for f in brief['facts'] if f['key'] == 'eps'), '$8.82')
        titles = push.figure_titles('DELL', brief['period'], brief['facts'])
        self.assertTrue(titles['ja'].startswith('DELL Q3 FY2027決算：売上高$54.9B（+103%）、EPS$8.82'), titles['ja'])
        # Both on one brief: the diluted EPS, as on the site
        both = brief['facts'] + [{'key': 'adjusted-eps', 'ja': '調整後EPS', 'en': 'Adjusted EPS', 'value': '$9.45'}]
        titles = push.figure_titles('DELL', brief['period'], both)
        self.assertIn('EPS$8.82', titles['ja'])
        self.assertNotIn('9.45', titles['ja'] + titles['en'])


if __name__ == '__main__':
    unittest.main()
