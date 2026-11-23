"""One-off clean-up of the false earnings entries of Nov 22-23, 2026 (COHR, LRCX). Dry run unless told otherwise.

  python3 scripts/research/false_earnings_cleanup.py --db PATH                      # dry run: counts only, changes nothing
  CLEANUP_CONFIRM=COHR,LRCX python3 scripts/research/false_earnings_cleanup.py --db PATH --apply --backup FILE

Only rows that are provably late copies are touched: an earnings line, a results flash, an issuer-release headline or a release event
of the named companies, first seen inside the incident window, whose release's own dates (feed date, SEC acceptance, the date in its
address) are more than 36 hours before the moment the monitor first saw it. A release genuinely published inside the window
(CRWD's 8-K of Nov 23, 11:04 UTC) is never selected by this rule. --apply needs CLEANUP_CONFIRM to repeat the exact ticker list and
writes every deleted row to the --backup JSON file first. Prints counts and addresses only. Owner approval is required before it is
ever run against production.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_freshness  # noqa: E402

DEFAULT_TICKERS = ('COHR', 'LRCX')
DEFAULT_SINCE = '2026-11-22T16:00:00+00:00'
DEFAULT_UNTIL = '2026-11-23T03:00:00+00:00'


def table_exists(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def source_row(db, url):
    if not table_exists(db, 'sources'):
        return {}
    columns = {row[1] for row in db.execute('PRAGMA table_info(sources)')}
    wanted = [c for c in ('published_on', 'sec_acceptance_datetime') if c in columns]
    if not wanted:
        return {}
    row = db.execute(f"SELECT {','.join(wanted)} FROM sources WHERE url=?", (url,)).fetchone()
    return dict(zip(wanted, row)) if row else {}


def late_copy(db, url, observed_at, published_on=None):
    observed = release_freshness.instant(observed_at)
    if observed is None:
        return False
    source = source_row(db, url)
    return release_freshness.is_stale(observed, url=url, published_on=published_on or source.get('published_on'),
                                      sec_acceptance=source.get('sec_acceptance_datetime'))


def in_window(value, since, until):
    at = release_freshness.instant(value)
    return at is not None and since <= at < until


def select(db, tickers, since, until):
    """{table: [row dicts]} of the late copies to remove."""
    found = {}
    marks = ','.join('?' for _ in tickers)
    plans = (
        ('earnings_announcements', 'key', f'SELECT * FROM earnings_announcements WHERE ticker IN ({marks})', 'observed_at'),
        ('issuer_result_publications', 'key', f'SELECT * FROM issuer_result_publications WHERE ticker IN ({marks})', 'observed_at'),
        ('signal_events', 'id', 'SELECT * FROM signal_events WHERE source_id IN (%s)' % marks, 'observed_at'),
        ('release_events', 'id', f'SELECT * FROM release_events WHERE ticker IN ({marks})', 'detected_at'),
    )
    for table, _, query, at in plans:
        if not table_exists(db, table):
            continue
        args = tuple('primary-ir-' + t for t in tickers) if table == 'signal_events' else tuple(tickers)
        rows = [dict(row) for row in db.execute(query, args)]
        found[table] = [row for row in rows if in_window(row[at], since, until)
                        and late_copy(db, row['url'], row[at], row.get('published_on'))]
    return found


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--db', required=True)
    parser.add_argument('--tickers', default=','.join(DEFAULT_TICKERS))
    parser.add_argument('--since', default=DEFAULT_SINCE)
    parser.add_argument('--until', default=DEFAULT_UNTIL)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup')
    args = parser.parse_args(argv)
    tickers = tuple(t.strip().upper() for t in args.tickers.split(',') if t.strip())
    since, until = release_freshness.instant(args.since), release_freshness.instant(args.until)
    if not tickers or since is None or until is None or not since < until:
        parser.error('tickers and an aware --since < --until are required')
    if args.apply:
        if os.environ.get('CLEANUP_CONFIRM', '') != ','.join(tickers):
            parser.error('--apply needs CLEANUP_CONFIRM set to exactly ' + ','.join(tickers))
        if not args.backup:
            parser.error('--apply needs --backup FILE')
    db = sqlite3.connect(args.db, timeout=30)
    db.row_factory = sqlite3.Row
    found = select(db, tickers, since, until)
    report = {'mode': 'apply' if args.apply else 'dry-run', 'tickers': list(tickers),
              'rows': {table: [{'ticker': row.get('ticker') or row.get('source_id'), 'url': row['url']} for row in rows]
                       for table, rows in found.items()}}
    if args.apply and any(found.values()):
        Path(args.backup).write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'rows': found},
                                                ensure_ascii=False, default=str))
        keys = {'earnings_announcements': 'key', 'issuer_result_publications': 'key', 'signal_events': 'id', 'release_events': 'id'}
        with db:
            for table, rows in found.items():
                for row in rows:
                    db.execute(f'DELETE FROM {table} WHERE {keys[table]}=?', (row[keys[table]],))
    db.close()
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
