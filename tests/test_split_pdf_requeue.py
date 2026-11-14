"""Nov 14 (owner-approved): re-fetch stored PDF text whose numbers pypdf 6.10-6.12 split ("980 . 8"), without touching anything else."""
from pathlib import Path
import contextlib
import io
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor

SPLIT = 'R e v enues 146 . 1 980 . 8 571% 302. 1 1 , 962. 1 549% Adjust ed EBITD A 465 . 8 90 . 9'
CLEAN = 'Revenues 146.1 980.8 571% 302.1 1,962.1 549% Adjusted EBITDA 465.8 90.9'
FUTURE = '2027-01-01T00:00:00+00:00'
ON = {'RESEARCH_REFETCH_SPLIT_PDFS': 'true'}


class SplitPdfRequeue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = monitor.connect(Path(self.tmp.name) / 'm.sqlite')
        self.addCleanup(self.db.close)
        self.add('https://nebius.com/split', SPLIT, 'application/pdf')
        self.add('https://nebius.com/clean', CLEAN, 'application/pdf')
        self.add('https://nebius.com/html', SPLIT, 'text/html')
        self.add('https://nebius.com/failing', SPLIT, 'application/pdf', error='http-403')
        self.add('https://nebius.com/held', SPLIT, 'application/pdf', status='held')

    def add(self, url, text, content_type, error=None, status='approved'):
        monitor.add_source(self.db, 'NBIS', url, '2026-11-12', 'Nebius results')
        self.db.execute('''UPDATE sources SET sha256=?,content_type=?,extracted_text=?,extracted_chars=?,error=?,status=?,next_fetch_at=?,
          response_etag='"abc"',response_last_modified='Wed, 12 Nov 2026 10:00:00 GMT',source_mode='remote' WHERE url=?''',
                        ('sha-' + url[-6:], content_type, text, len(text), error, status, FUTURE, url))
        self.db.commit()

    def row(self, name):
        return self.db.execute('SELECT * FROM sources WHERE url=?', ('https://nebius.com/' + name,)).fetchone()

    def run_queue(self, environ=ON, version=(6, 14, 0)):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            queued = monitor.queue_split_pdf_evidence(self.db, environ, version)
        self.db.commit()
        return queued, out.getvalue()

    def test_off_by_default_and_with_an_extractor_that_would_split_again(self):
        self.assertEqual(self.run_queue(environ={})[0], 0)
        self.assertEqual(self.run_queue(version=(6, 10, 0))[0], 0)
        self.assertEqual(self.row('split')['next_fetch_at'], FUTURE)
        self.assertIsNone(self.db.execute("SELECT name FROM sqlite_master WHERE name='split_pdf_requeue_runs'").fetchone())

    def test_only_successful_pdf_rows_with_split_numbers_are_queued_and_nothing_else_changes(self):
        queued, line = self.run_queue()
        self.assertEqual(queued, 1)
        self.assertEqual(json.loads(line), {'event': 'split-pdf-requeue', 'pypdf': '6.14.0', 'queued': 1, 'skippedWithError': 1})
        split = self.row('split')
        self.assertIsNone(split['next_fetch_at'])
        self.assertIsNone(split['response_etag'])      # a 304 would keep the split text
        self.assertIsNone(split['response_last_modified'])
        self.assertEqual(split['extracted_text'], SPLIT)  # the stored text stays until the re-fetch replaces it
        for name in ('clean', 'html', 'failing', 'held'):
            row = self.row(name)
            self.assertEqual(row['next_fetch_at'], FUTURE, name)
            self.assertEqual(row['response_etag'], '"abc"', name)
        self.assertEqual(self.row('failing')['error'], 'http-403')  # a failing source keeps its backoff

    def test_it_runs_once_per_extractor_version(self):
        self.assertEqual(self.run_queue()[0], 1)
        self.db.execute('UPDATE sources SET next_fetch_at=?', (FUTURE,))
        self.db.commit()
        queued, line = self.run_queue()
        self.assertEqual((queued, line), (0, ''))
        self.assertEqual(self.row('split')['next_fetch_at'], FUTURE)

    def test_a_repaired_text_is_a_changed_revision(self):
        self.run_queue()
        row = self.row('split')
        self.assertNotEqual(monitor.SPLIT_PDF_NUMBER.findall(row['extracted_text']), [])
        self.assertEqual(monitor.SPLIT_PDF_NUMBER.findall(CLEAN), [])  # the repaired text no longer matches: it is never queued again


if __name__ == '__main__':
    unittest.main()
