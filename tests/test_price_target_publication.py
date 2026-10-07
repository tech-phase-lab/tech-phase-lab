"""Target publication and eligibility diagnostics use the same strict evidence."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import x_comparison


def observed_target_grammar_replay():
    """Public facts with synthetic surrounding prose, not a retained-DB copy."""
    return [
        ('MSFT', ['MSFT'], 'Piper Sandler', 550, 610,
         "Microsoft $MSFT price target raised to $610 from $550 at Piper Sandler.\n"
         "Piper Sandler analyst Alex Example raised the firm's price target on Microsoft to $610 from $550."),
        ('AMZN', ['AMZN'], 'Rosenblatt', 335, 360,
         "Amazon $AMZN price target raised to $360 from $335 at Rosenblatt.\n"
         "Rosenblatt raised the firm's price target on Amazon to $360 from $335."),
        ('MSFT', ['MSFT'], 'Wells Fargo', 700, 725,
         "Microsoft $MSFT selected for a focus list at Wells Fargo.\n"
         "Wells Fargo analyst Alex Example raised the firm's price target on Microsoft to $725 from $700."),
        ('ASTS', ['ASTS', 'VSAT'], 'B. Riley', 85, 65,
         "Satellite company $ASTS downgraded to Neutral at B. Riley.\n"
         "The analyst assigned a price target of $65, down from $85.\n"
         "Peer company $VSAT was also discussed."),
        ('MRNA', ['MRNA'], 'Citi', 60, 80,
         "$MRNA downgraded to Sell from Neutral at Citi.\n"
         "The analyst assigned a price target of $80, up from $60."),
    ]


class TargetPublicationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        signals.schema(self.db)
        self.now = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
        self.source = next(source for source in signals.SOURCES if source['id'] == 'x-wallstengine')

    def tearDown(self):
        self.db.close()

    def add(self, index, text='$MU PT raised to $110 from $100 at Citi', *, age=60,
            tickers='["MU"]', kind='new', truncated=False, body=None):
        url = f'https://x.com/wallstengine/status/{index}'
        published = (self.now - timedelta(seconds=age + 10)).isoformat()
        observed = (self.now - timedelta(seconds=age)).isoformat()
        self.db.execute('''INSERT INTO signal_events
          (id,source_id,url,sha,title,tickers_json,matches_json,event_kind,
           published_at,observed_at,excerpt,diff,truncated)
          VALUES(?,?,?,?,?,?,'{}',?,?,?,'','',?)''',
          (index, self.source['id'], url, str(index), text, tickers, kind,
           published, observed, int(truncated)))
        if body is not None:
            self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                            (self.source['id'], url, str(index), text, body, observed, observed))

    def row(self, index):
        return next(row for row in signals.price_target_rows(
            self.db, self.now - timedelta(days=7), self.now) if row['id'] == index)

    def test_non_targets_cannot_crowd_out_recent_target_or_first_detection(self):
        self.add(1, age=3600)
        self.add(2, age=20)
        # Both accounts/repeated observations of an action keep the first seen.
        self.db.execute('UPDATE signal_events SET published_at=?',
                        ((self.now - timedelta(hours=2)).isoformat(),))
        for index in range(3, 353):
            self.add(index, '$MU Q4 earnings highlights Revenue $10B', age=1)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['id'], 1)
        self.assertEqual((items[0]['previous'], items[0]['latest']), (100, 110))

    def test_outside_window_stays_private_after_removing_page_limit(self):
        self.add(1, age=8 * 86400)
        self.add(2, age=1)
        self.db.execute('UPDATE signal_events SET published_at=? WHERE id=2',
                        ((self.now - timedelta(days=7)).isoformat(),))
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual([item['id'] for item in items], [2])

    def test_opening_broker_actor_target_forms_publish_with_existing_gates(self):
        cases = [
            ('Mizuho raises $MU price target to $120 from $100', 'MU', ('Mizuho', 100.0, 120.0)),
            ('🚨 Morgan Stanley lowers PT on Micron $MU to $90 from $100, keeps Overweight', 'MU', ('Morgan Stanley', 100.0, 90.0)),
            ('$MSTR: TD Cowen cuts PT to $500 from $600', 'MSTR', ('TD Cowen', 600.0, 500.0)),
            ('$MSTR TD Cowen trims price target to $1,500 from $1,600', 'MSTR', ('TD Cowen', 1600.0, 1500.0)),
            ('$NVDA PT raised to $250 from $200 at Melius', 'NVDA', ('Melius', 200.0, 250.0)),
        ]
        for index, (text, ticker, expected) in enumerate(cases, 1):
            with self.subTest(text=text):
                self.add(index, text, tickers=json.dumps([ticker]), body=text)
                item, reason = signals.price_target_observation(self.row(index), self.source, self.now)
                self.assertEqual(reason, 'eligible')
                self.assertEqual((item['ticker'], item['firm'], item['previous'], item['latest']),
                                 (ticker, *expected))
        for index, (text, reason) in enumerate([
            ('Mizuho raises $MU price target to $90 from $100', 'inconsistent-direction'),
            ('Mizuho raises $MU price target to $120 from $100; Citi agrees', 'firm-not-recognized'),
            ('Unknown Bank raises $MU price target to $120 from $100', 'firm-not-recognized'),
            ('Mizuho raises PT on Micron $MU price target to $120 from $100', 'firm-not-recognized'),
        ], 20):
            with self.subTest(text=text):
                self.add(index, text, tickers='["MU"]', body=text)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now),
                                 (None, reason))

    def test_ticker_rating_line_target_form_publishes(self):
        text = ('$MELI | Susquehanna maintains Positive on MercadoLibre, cuts PT to $2400 from $2500\n\n'
                'Analyst sees consumer-credit changes supporting modest EBIT margin expansion in 2027.')
        self.add(40, text, tickers='["MELI"]', body=text)
        item, reason = signals.price_target_observation(self.row(40), self.source, self.now)
        self.assertEqual(reason, 'eligible')
        self.assertEqual((item['ticker'], item['firm'], item['previous'], item['latest']),
                         ('MELI', 'Susquehanna', 2500.0, 2400.0))
        # A rating reiteration with an unchanged target is not a target change.
        text = '$NVDA | Citi maintains Buy on NVIDIA, PT $250'
        self.add(41, text, tickers='["NVDA"]', body=text)
        self.assertIsNone(signals.price_target_observation(self.row(41), self.source, self.now)[0])

    def test_unicode_bold_styling_is_read_as_plain_text(self):
        def bold(value):
            return ''.join(chr(0x1D5EE + ord(c) - 97) if c.islower() else chr(0x1D5D4 + ord(c) - 65) if c.isupper()
                           else chr(0x1D7EC + ord(c) - 48) if c.isdigit() else c for c in value)
        text = (f"$MELI | Susquehanna {bold('maintains Positive')} on {bold('MercadoLibre')}, "
                f"cuts PT to ${bold('2400')} from ${bold('2500')}")
        self.add(43, text, tickers='["MELI"]', body=text)
        item, reason = signals.price_target_observation(self.row(43), self.source, self.now)
        self.assertEqual(reason, 'eligible')
        self.assertEqual((item['previous'], item['latest']), (2500.0, 2400.0))

    def test_cashtag_led_company_name_target_forms_publish(self):
        for index, text in enumerate([
            '$BE | UBS raises Bloom Energy Corporation price target, raised to $350 from $325',
            '$BE | UBS raises Bloom Energy Corporation price target to $350 from $325',
            '$BE | UBS raises PT on Bloom Energy Corporation to $350 from $325',
            '$BE | UBS raises price target on Bloom Energy Corporation from $325 to $350',
        ], 50):
            with self.subTest(text=text):
                self.add(index, text, tickers='["BE"]', body=text)
                item, reason = signals.price_target_observation(self.row(index), self.source, self.now)
                self.assertEqual(reason, 'eligible')
                self.assertEqual((item['ticker'], item['firm'], item['previous'], item['latest']), ('BE', 'UBS', 325.0, 350.0))
        for index, text in enumerate([
            '$BE | UBS raises Bloom Energy price target, cuts to $300 from $325',
            '$BE | UBS raises Bloom Energy price target to $300 from $325',
        ], 60):
            with self.subTest(text=text):
                self.add(index, text, tickers='["BE"]', body=text)
                self.assertIsNone(signals.price_target_observation(self.row(index), self.source, self.now)[0])

    def test_target_universe_limits_a_route_to_large_caps(self):
        text = '$LMND | Morgan Stanley maintains Equalweight on Lemonade Inc., cuts PT to $48.00 from $56.00'
        self.add(42, text, tickers='["LMND"]', body=text)
        limited = {**self.source, 'targetUniverse': 'large-cap'}
        self.assertEqual(signals.price_target_observation(self.row(42), limited, self.now),
                         (None, 'outside-target-universe'))
        self.assertEqual(signals.price_target_observation(self.row(42), self.source, self.now)[1], 'eligible')
        self.assertIn('MELI', signals.PRICE_TARGET_UNIVERSES['large-cap'])
        self.assertIn('MU', signals.PRICE_TARGET_UNIVERSES['large-cap'])

    def test_rejection_reasons_preserve_safety_gates(self):
        cases = [
            ('$MU PT boosted to $110 from $100 at Citi', {}, 'unsupported-target-syntax'),
            ('$MU PT raised to $110 from $100 at Unknown Bank', {}, 'firm-not-recognized'),
            ('$MU PT raised to $110 from $100 at Citi and by UBS', {}, 'ambiguous-firms'),
            ('$MU PT raised to $90 from $100 at Citi', {}, 'inconsistent-direction'),
            ('$MU PT to $100 from $100 at Citi', {}, 'invalid-target-values'),
            ('$MU PT to $0 from $100 at Citi', {}, 'invalid-target-values'),
            ('$MU PT to $110 from $100 at Citi; PT to $120 from $110', {}, 'ambiguous-target-actions'),
            ('$MU and $AMD PT to $110 from $100 at Citi', {'tickers': '["MU","AMD"]'}, 'ambiguous-subject'),
            ('$MU PT to $110 from $100 at Citi', {'tickers': 'malformed'}, 'invalid-tickers'),
            ('$MU PT to $110 from $100 at Citi', {'tickers': '[{}]'}, 'invalid-tickers'),
            ('$MU PT to $110 from $100 at Citi', {'truncated': True}, 'truncated-evidence'),
            ('$MU PT to $110 from $100 at Citi', {'kind': 'changed'}, 'revision-evidence-missing'),
        ]
        for index, (text, kwargs, reason) in enumerate(cases, 1):
            with self.subTest(reason=reason, text=text):
                self.add(index, text, **kwargs)
                item, status = signals.price_target_observation(self.row(index), self.source, self.now)
                self.assertIsNone(item)
                self.assertEqual(status, reason)
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_explicit_named_company_target_uses_direction_and_full_revision(self):
        # Synthetic paraphrase of the verified qualifier grammar; source prose
        # is not included in fixtures or the structured publication payload.
        headline = 'Microsoft $MSFT selected for a focus list at Wells Fargo.'
        for index, (action, new, old) in enumerate([
            ("raised the firm's", 735, 710),
            ('lowered its', 690, 710),
            ('increased', 740, 710),
        ], 1):
            with self.subTest(action=action):
                self.db.execute('DELETE FROM signal_events')
                self.db.execute('DELETE FROM signal_documents')
                body = headline + '\n' + 'Synthetic analyst context. ' * 24 + (
                    f"An analyst {action} price target on Microsoft to ${new} from ${old}.")
                self.add(index, body[:500], tickers='["MSFT"]', body=body)
                items = signals.public_price_targets(self.db, now=self.now)['items']
                self.assertEqual([(item['ticker'], item['firm'], item['previous'], item['latest']) for item in items],
                                 [('MSFT', 'Wells Fargo', old, new)])
                self.assertNotIn('Synthetic analyst context', json.dumps(items))
                self.assertNotIn('focus list', json.dumps(items))

    def test_named_company_target_preserves_attribution_direction_and_ambiguity_gates(self):
        headline = 'Microsoft $MSFT selected for a focus list at Wells Fargo.\n'
        cases = [
            ('An analyst raised its price target on Microsoft to $690 from $710.', '["MSFT"]', 'inconsistent-direction'),
            ('An analyst lowered its price target on Microsoft to $735 from $710.', '["MSFT"]', 'inconsistent-direction'),
            ('An analyst raised its price target on Amazon to $735 from $710.', '["MSFT"]', 'ambiguous-subject'),
            ('An analyst raised its price target on Microsoft and Amazon to $735 from $710.', '["MSFT"]', 'ambiguous-subject'),
            ('An analyst raised its price target on the company to $735 from $710.', '["MSFT"]', 'ambiguous-subject'),
            ('An analyst raised its price target on Microsoft to $735 from $710. $AMD was also discussed.', '["MSFT","AMD"]', 'ambiguous-subject'),
            ('An analyst raised its price target on Microsoft to $735 from $710. Price target to $740 from $700.', '["MSFT"]', 'ambiguous-target-actions'),
            ('An analyst raised its price target on Microsoft to $735 from $710. Another analyst lowered its price target on Microsoft to $680 from $700.', '["MSFT"]', 'ambiguous-target-actions'),
            ('An analyst raised its price target on Microsoft to $735 from $710 at Citi.', '["MSFT"]', 'ambiguous-firms'),
            ('An analyst set a price target on Microsoft to $735 from $710.', '["MSFT"]', 'unsupported-target-syntax'),
        ]
        for index, (body, tickers, reason) in enumerate(cases, 1):
            with self.subTest(body=body):
                text = headline + body
                self.add(index, text[:500], tickers=tickers, body=text)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now), (None, reason))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_observed_grammar_corpus_preserves_old_targets_and_adds_wells_fargo(self):
        corpus = observed_target_grammar_replay()
        for index, (_, tickers, _, _, _, body) in enumerate(corpus, 1):
            self.add(index, body.split('\n')[0], tickers=json.dumps(tickers), body=body)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual({(item['ticker'], item['firm'], item['previous'], item['latest']) for item in items},
                         {(ticker, firm, old, new) for ticker, _, firm, old, new, _ in corpus})
        self.assertEqual(len(items), 5)
        # A rating downgrade must not invert the separately stated target rise.
        moderna = next(item for item in items if item['ticker'] == 'MRNA')
        self.assertEqual((moderna['previous'], moderna['latest']), (60, 80))

    def test_headline_and_named_body_echo_preserve_observed_target_pairs(self):
        for index, (company, ticker, firm, old, new) in enumerate([
            ('Microsoft', 'MSFT', 'Piper Sandler', 550, 610),
            ('Amazon', 'AMZN', 'Rosenblatt', 335, 360),
        ], 1):
            with self.subTest(ticker=ticker, firm=firm):
                headline = f'{company} ${ticker} price target raised to ${new} from ${old} at {firm}.'
                body = headline + f"\n{firm} analyst Alex Example raised the firm's price target on {company} to ${new} from ${old}."
                self.add(index, headline, tickers=json.dumps([ticker]), body=body)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual({(item['ticker'], item['firm'], item['previous'], item['latest']) for item in items},
                         {('MSFT', 'Piper Sandler', 550, 610), ('AMZN', 'Rosenblatt', 335, 360)})
        self.assertNotIn('AMZN', signals.ALIASES)
        self.assertNotIn('Alex Example', json.dumps(items))

    def test_equal_numbers_do_not_coalesce_conflicting_echo_attribution(self):
        headline = 'Microsoft $MSFT price target raised to $610 from $550 at Piper Sandler.\n'
        cases = [
            ('Piper Sandler analyst Alex Example raised its price target on Microsoft to $620 from $550.', 'ambiguous-target-actions'),
            ('Piper Sandler analyst Alex Example raised its price target on Microsoft to $610 from $560.', 'ambiguous-target-actions'),
            ('Piper Sandler analyst Alex Example lowered its price target on Microsoft to $610 from $550.', 'inconsistent-direction'),
            ('Piper Sandler analyst Alex Example raised its price target on Amazon to $610 from $550.', 'ambiguous-subject'),
            ('Rosenblatt analyst Alex Example raised its price target on Microsoft to $610 from $550.', 'ambiguous-firms'),
            ('An analyst raised its price target on Microsoft to $610 from $550.', 'ambiguous-firms'),
            ('$AMD: Piper Sandler analyst Alex Example raised its price target on Microsoft to $610 from $550.', 'ambiguous-subject'),
            ('PT raised to $610 from $550.', 'ambiguous-target-actions'),
        ]
        for index, (echo, reason) in enumerate(cases, 1):
            with self.subTest(echo=echo):
                body = headline + echo
                self.add(index, headline, tickers='["MSFT"]', body=body)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now), (None, reason))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_hidden_action_after_valid_echo_is_not_discarded(self):
        headline = 'Amazon $AMZN price target raised to $360 from $335 at Rosenblatt.'
        body = headline + "\nRosenblatt analyst Alex Example raised its price target on Amazon to $360 from $335."
        body += '\nSynthetic commentary. ' * 30
        self.add(1, headline, tickers='["AMZN"]', body=body)
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'][0]['latest'], 360)
        self.db.execute('UPDATE signal_documents SET text=?',
                        (body + '\nRosenblatt analyst Alex Example cut its price target on Amazon to $320 from $335.',))
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'ambiguous-target-actions'))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_explicit_b_riley_prefix_merges_second_origin_without_losing_corpus(self):
        corpus = observed_target_grammar_replay()
        for index, (_, tickers, _, _, _, body) in enumerate(corpus, 1):
            self.add(index, body.split('\n')[0], tickers=json.dumps(tickers), body=body)
        original_url = 'https://x.com/TipRanks/status/2105941809176162413'
        second_url = 'https://x.com/wallstengine/status/2105958528741785966'
        self.db.execute('UPDATE signal_events SET url=?,published_at=?,observed_at=? WHERE id=4',
                        (original_url, '2026-10-02T08:43:48Z', '2026-10-02T08:44:16.476Z'))
        self.db.execute('UPDATE signal_documents SET url=? WHERE url=?',
                        (original_url, 'https://x.com/wallstengine/status/4'))
        text = 'B. Riley Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85'
        self.add(6, text, tickers='["ASTS"]', body=text)
        self.db.execute('UPDATE signal_events SET url=?,published_at=?,observed_at=? WHERE id=6',
                        (second_url, '2026-10-02T09:50:14Z', '2026-10-02T09:51:21Z'))
        self.db.execute('UPDATE signal_documents SET url=? WHERE url=?',
                        (second_url, 'https://x.com/wallstengine/status/6'))
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual({(item['ticker'], item['firm'], item['previous'], item['latest']) for item in items},
                         {(ticker, firm, old, new) for ticker, _, firm, old, new, _ in corpus})
        asts = next(item for item in items if item['ticker'] == 'ASTS')
        self.assertEqual(asts['id'], 4)
        self.assertEqual(asts['url'], original_url)
        self.assertEqual(asts['observedAt'], '2026-10-02T08:44:16.476000+00:00')
        self.assertEqual([entry['url'] for entry in asts['sources']], [original_url, second_url])
        self.assertEqual([entry['source'] for entry in asts['sources']], ['X · TipRanks', 'X · Wall St Engine'])
        self.assertEqual([entry['publishedAt'] for entry in asts['sources']],
                         ['2026-10-02T08:43:48+00:00', '2026-10-02T09:50:14+00:00'])
        self.assertEqual([entry['observedAt'] for entry in asts['sources']],
                         ['2026-10-02T08:44:16.476000+00:00', '2026-10-02T09:51:21+00:00'])

    def test_explicit_prefix_does_not_relax_firm_subject_direction_or_action_gates(self):
        cases = [
            ('Unknown Firm Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85', '["ASTS"]', 'firm-not-recognized'),
            ('Goldman Sachs Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85', '["ASTS"]', 'firm-not-recognized'),
            ('B. Riley Downgrades $ASTS to Neutral from Buy, Cuts PT to $85 from $65', '["ASTS"]', 'inconsistent-direction'),
            ('B. Riley Downgrades $VSAT to Neutral from Buy, Cuts PT to $65 from $85', '["ASTS"]', 'ambiguous-subject'),
            ('B. Riley Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85 at Citi', '["ASTS"]', 'ambiguous-firms'),
            ('B. Riley Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85. PT raised to $90 from $85', '["ASTS"]', 'ambiguous-target-actions'),
            ('B. Riley Downgrades $ASTS to Neutral from Buy, Cuts PT to $65 from $85. PT to $65 from $85', '["ASTS"]', 'ambiguous-target-actions'),
        ]
        for index, (text, tickers, reason) in enumerate(cases, 1):
            with self.subTest(text=text):
                self.add(index, text, tickers=tickers, body=text)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now), (None, reason))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_acquired_opening_firm_targets_recover_without_rewriting_provenance(self):
        # Verified public facts and observed grammar with synthetic context.
        # These are historical carry-in posts, never fresh/timely acquisitions.
        fixtures = [
            ('OXY', 'Goldman Sachs', 63, 69, 'x-wallstengine',
             'https://x.com/wallstengine/status/2105584663016476934',
             '2026-10-01T09:04:38Z', '2026-10-01T09:05:11Z',
             'Goldman Sachs upgraded Occidental to Buy from Neutral and raised its PT to $69 from $63.\n\n'
             '$OXY synthetic business context.'),
            ('HOOD', 'BTIG', 125, 135, 'x-tipranks',
             'https://x.com/TipRanks/status/2104838028636151841',
             '2026-09-29T07:37:46Z', '2026-09-29T07:39:14Z',
             "BTIG raised the firm's price target on Robinhood $HOOD to $135 from $125.\n\n"
             'Synthetic trading-volume context.'),
            ('META', 'Monness Crespi', 730, 830, 'x-tipranks',
             'https://x.com/TipRanks/status/2104542833365463489',
             '2026-09-28T12:04:46Z', '2026-09-28T12:04:58Z',
             "Monness Crespi raised the firm's price target on Meta Platforms $META to $830 from $730.\n\n"
             'Synthetic product context.'),
        ]
        roster_before = dict(signals.ALIASES)
        for index, (ticker, _, _, _, source_id, url, published, observed, text) in enumerate(fixtures, 1):
            self.add(index, text[:500], tickers=json.dumps([ticker]), body=text)
            self.db.execute("""UPDATE signal_events SET source_id=?,url=?,published_at=?,observed_at=?
                             WHERE id=?""", (source_id, url, published, observed, index))
            self.db.execute("""UPDATE signal_documents SET source_id=?,url=?,first_seen_at=?,last_seen_at=?
                             WHERE url=?""", (source_id, url, observed, observed,
                                               f'https://x.com/wallstengine/status/{index}'))
        before = list(self.db.iterdump())
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual(len(items), 3)
        for item, fixture in zip(items, fixtures):
            ticker, firm, old, new, _, url, published, observed, _ = fixture
            self.assertEqual((item['ticker'], item['firm'], item['previous'], item['latest']),
                             (ticker, firm, old, new))
            self.assertEqual(item['url'], url)
            self.assertEqual(item['publishedAt'], datetime.fromisoformat(published.replace('Z', '+00:00')).isoformat())
            self.assertEqual(item['observedAt'], datetime.fromisoformat(observed.replace('Z', '+00:00')).isoformat())
            self.assertEqual(item['sources'][0]['url'], url)
            self.assertEqual(item['sources'][0]['publishedAt'], item['publishedAt'])
            self.assertEqual(item['sources'][0]['observedAt'], item['observedAt'])
        self.assertEqual(list(self.db.iterdump()), before)
        self.assertEqual(signals.ALIASES, roster_before)
        self.assertEqual(signals.price_target_publication_summary(self.db, now=self.now)['candidatePosts'], 0)
        for index, (_, tickers, _, _, _, body) in enumerate(observed_target_grammar_replay(), 4):
            self.add(index, body.split('\n')[0], tickers=json.dumps(tickers), body=body)
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 8)
        self.assertNotIn('Synthetic', json.dumps(items))

    def test_opening_firm_actions_preserve_subject_broker_and_direction_guards(self):
        cases = [
            ("Unknown Bank raised the firm's price target on Robinhood $HOOD to $135 from $125.", ['HOOD'], 'firm-not-recognized'),
            ("BTIG discussed Robinhood. An analyst raised its price target on Robinhood $HOOD to $135 from $125.", ['HOOD'], 'firm-not-recognized'),
            ("BTIG did not raise its price target on Robinhood $HOOD to $135 from $125.", ['HOOD'], 'unsupported-target-syntax'),
            ("BTIG reportedly raised its price target on Robinhood $HOOD to $135 from $125.", ['HOOD'], 'firm-not-recognized'),
            ("BTIG raised its price target on Microsoft $HOOD to $135 from $125.", ['HOOD'], 'ambiguous-subject'),
            ("BTIG raised its price target on Robinhood $MSFT to $135 from $125.", ['HOOD', 'MSFT'], 'ambiguous-subject'),
            ("BTIG raised its price target on Robinhood $HOOD to $135 from $125.", ['MSFT'], 'ambiguous-subject'),
            ("BTIG raised its price target on Robinhood and Microsoft $HOOD to $135 from $125.", ['HOOD'], 'ambiguous-subject'),
            ("BTIG raised its price target on the company $HOOD to $135 from $125.", ['HOOD'], 'ambiguous-subject'),
            ("BTIG raised its price target on Robinhood $HOOD to $115 from $125.", ['HOOD'], 'inconsistent-direction'),
            ("Monness Crespi cut its price target on Meta Platforms $META to $830 from $730.", ['META'], 'inconsistent-direction'),
            ("Goldman Sachs upgraded Occidental to Buy from Neutral and raised its PT to $63 from $69. $OXY", ['OXY'], 'inconsistent-direction'),
            ("Goldman Sachs upgraded Occidental to Buy from Neutral and cut its PT to $69 from $63. $OXY", ['OXY'], 'inconsistent-direction'),
            ("Goldman Sachs upgraded Microsoft to Buy from Neutral and raised its PT to $69 from $63. $OXY", ['OXY'], 'ambiguous-subject'),
            ("Goldman Sachs upgraded Occidental to Buy from Neutral and raised its PT to $69 from $63. $OXY $MSFT", ['OXY', 'MSFT'], 'ambiguous-subject'),
            ("BTIG raised its price target on Robinhood $HOOD to $135 from $125 at Citi.", ['HOOD'], 'ambiguous-firms'),
        ]
        for index, (text, tickers, reason) in enumerate(cases, 1):
            with self.subTest(text=text):
                self.add(index, text, tickers=json.dumps(tickers), body=text)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now), (None, reason))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_inline_cashtag_does_not_borrow_a_firm_from_unrelated_prose(self):
        for index, prefix in enumerate(['Unknown Bank', 'BTIG reportedly', 'An analyst'], 1):
            text = (f"{prefix} raised its price target on Robinhood $HOOD to $135 from $125. "
                    "A separate analyst at Citi discussed Robinhood.")
            self.add(index, text, tickers='["HOOD"]', body=text)
            self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now),
                             (None, 'ambiguous-firms'))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_new_company_aliases_do_not_expand_legacy_unrelated_firm_fallback(self):
        for index, (company, ticker) in enumerate([
            ('Robinhood', 'HOOD'), ('Occidental', 'OXY'), ('Meta Platforms', 'META'),
        ], 1):
            text = (f"Unknown Bank raised its price target on {company} to $135 from $125. "
                    f"A separate analyst at Citi discussed {company}. ${ticker}")
            self.add(index, text, tickers=json.dumps([ticker]), body=text)
            self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now),
                             (None, 'ambiguous-subject'))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_opening_firm_single_action_rejects_supported_and_unsupported_extras(self):
        for index, extra in enumerate([
            ' PT raised to $140 from $125.',
            ' PT to $135 from $125.',
            ' PT boosted to $150 from $125.',
            ' Another broker set a price target of $120.',
            ' Citi raised its target on Robinhood to $145 from $125.',
            ' Another target of $135 was reported.',
            ' Citi cut its target on Robinhood.',
            " Monness Crespi raised its price target on Meta Platforms $META to $830 from $730.",
        ], 1):
            with self.subTest(extra=extra):
                text = "BTIG raised the firm's price target on Robinhood $HOOD to $135 from $125." + extra
                self.add(index, text[:500], tickers='["HOOD"]', body=text)
                self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now),
                                 (None, 'ambiguous-target-actions'))

    def test_opening_firm_target_separates_rating_from_target_direction(self):
        text = 'Goldman Sachs upgraded Occidental to Buy from Neutral and cut its PT to $63 from $69. $OXY'
        self.add(1, text, tickers='["OXY"]', body=text)
        item = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual((item['ticker'], item['previous'], item['latest']), ('OXY', 69, 63))

    def test_inline_cashtag_target_keeps_explicit_subject_when_peer_follows(self):
        text = "BTIG raised the firm's price target on Robinhood $HOOD to $135 from $125. Peer $MSFT discussed."
        self.add(1, text, tickers='["MSFT","HOOD"]', body=text)
        item = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual(item['ticker'], 'HOOD')

    def test_opening_firm_target_revision_and_retraction_invalidate_old_facts(self):
        text = "BTIG raised the firm's price target on Robinhood $HOOD to $135 from $125."
        self.add(1, text, tickers='["HOOD"]', body=text)
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 1)
        self.db.execute("UPDATE signal_documents SET sha='correction',text='The prior target report is withdrawn.'")
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'superseded-revision'))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        self.db.execute("UPDATE signal_documents SET sha='1',text=?", (text,))
        self.db.execute("UPDATE signal_events SET event_kind='changed'")
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 1)
        self.db.execute('DELETE FROM signal_documents')
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'revision-evidence-missing'))

    def test_current_revision_cannot_republish_a_quoted_retracted_opening_target(self):
        openings = [
            ('HOOD', "BTIG raised its price target on Robinhood $HOOD to $135 from $125."),
            ('META', "Monness Crespi raised its price target on Meta Platforms $META to $830 from $730."),
            ('OXY', "Goldman Sachs upgraded Occidental to Buy from Neutral and raised its PT to $69 from $63. $OXY"),
        ]
        index = 0
        for ticker, opening in openings:
            for correction in [
                ' This report was retracted.',
                ' Correction: the earlier information is incorrect.',
                ' The target has been withdrawn.',
                ' The analyst withdrew this claim.',
            ]:
                for kind in ['new', 'baseline', 'changed']:
                    with self.subTest(ticker=ticker, correction=correction, kind=kind):
                        index += 1
                        text = opening + correction
                        self.add(index, text, tickers=json.dumps([ticker]), kind=kind, body=text)
                        self.assertEqual(signals.price_target_observation(self.row(index), self.source, self.now),
                                         (None, 'retracted-target-evidence'))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        text = openings[0][1] + ' The company withdrew an acquisition offer.'
        self.add(index + 1, text, tickers='["HOOD"]', body=text)
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 1)

    def test_current_revision_replaces_old_target_and_unsafe_revision_removes_it(self):
        self.add(1, body='$MU PT raised to $110 from $100 at Citi')
        row = dict(self.row(1))
        self.db.execute("UPDATE signal_documents SET sha='2',text=?", ('$MU PT raised to $120 from $100 at Citi',))
        self.add(2, '$MU PT raised to $120 from $100 at Citi', kind='changed', age=30)
        self.db.execute('UPDATE signal_events SET url=? WHERE id=2', (row['url'],))
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual([(item['id'], item['previous'], item['latest']) for item in items], [(2, 100, 120)])
        old_row = self.row(1)
        self.assertEqual(signals.price_target_observation(old_row, self.source, self.now), (None, 'superseded-revision'))
        summary = signals.price_target_publication_summary(self.db, now=self.now)
        self.assertEqual(summary['eligiblePosts'], 1)
        self.assertEqual(summary['withheldReasons'], {'superseded-revision': 1})
        # Corrected body contradicts its direction: neither the current nor the
        # historical title may remain visible as a fallback.
        self.db.execute('UPDATE signal_documents SET text=?', ('$MU PT raised to $90 from $100 at Citi',))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_changed_revision_requires_full_matching_evidence(self):
        self.add(1, kind='changed')
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'revision-evidence-missing'))
        self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                        (self.source['id'], 'https://x.com/wallstengine/status/1', 'other',
                         'Other title', '$MU PT to $120 from $100 at Citi',
                         self.now.isoformat(), self.now.isoformat()))
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'superseded-revision'))

    def test_same_broker_syndication_combines_sources_but_different_actions_stay_separate(self):
        self.add(1, '$MU PT raised to $110 from $100 at BofA', age=120)
        self.db.execute("UPDATE signal_events SET source_id='x-tipranks',url='https://x.com/TipRanks/status/1' WHERE id=1")
        self.add(2, '$MU PT raised to $110 from $100 at Bank of America', age=90)
        self.add(3, '$MU PT raised to $110 from $100 at BofA', age=60)
        # One post seen through two query routes is still one source link.
        self.db.execute("UPDATE signal_events SET url='https://x.com/TipRanks/status/1' WHERE id=3")
        self.add(4, '$MU PT raised to $110 from $100 at Citi', age=50)
        self.add(5, '$MU PT raised to $120 from $100 at Bank of America', age=40)
        self.add(6, '$MU PT cut to $110 from $100 at BofA', age=30)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual({(item['firm'], item['latest']) for item in items},
                         {('BofA', 110), ('BofA', 120), ('Citi', 110)})
        combined = next(item for item in items if item['firm'] == 'BofA' and item['latest'] == 110)
        self.assertEqual(combined['id'], 1)
        self.assertEqual(combined['source'], 'X · TipRanks')
        self.assertEqual([source['id'] for source in combined['sources']], [1, 2])
        self.assertEqual([source['source'] for source in combined['sources']],
                         ['X · TipRanks', 'X · Wall St Engine'])
        self.assertEqual({source['url'] for source in combined['sources']},
                         {'https://x.com/TipRanks/status/1', 'https://x.com/wallstengine/status/2'})
        for source in combined['sources']:
            self.assertEqual(set(source), {'id', 'source', 'url', 'publishedAt', 'observedAt'})

    def test_explicit_broker_aliases_share_one_identity(self):
        for first, second, canonical in [
            ('Citi', 'Citigroup', 'Citi'),
            ('J.P. Morgan', 'JPMorgan', 'JPMorgan'),
            ('RBC', 'RBC Capital', 'RBC'),
            ('Evercore', 'Evercore ISI', 'Evercore'),
            ('Cantor', 'Cantor Fitzgerald', 'Cantor Fitzgerald'),
            ('BMO', 'BMO Capital', 'BMO'),
        ]:
            with self.subTest(first=first, second=second):
                self.db.execute('DELETE FROM signal_events')
                self.add(1, f'$MU PT raised to $110 from $100 at {first}', age=120)
                self.add(2, f'$MU PT raised to $110 from $100 at {second}', age=60)
                items = signals.public_price_targets(self.db, now=self.now)['items']
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]['firm'], canonical)
                self.assertEqual([source['id'] for source in items[0]['sources']], [1, 2])

    def test_superseded_source_is_removed_from_combined_evidence(self):
        self.add(1, age=120, body='$MU PT raised to $110 from $100 at Citi')
        self.add(2, age=60)
        before = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual([source['id'] for source in before['sources']], [1, 2])
        self.db.execute("UPDATE signal_documents SET sha='corrected',text='Unsupported correction'")
        after = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual(after['id'], 2)
        self.assertEqual([source['id'] for source in after['sources']], [2])

    def test_timing_and_source_rejections_are_diagnostic(self):
        self.add(1)
        original = dict(self.row(1))
        cases = [
            ({'published_at': None}, 'invalid-timestamp'),
            ({'published_at': '2026-10-02T11:00:00'}, 'invalid-timestamp'),
            ({'observed_at': (self.now + timedelta(seconds=1)).isoformat()}, 'future-observation'),
            ({'published_at': (self.now - timedelta(days=8)).isoformat()}, 'outside-publication-window'),
            ({'published_at': self.now.isoformat()}, 'observation-before-publication'),
            ({'url': 'https://unapproved.example/status/1'}, 'source-url-not-approved'),
            ({'url': 'https://x.com/theflynews/status/1'}, 'source-url-not-approved'),
        ]
        for update, reason in cases:
            with self.subTest(reason=reason, update=update):
                self.assertEqual(signals.price_target_observation({**original, **update}, self.source, self.now),
                                 (None, reason))
        self.assertEqual(signals.price_target_observation(original, None, self.now),
                         (None, 'source-not-approved'))

    def test_full_revision_drives_comparison_and_summary_without_exposing_body(self):
        body = 'Private commentary. ' * 30 + '$MU price target raised to $110 from $100 at Citi'
        self.add(1, body[:500], body=body)
        self.add(2, '$MU price target boosted to $120 from $100 at Citi')
        observed = (self.now - timedelta(seconds=10)).isoformat()
        self.db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (self.source['id'], 'https://x.com/wallstengine/status/3', '3',
                         'private title', '$ZZZZ PT increased to $30 from $20 by Citi', observed,
                         observed, observed, 0, 0))
        report = x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]
        self.assertEqual(report['targetMentions'], 2)
        self.assertEqual(report['publication'], {
            'eligiblePosts': 1, 'withheldPosts': 1,
            'withheldReasons': {'unsupported-target-syntax': 1}})
        self.assertEqual({sample['publicationStatus'] for sample in report['samples']},
                         {'eligible', 'unsupported-target-syntax'})
        self.assertNotIn('Private commentary', json.dumps(report))
        summary = signals.x_operational_summary(self.db, reference=self.now)['priceTargetPublication']
        self.assertEqual(summary['candidatePosts'], 2)
        self.assertEqual(summary['eligiblePosts'], 1)
        self.assertEqual(summary['withheldReasons'], {'unsupported-target-syntax': 1})
        self.assertEqual(summary['acquiredTargetPosts'], 1)
        self.assertEqual(summary['unselectedAcquiredTargetPosts'], 1)
        for secret in ('Private commentary', 'ZZZZ', 'MU', 'Citi', 'https://', self.source['id']):
            self.assertNotIn(secret, json.dumps(summary))
        self.db.execute("UPDATE signal_documents SET sha='later-revision'")
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        # A different revision's full body must never supplement the old title.
        self.assertEqual(x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]['targetMentions'], 1)

    def test_comparison_ignores_future_rows_and_tolerates_invalid_tickers(self):
        self.add(1, tickers='malformed')
        self.add(2, age=-100)
        result = x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]
        self.assertEqual(result['newPosts'], 1)
        self.assertEqual(result['publication']['withheldReasons'], {'invalid-tickers': 1})
        self.assertEqual(result['tickerCounts'], {})

    def test_comparison_does_not_write_to_read_only_database(self):
        self.add(1)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'saved.sqlite'
            with sqlite3.connect(path) as writable:
                self.db.commit()
                self.db.backup(writable)
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as readonly:
                readonly.row_factory = sqlite3.Row
                result = x_comparison.report(readonly, now=self.now)
                self.assertEqual(result['sources'][self.source['id']]['publication']['eligiblePosts'], 1)
                self.assertEqual(readonly.total_changes, 0)


if __name__ == '__main__':
    unittest.main()
