"""Synthetic SEC metadata fixtures. Every source/network route is forbidden."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals
import original_preview_news as preview
import sec_preview_notice as sec

NOW = datetime(2026, 10, 5, 1, tzinfo=timezone.utc)
ACQUIRED = '2026-10-01T20:06:08Z'
URL = 'https://www.sec.gov/Archives/edgar/data/1513845/000110465926112824/tm2626792d1_6k.htm'
ALIAS = URL.rsplit('/', 1)[0] + '/exhibit991.htm'


class SecPreviewNoticeTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(sys.modules, {'signals': signals, 'monitor': monitor}))
        self.enterContext(patch.object(sec, 'monitor', monitor))
        self.enterContext(patch.object(preview, 'monitor', monitor))
        self.enterContext(patch.object(preview, 'signals', signals))
        self.enterContext(patch.object(preview, 'sec_preview_notice', sec))
        for owner, name in [(monitor, 'fetch'), (signals, 'fetch'), (socket, 'socket'),
                            (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            self.enterContext(patch.object(owner, name, side_effect=AssertionError('network forbidden')))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        self.db = monitor.connect(self.path)
        self.addCleanup(self.db.close)

    def add(self, url=URL, ticker='NBIS', title='6-K · Official filing', at=ACQUIRED, status='pending', **fields):
        with self.db:
            self.db.execute('INSERT INTO sources(url,ticker,title,discovered_at,status) VALUES(?,?,?,?,?)',
                            (url, ticker, title, at, status))
            for key, value in fields.items():
                self.db.execute(f'UPDATE sources SET {key}=? WHERE url=?', (value, url))

    def publish(self, now=NOW):
        self.db.commit()
        return preview.publish_once(self.path, reference=now, sources=[])

    def feed(self, now=NOW, **kwargs):
        return preview.public_feed(self.db, now, sources=[], **kwargs)

    def test_nbis_no_body_is_metadata_only_and_waits_for_writer_receipt(self):
        self.add()
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.publish(), 1)
        item = self.feed()[0]
        self.assertEqual(item['status'], sec.STATUS)
        self.assertEqual((item['issuerName'], item['issuerTicker'], item['form']), ('Nebius', 'NBIS', '6-K'))
        self.assertEqual((item['cik'], item['accession']), ('0001513845', '0001104659-26-112824'))
        self.assertEqual(item['sourceUrl'], URL)
        self.assertEqual(item['acquiredAt'], ACQUIRED)
        self.assertEqual(item['bodyAvailability'], 'unavailable')
        self.assertIsNone(item['acceptedAt'])
        self.assertIsNone(item['filingDate'])
        self.assertEqual(set(item), {'id', 'status', 'sourceName', 'sourceUrl', 'issuerName', 'issuerTicker',
            'form', 'cik', 'accession', 'filingDate', 'acceptedAt', 'bodyAvailability', 'acquiredAt', 'previewPublishedAt'})
        self.assertEqual(self.db.execute('SELECT count(*) FROM source_revisions').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM history').fetchone()[0], 0)

    def test_deferred_or_failed_body_does_not_block_notice_or_leak_errors(self):
        for error in ('http-403', 'body-host-backoff', 'Bearer PRIVATE_SYNTHETIC_TOKEN'):
            with self.subTest(error=error):
                self.db.execute('DELETE FROM sources')
                self.add(error=error, next_fetch_at='2026-10-06T01:00:00Z')
                self.publish()
                self.assertEqual(len(self.feed()), 1)
                self.assertNotIn(error, str(self.feed()))
                self.assertEqual(self.db.execute('SELECT error FROM sources').fetchone()[0], error)

    def test_clocks_enrichment_body_arrival_and_alias_keep_first_publication(self):
        self.add()
        self.publish()
        first = self.feed()[0]
        with self.db:
            self.db.execute('''UPDATE sources SET sec_form='6-K',sec_cik='0001513845',
              sec_accession='0001104659-26-112824',sec_filing_date='2026-10-01',
              sec_acceptance_datetime='2026-10-01T16:01:00-04:00',extracted_text='PRIVATE BODY',
              extracted_chars=12,sha256='retained-body',checked_at='2026-10-05T01:01:00Z' WHERE url=?''', (URL,))
        self.add(url=ALIAS, at='2026-10-05T01:01:00Z')
        later = NOW + timedelta(minutes=2)
        self.publish(later)
        item = self.feed(later)[0]
        self.assertEqual(len(self.feed(later)), 1)
        for key in ('id', 'sourceUrl', 'acquiredAt', 'previewPublishedAt'):
            self.assertEqual(item[key], first[key])
        self.assertEqual(item['filingDate'], '2026-10-01')
        self.assertEqual(item['acceptedAt'], '2026-10-01T16:01:00-04:00')
        self.assertEqual(item['bodyAvailability'], 'retained-unreviewed')
        self.assertNotIn('PRIVATE BODY', str(item))
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)

    def test_explicit_hold_rejection_or_withdrawal_on_alias_revokes_family(self):
        self.add()
        self.publish()
        self.add(url=ALIAS, at='2026-09-01T00:00:00Z', status='held')
        for status, text in [('held', ''), ('rejected', ''), ('pending', 'This report has been withdrawn.')]:
            with self.subTest(status=status):
                self.db.execute('UPDATE sources SET status=?,extracted_text=? WHERE url=?', (status, text, ALIAS))
                self.assertEqual(self.feed(), [])

    def test_old_family_cannot_reappear_through_a_recent_exhibit(self):
        self.add(at='2026-09-01T00:00:00Z')
        self.add(url=ALIAS)
        self.assertEqual(self.publish(), 0)
        self.assertEqual(self.feed(), [])

    def test_only_emitted_reviewed_same_accession_takes_precedence(self):
        self.add()
        self.publish()
        self.assertEqual(self.feed(verified_urls=[ALIAS]), [])
        self.assertEqual(len(self.feed(verified_urls=[URL.replace('112824', '112825')])), 1)
        payload = {'ok': True, 'enabled': False, 'items': [], 'officialUpdates': [{'url': ALIAS, 'id': '1'}]}
        result = preview.preview_payload(self.db, payload, NOW)
        self.assertEqual(result['originalPreviewItems'], [])
        self.assertEqual(result['officialUpdates'], payload['officialUpdates'])

    def test_identity_forms_and_legacy_title_prefix_fail_closed(self):
        bad = [(URL, 'AAPL', '6-K · Official filing'), (URL, 'NBIS', '8-K · Official filing'),
               (URL, 'NBIS', 'Form 6-K guessed from body'), (URL, 'NBIS', '6-Kevil'),
               (URL.replace('/1513845/', '/320193/'), 'NBIS', '6-K · Official filing'),
               (URL.replace('112824/', '11282/'), 'NBIS', '6-K · Official filing'),
               (URL + '?secret=private', 'NBIS', '6-K · Official filing'),
               (URL + '/extra', 'NBIS', '6-K · Official filing')]
        for url, ticker, title in bad:
            with self.subTest(url=url, ticker=ticker, title=title):
                self.db.execute('DELETE FROM sources')
                self.add(url=url, ticker=ticker, title=title)
                self.assertEqual(self.publish(), 0)
        self.db.execute('DELETE FROM sources')
        self.add(title='6-K - Nebius Group N.V.')
        self.assertEqual(self.publish(), 1)
        self.db.execute("UPDATE sources SET sec_form='6-K',sec_cik='0000320193',sec_accession='0001104659-26-112824'")
        self.assertEqual(self.feed(), [])

    def test_bad_and_future_optional_clocks_remain_unknown(self):
        self.add(sec_form='6-K', sec_cik='0001513845', sec_accession='0001104659-26-112824')
        for filing, accepted in [('2026-02-30', '2026-10-01T19:00:00'),
                                 ('2026-10-06', '2026-10-01T20:07:00Z'),
                                 ('2026-9-1', 'private-token')]:
            with self.subTest(filing=filing, accepted=accepted):
                self.db.execute('UPDATE sources SET sec_filing_date=?,sec_acceptance_datetime=?', (filing, accepted))
                self.publish()
                item = self.feed()[0]
                self.assertIsNone(item['filingDate'])
                self.assertIsNone(item['acceptedAt'])
        self.db.execute("UPDATE sources SET sec_filing_date='2020-01-01',sec_acceptance_datetime='2020-01-01T01:00:00Z'")
        item = self.feed()[0]
        self.assertEqual(item['filingDate'], '2020-01-01')
        self.assertEqual(item['acceptedAt'], '2020-01-01T01:00:00Z')

    def test_projection_select_only_and_existing_backoff_unchanged(self):
        self.add(error='body-host-backoff', next_fetch_at='2026-10-06T00:00:00Z')
        self.publish()
        before = '\n'.join(self.db.iterdump())
        statements = []
        self.db.set_trace_callback(statements.append)
        self.feed()
        self.db.set_trace_callback(None)
        self.assertFalse(any(statement.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'BEGIN')) for statement in statements))
        self.assertEqual('\n'.join(self.db.iterdump()), before)

    def test_scan_card_and_byte_budgets_preserve_verified_feed(self):
        for i in range(211):
            self.add(url=URL.replace('112824', f'{i:06d}'), at=(NOW - timedelta(minutes=i+1)).isoformat())
        self.publish()
        result = preview.preview_payload(self.db, {'ok': True, 'enabled': False, 'items': []}, NOW)
        self.assertEqual(len(result['originalPreviewItems']), 30)
        self.assertEqual(result['originalPreviewWindow']['eligibleInScan'], 200)
        self.assertTrue(result['originalPreviewWindow']['scanLimited'])
        # The original lane must give way before unchanged verified content.
        core = {'ok': True, 'enabled': False, 'items': [], 'fixture': 'x' * 449800}
        result = preview.preview_payload(self.db, core, NOW)
        self.assertEqual(result['fixture'], core['fixture'])
        self.assertLess(len(result['originalPreviewItems']), 30)


if __name__ == '__main__':
    unittest.main()
