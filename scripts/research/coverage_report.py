"""Offline source inventory with optional read-only supplemental intake health.

Does not fetch, publish, notify, create a database, or modify monitoring state.
Registered sources are not evidence that a company's news is fully covered.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

import monitor
import signals


def report(db_path=None, now=None):
    now = now or datetime.now(timezone.utc)
    rows = {}
    if db_path is not None:
        # mode=ro also prevents a typo from silently creating an empty database.
        with sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'signal_routes' in tables:
                rows = {r['id']: dict(r) for r in db.execute('SELECT * FROM signal_routes')}
    routes = []
    for source in signals.SOURCES:
        row = rows.get(source['id'], {})
        age = None
        try:
            succeeded = datetime.fromisoformat(row.get('succeeded_at') or '')
            if succeeded.tzinfo:
                age = (now - succeeded).total_seconds()
        except ValueError:
            pass
        status = 'untested'
        if row.get('error'):
            status = 'error'
        elif age is not None:
            status = 'fresh' if 0 <= age <= max(300, source['intervalSeconds'] * 3) else 'stale'
        if row.get('config_sha') and row['config_sha'] != signals.fingerprint(source, list(signals.ALIASES)):
            status = 'configuration-changed'
        routes.append({'id': source['id'], 'name': source['name'], 'url': source['url'],
                       'tickers': source.get('tickers', []), 'status': status,
                       'lastSuccess': row.get('succeeded_at'), 'error': row.get('error'),
                       'reuse': source['reuse']})
    companies = []
    for ticker, provider in monitor.PROVIDERS.items():
        dedicated = [r['id'] for r in routes if ticker in r['tickers']]
        companies.append({'ticker': ticker, 'name': provider['name'],
                          'officialIndex': provider['indexUrl'],
                          'officialAvailability': 'not-assessed-by-this-report',
                          'dedicatedSupplementalSources': dedicated,
                          'needsDedicatedSupplementalSource': not bool(dedicated)})
    return {'generatedAt': now.isoformat(), 'databaseInspected': db_path is not None,
            'companies': companies, 'routes': routes,
            'sharedSources': [r['id'] for r in routes if not r['tickers']],
            'note': 'Fresh means a recent supplemental fetch succeeded, not complete news coverage or publication permission.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, help='Existing monitor database; opened read-only')
    args = parser.parse_args()
    print(json.dumps(report(args.db), ensure_ascii=False, indent=2))
