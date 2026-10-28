"""Retained-only source metadata contracts; forbidden source/DNS/socket access."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
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
import configured_preview_notice as notices

NOW = datetime(2026, 10, 5, 1, tzinfo=timezone.utc)
AT = '2026-10-04T20:00:00Z'
PRIMARY = 'https://nebius.com/newsroom/synthetic-metadata-notice'


class ConfiguredPreviewNoticeTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(sys.modules, {'signals': signals, 'monitor': monitor}))
        self.enterContext(patch.object(preview, 'monitor', monitor))
        self.enterContext(patch.object(preview, 'signals', signals))
        self.enterContext(patch.object(preview, 'configured_preview_notice', notices))
        self.enterContext(patch.object(notices, 'monitor', monitor))
        for owner, name in [(monitor, 'fetch'), (signals, 'fetch'), (socket, 'socket'),
                            (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            self.enterContext(patch.object(owner, name, side_effect=AssertionError('network forbidden')))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        self.db = monitor.connect(self.path)
        signals.schema(self.db)
        self.addCleanup(self.db.close)

    def primary(self, url=PRIMARY, ticker='NBIS', title='Nebius announces a retained source update', on=None, at=AT, body=None, **fields):
        self.db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at) VALUES(?,?,?,?,?)', (url, ticker, title, on, at))
        if body:
            sha = hashlib.sha256(body.encode()).hexdigest()
            fields.update(sha256=sha, extracted_text=body, extracted_chars=len(body), checked_at=at)
            self.db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)', (url, sha, at, body, len(body)))
        for key, value in fields.items():
            self.db.execute(f'UPDATE sources SET {key}=? WHERE url=?', (value, url))
        self.db.commit()
        return url

    def publish(self, now=NOW, sources=None):
        self.db.commit()
        return preview.publish_once(self.path, reference=now, sources=sources)

    def feed(self, now=NOW, **kwargs):
        return preview.public_feed(self.db, now, **kwargs)

    def document(self, source=None, at=AT, body=None):
        source = source or next(s for s in signals.SOURCES if s['id'] == 'nebius-preemptible')
        body = body or 'Private full document details. ' * 30
        signals.save_evidence(self.db, source, [{'url': source['url'], 'title': source['name'], 'text': body,
            'matches': {'NBIS': ['configured-document']}, 'publishedAt': None, 'truncated': False}], {}, at)
        self.db.commit()
        return source

    def twse(self):
        source = next(s for s in monitor.PROVIDERS['TSM']['fallbackSources'] if s['format'] == 'twse-material-json')
        data = [{'公司代號': '2330', '公司名稱': '台積電', '發言日期': '1151004', '發言時間': '180000',
                 '主旨 ': '本公司重要訊息測試', '說明': 'Private retained disclosure. ' * 20}]
        url, detail = next(iter(monitor.twse_material_links(json.dumps(data), 'TSM', source).items()))
        self.primary(url=url, ticker='TSM', title=detail['title'], on=detail['publishedOn'], body=detail['inlineText'], source_mode='inline')
        return url

    def test_primary_discovery_waits_for_receipt_and_has_no_body_claim(self):
        self.primary(error='Bearer PRIVATE_ERROR_TOKEN', next_fetch_at='2026-10-06T00:00:00Z')
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.publish(), 1)
        item = self.feed()[0]
        self.assertEqual(item['status'], notices.STATUS)
        self.assertEqual(item['sourceClass'], 'issuer-metadata')
        self.assertEqual(item['bodyAvailability'], 'unavailable')
        self.assertEqual(item['acquiredAt'], AT)
        self.assertIsNone(item['sourcePublishedOn'])
        self.assertNotIn('PRIVATE_ERROR', str(item))
        self.assertEqual(set(item), {'id', 'status', 'sourceName', 'sourceUrl', 'sourceClass', 'titleOriginal',
            'sourcePublishedOn', 'bodyAvailability', 'acquiredAt', 'previewPublishedAt'})
        before, queries = '\n'.join(self.db.iterdump()), []
        self.db.set_trace_callback(queries.append)
        self.feed()
        self.db.set_trace_callback(None)
        self.assertEqual('\n'.join(self.db.iterdump()), before)
        self.assertFalse(any(q.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'BEGIN')) for q in queries))

    def test_retries_and_title_enrichment_preserve_notice_clocks_and_reviewed_wins(self):
        self.primary()
        self.publish()
        first = self.feed()[0]
        self.db.execute("UPDATE sources SET title='A corrected retained title',checked_at='2026-10-05T01:01:00Z',error='http-403'")
        later = NOW + timedelta(minutes=2)
        self.publish(later)
        item = self.feed(later)[0]
        for key in ('id', 'acquiredAt', 'previewPublishedAt'):
            self.assertEqual(item[key], first[key])
        self.assertEqual(self.feed(later, verified_urls=[PRIMARY]), [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)

    def test_full_original_body_precedes_metadata_and_holds_revoke_aliases(self):
        self.primary(body='Retained body with unchanged visible source content. ' * 10)
        self.publish()
        self.assertEqual(self.feed()[0]['status'], preview.STATUS)
        self.primary(url=PRIMARY+'/', title='Held alias', at='2026-09-01T00:00:00Z', status='held')
        self.assertEqual(self.feed(), [])

    def test_first_metadata_notice_enriches_with_body_without_second_publication_or_reaging(self):
        self.primary()
        self.publish()
        first = self.feed()[0]
        body = 'Later acquired full source body is still private. ' * 30
        sha = hashlib.sha256(body.encode()).hexdigest()
        body_at = '2026-10-05T01:01:00Z'
        self.db.execute('UPDATE sources SET sha256=?,extracted_text=?,extracted_chars=?,checked_at=?', (sha, body, len(body), body_at))
        self.db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)', (PRIMARY, sha, body_at, body, len(body)))
        later = NOW + timedelta(minutes=2)
        self.publish(later)
        items = self.feed(later)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['status'], notices.STATUS)
        self.assertEqual(items[0]['bodyAvailability'], 'retained-unreviewed')
        for key in ('id', 'acquiredAt', 'previewPublishedAt'):
            self.assertEqual(items[0][key], first[key])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)
        # A later fresh body revision cannot resurrect an expired notice.
        self.db.execute("UPDATE source_revisions SET observed_at='2026-10-12T01:01:00Z'")
        self.db.execute("UPDATE sources SET checked_at='2026-10-12T01:01:00Z'")
        self.publish(NOW + timedelta(days=8))
        self.assertEqual(self.feed(NOW + timedelta(days=8)), [])

    def test_metadata_only_denied_alias_is_checked_outside_body_scan(self):
        self.primary()
        self.publish()
        self.primary(url=PRIMARY+'/', title='Held alias', at='2026-09-01T00:00:00Z', status='held')
        self.assertEqual(self.feed(), [])

    def test_title_only_withdrawal_on_alias_revokes_metadata_and_original_family(self):
        for body in (None, 'Retained original body. ' * 20):
            with self.subTest(body_present=body is not None):
                self.db.execute('DELETE FROM source_revisions')
                self.db.execute('DELETE FROM sources')
                self.primary(body=body)
                self.publish()
                self.assertEqual(len(self.feed()), 1)
                self.primary(url=PRIMARY+'/', title='This report has been withdrawn.', at='2026-10-04T21:00:00Z')
                self.publish()
                self.assertEqual(self.feed(), [])
                # An old withdrawal outside the current scan still binds.
                self.db.execute("UPDATE sources SET discovered_at='2026-09-01T00:00:00Z' WHERE url=?", (PRIMARY+'/',))
                self.assertEqual(self.feed(), [])

    def test_old_first_discovery_cannot_be_reaged_by_new_alias_without_receipt(self):
        self.primary(at='2026-09-01T00:00:00Z')
        self.primary(url=PRIMARY+'/', at=AT)
        self.assertEqual(self.publish(), 0)
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 0)

    def test_aliases_share_earliest_discovery_source_date_and_source_link(self):
        first_at = '2026-10-01T00:00:00Z'
        self.primary(at=first_at, on='2026-09-30')
        self.primary(url=PRIMARY+'/', at=AT)
        self.publish()
        first = self.feed()[0]
        self.assertEqual(first['sourceUrl'], PRIMARY)
        self.assertEqual(first['acquiredAt'], first_at)
        self.assertEqual(first['sourcePublishedOn'], '2026-09-30')
        self.assertEqual(len(self.feed()), 1)
        self.publish(NOW + timedelta(minutes=1))
        self.assertEqual(self.feed(NOW + timedelta(minutes=1))[0], first)
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)
        self.db.execute("UPDATE sources SET published_on='2026-10-04' WHERE url=?", (PRIMARY+'/',))
        self.assertEqual(self.feed(), [])  # Contradictory family clocks are not borrowed.

    def test_invalid_or_future_alias_discovery_clock_fails_closed(self):
        self.primary()
        self.primary(url=PRIMARY+'/', at='2026-10-06T00:00:00Z')
        self.assertEqual(self.publish(), 0)
        self.db.execute("UPDATE sources SET discovered_at='not-a-clock' WHERE url=?", (PRIMARY+'/',))
        self.assertEqual(self.publish(), 0)

    def test_real_discovery_title_withdrawal_revokes_without_overwriting_initial_evidence(self):
        result = {'status': 'ok', 'candidates': 1, 'error': None, 'sourceUrl': 'https://nebius.com/newsroom'}
        original = 'Nebius announces a retained source update'
        with patch.object(monitor, 'now', return_value=AT):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': original}})
        self.publish()
        before = self.feed()[0]
        with patch.object(monitor, 'now', return_value='2026-10-04T21:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'This report has been withdrawn.'}})
        source = self.db.execute('SELECT * FROM sources WHERE url=?', (PRIMARY,)).fetchone()
        self.assertEqual(source['title'], original)
        self.assertEqual(source['discovery_title'], 'This report has been withdrawn.')
        self.assertEqual(source['discovered_at'], AT)
        self.assertEqual(source['discovery_title_at'], '2026-10-04T21:00:00Z')
        self.assertIsNone(source['sha256'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM source_revisions').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM history').fetchone()[0], 0)
        self.publish()
        self.assertEqual(self.feed(), [])
        receipt = self.db.execute('SELECT * FROM original_preview_receipts').fetchone()
        self.assertEqual(receipt['acquired_at'], before['acquiredAt'])
        self.assertEqual(receipt['first_published_at'], before['previewPublishedAt'])

    def test_missing_or_unsafe_discovery_title_cannot_resurrect_withdrawn_family(self):
        result = {'status': 'ok', 'candidates': 1, 'error': None, 'sourceUrl': 'https://nebius.com/newsroom'}
        original = 'Nebius announces a retained source update'
        with patch.object(monitor, 'now', return_value=AT):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': original}})
        self.primary(url=PRIMARY+'/', at=AT)
        self.publish()
        for index, later_title in enumerate((None, '', 'Bearer PRIVATE_SYNTHETIC_TOKEN', 'x' * 301)):
            with self.subTest(title=later_title):
                with patch.object(monitor, 'now', return_value=f'2026-10-04T21:{index:02d}:00Z'):
                    monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'This report has been withdrawn.'}})
                with patch.object(monitor, 'now', return_value=f'2026-10-04T21:{index:02d}:30Z'):
                    monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': later_title}})
                self.publish()
                self.assertEqual(self.feed(), [])
                row = self.db.execute('SELECT title,discovery_title FROM sources WHERE url=?', (PRIMARY,)).fetchone()
                self.assertEqual(row['title'], original)
                if not later_title:
                    self.assertEqual(row['discovery_title'], 'This report has been withdrawn.')

    def test_out_of_order_title_observation_cannot_clear_newer_withdrawal(self):
        result = {'status': 'ok', 'candidates': 1, 'error': None, 'sourceUrl': 'https://nebius.com/newsroom'}
        with patch.object(monitor, 'now', return_value=AT):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'Initial source title'}})
        self.publish()
        with patch.object(monitor, 'now', return_value='2026-10-04T22:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'This report has been withdrawn.'}})
        with patch.object(monitor, 'now', return_value='2026-10-04T21:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'An older ordinary source title'}})
        row = self.db.execute('SELECT discovery_title,discovery_title_at FROM sources').fetchone()
        self.assertEqual(tuple(row), ('This report has been withdrawn.', '2026-10-04T22:00:00Z'))
        self.assertEqual(self.feed(), [])
        with patch.object(monitor, 'now', return_value='2026-10-04T22:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'A conflicting equal-time source title'}})
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.db.execute('SELECT discovery_title FROM sources').fetchone()[0], 'Error: conflicting-discovery-title')

    def test_invalid_current_title_clock_revokes_all_metadata_aliases(self):
        self.primary()
        self.primary(url=PRIMARY+'/', at=AT)
        self.publish()
        for at in ('not-a-clock', '2026-10-06T00:00:00Z', '2026-10-01T00:00:00Z'):
            self.db.execute('UPDATE sources SET discovery_title=?,discovery_title_at=? WHERE url=?', ('A current source title', at, PRIMARY))
            self.assertEqual(self.feed(), [])

    def test_current_discovery_title_enriches_same_notice_with_fixed_first_clocks(self):
        result = {'status': 'ok', 'candidates': 1, 'error': None, 'sourceUrl': 'https://nebius.com/newsroom'}
        original = 'Nebius announces a retained source update'
        with patch.object(monitor, 'now', return_value=AT):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': original}})
        self.publish()
        before = self.feed()[0]
        current = 'Nebius corrects the retained source title'
        with patch.object(monitor, 'now', return_value='2026-10-04T21:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': current}})
        self.publish()
        item = self.feed()[0]
        self.assertEqual(item['titleOriginal'], current)
        for field in ('id', 'sourceUrl', 'acquiredAt', 'previewPublishedAt'):
            self.assertEqual(item[field], before[field])
        self.assertEqual(self.db.execute('SELECT title FROM sources WHERE url=?', (PRIMARY,)).fetchone()[0], original)
        self.db.execute("UPDATE sources SET discovery_title_at='2026-10-06T00:00:00Z'")
        self.assertEqual(self.feed(), [])

    def test_latest_alias_title_and_body_enrich_the_first_canonical_notice(self):
        result = {'status': 'ok', 'candidates': 1, 'error': None, 'sourceUrl': 'https://nebius.com/newsroom'}
        with patch.object(monitor, 'now', return_value=AT):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'Original retained title'}})
        self.publish()
        first = self.feed()[0]
        later_at = '2026-10-04T21:00:00Z'
        body = 'Later body on the canonical alias. ' * 30
        with patch.object(monitor, 'now', return_value=later_at):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY+'/': {'title': 'Corrected newer retained title'}})
            alias = self.db.execute('SELECT * FROM sources WHERE url=?', (PRIMARY+'/',)).fetchone()
            monitor.save_source_check(self.db, alias, {'sha256': hashlib.sha256(body.encode()).hexdigest(),
                'contentType': 'text/html', 'contentBytes': len(body), 'extractedText': body, 'extractedChars': len(body)})
        self.publish()
        items = self.feed()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['titleOriginal'], 'Corrected newer retained title')
        self.assertEqual(items[0]['bodyAvailability'], 'retained-unreviewed')
        for field in ('id', 'sourceUrl', 'acquiredAt', 'previewPublishedAt'):
            self.assertEqual(items[0][field], first[field])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)
        # The earliest alias cannot win just because it is the last scanned row.
        with patch.object(monitor, 'now', return_value='2026-10-04T22:00:00Z'):
            monitor.save_discovery(self.db, 'NBIS', result, {PRIMARY: {'title': 'Newest title on the first alias'}})
        self.assertEqual(self.feed()[0]['titleOriginal'], 'Newest title on the first alias')
        self.db.execute('UPDATE sources SET discovery_title_at=?', ('2026-10-04T22:00:00Z',))
        self.assertEqual(self.feed(), [])  # Same-time conflicting canonical heads fail closed.

    def test_metadata_is_not_fabricated_from_missing_or_unsafe_title_or_unknown_url(self):
        cases = [{'title': None}, {'title': 'Bearer PRIVATE_SYNTHETIC_TOKEN'}, {'title': 'This report has been withdrawn.'},
                 {'url': 'https://nebius.com/newsroom'}, {'url': PRIMARY+'?private=token'}, {'ticker': 'UNKNOWN'},
                 {'on': '2026-02-30'}, {'on': '2026-10-06'}, {'at': '2026-09-01T00:00:00Z'}]
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                self.db.execute('DELETE FROM sources')
                self.primary(**kwargs)
                self.assertEqual(self.publish(), 0)

    def test_twse_requires_exact_config_and_current_inline_evidence(self):
        url = self.twse()
        self.publish()
        item = self.feed()[0]
        self.assertEqual(item['sourceClass'], 'exchange-disclosure')
        self.assertEqual(item['sourceUrl'], url)
        self.assertEqual(item['sourceName'], 'TWSE · TSMC')
        self.assertEqual(item['sourcePublishedOn'], '2026-10-04')
        self.assertEqual(item['bodyAvailability'], 'retained-unreviewed')
        self.assertNotIn('Private retained', str(item))
        self.assertEqual(self.feed(verified_urls=[url]), [])
        for bad in (url+'&secret=token', url.replace('2330', '2317'), url.replace('time=180000', 'time=250000'), url.replace('date=1151004', 'date=1150230')):
            self.assertIsNone(notices.special_identity(bad))
        self.db.execute("UPDATE sources SET title='Unbound title'")
        self.assertEqual(self.feed(), [])

    def test_twse_invalid_revision_hash_and_hold_fail_closed(self):
        self.twse()
        self.publish()
        self.db.execute("UPDATE source_revisions SET extracted_text=extracted_text || 'tampered'")
        self.assertEqual(self.feed(), [])

    def test_exact_four_pdf_seeds_expose_dates_without_inventing_titles(self):
        self.assertEqual(len(notices.SEEDS), 4)
        for url, seed in notices.SEEDS.items():
            self.primary(url=url, title=None, on=seed['publishedOn'])
        self.publish()
        items = self.feed()
        self.assertEqual(len(items), 4)
        self.assertTrue(all(item['sourceClass'] == 'seeded-document' and item['titleOriginal'] is None for item in items))
        self.assertTrue(all(item['bodyAvailability'] == 'unavailable' for item in items))
        for url in notices.SEEDS:
            self.assertIsNone(notices.special_identity(url+'&extra=1'))
            self.assertIsNone(notices.special_identity(url.replace('cache-buster=', 'token=')))
        self.db.execute("UPDATE sources SET discovered_at='2026-09-01T00:00:00Z'")
        self.assertEqual(self.feed(), [])  # The patch does not silently re-age historical seeds.

    def test_both_document_roots_have_revision_bound_notice_without_body_or_fake_headline(self):
        for source in signals.SOURCES:
            if source['id'] in notices.DOCUMENTS:
                self.document(source)
        self.publish()
        first = {i['sourceUrl']: i for i in self.feed()}
        self.assertEqual(len(first), 2)
        self.assertTrue(all(i['sourceClass'] == 'official-document' and i['titleOriginal'] is None for i in first.values()))
        self.assertNotIn('Private full', str(first))
        changed = self.document(at='2026-10-05T01:01:00Z', body='Revised private document details. ' * 30)
        later = NOW + timedelta(minutes=2)
        self.assertNotIn(changed['url'], {i['sourceUrl'] for i in self.feed(later)})
        self.publish(later)
        new = next(i for i in self.feed(later) if i['sourceUrl'] == changed['url'])
        self.assertNotEqual(new['previewPublishedAt'], first[changed['url']]['previewPublishedAt'])
        self.assertEqual(new['acquiredAt'], '2026-10-05T01:01:00Z')

    def test_metadata_scan_receipt_card_byte_and_history_bounds_stay_explicit(self):
        for index in range(211):
            self.primary(url=PRIMARY + '-' + str(index), at=(NOW - timedelta(seconds=index + 1)).isoformat())
        self.publish()
        payload = preview.preview_payload(self.db, {'ok': True, 'enabled': False, 'items': []}, NOW)
        self.assertEqual(len(payload['originalPreviewItems']), 30)
        self.assertEqual(payload['originalPreviewWindow']['eligibleInScan'], 200)
        self.assertEqual(payload['originalPreviewWindow']['omittedInScan'], 170)
        self.assertTrue(payload['originalPreviewWindow']['scanLimited'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 30)
        core = {'ok': True, 'enabled': False, 'items': [], 'fixture': 'x' * 449800}
        payload = preview.preview_payload(self.db, core, NOW)
        self.assertEqual(payload['fixture'], core['fixture'])
        self.assertLess(len(payload['originalPreviewItems']), 30)
        self.publish(NOW + timedelta(days=8))
        self.assertEqual(self.feed(NOW + timedelta(days=8)), [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 30)

    def test_disabled_document_stale_sha_and_permission_required_research_stay_excluded(self):
        source = self.document()
        self.publish(sources=[{**source, 'enabled': False}])
        self.assertEqual(self.feed(sources=[{**source, 'enabled': False}]), [])
        self.db.execute("UPDATE signal_documents SET sha='stale'")
        self.assertEqual(self.feed(), [])
        semi = next(s for s in signals.SOURCES if s['id'] == 'semianalysis')
        self.document({**semi, 'url': 'https://newsletter.semianalysis.com/p/synthetic-private-article'})
        self.publish()
        self.assertEqual(self.feed(), [])


if __name__ == '__main__':
    unittest.main()
