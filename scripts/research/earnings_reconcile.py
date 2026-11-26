"""The press release against the 10-Q / 10-K (owner, Nov 26: publish from the release at once, reconcile when the report arrives).

The company page's figures come from the results release (the 8-K's Exhibit 99.1) within minutes of the filing; the quarterly
report (10-Q, or 10-K for the fiscal year's last quarter) follows days or weeks later. When the patrol (earnings_patrol.py) sees
that report filed after the release it read, this compares the release's revenue, diluted EPS and net income with the report's own
XBRL facts for the same quarter (SEC companyconcept API: the fact filed with that report's accession, for a quarter-long period
ending on its period date) and keeps every comparison in earnings_reconciliations:

  match      the report's figure agrees with the release's, to the rounding of the figure the release printed;
  differs    it does not: logged, and an operational incident (owner alert) opens for the company;
  not-found  the report carries no quarter-long fact for it (a 10-K usually tags only the year): logged, not alerted.

Each report is reconciled once. Foreign issuers (6-K / 20-F) file no 10-Q and are not reconciled. Public SEC files only; the
release's own figures are never changed by this (a difference is for the owner to review).
"""
from datetime import datetime, timedelta
from decimal import Decimal
import json

import monitor

REPORT_WITHIN = timedelta(days=100)
QUARTER_DAYS = (80, 100)
INCIDENT_PREFIX = 'earnings-reconcile:'
CATEGORY = 'earnings-reconcile'
# field -> (XBRL tags tried in order, unit, the release fact key, kind)
FIELDS = {
    'revenue': (('Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax',
                 'SalesRevenueNet'), 'USD', 'revenue', 'amount'),
    'eps': (('EarningsPerShareDiluted',), 'USD/shares', 'eps', 'per-share'),
    # A release's "net income" can be the company's share or the amount available to common holders (Alphabet, Q3 2026: $26,170M
    # available to common stockholders, $26,468M net income before preferred dividends): either reported figure is a match.
    'net-income': (('NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss', 'IncomeLossFromContinuingOperations'),
                   'USD', 'net-income', 'amount'),
}


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_reconciliations(
      ticker TEXT NOT NULL, release_accession TEXT NOT NULL, report_accession TEXT NOT NULL, report_form TEXT NOT NULL,
      period_end TEXT NOT NULL, field TEXT NOT NULL, release_value TEXT, report_value TEXT, status TEXT NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY(ticker, report_accession, field))''')


def report_after(filings, release):
    """The first 10-Q / 10-K accepted after the release (and within REPORT_WITHIN): (form, accession, period end), else None."""
    recent = filings['filings']['recent']
    found = None
    for i, form in enumerate(recent['form']):
        if form not in ('10-Q', '10-K'):
            continue
        accepted = datetime.fromisoformat(recent['acceptanceDateTime'][i].replace('Z', '+00:00'))
        if release['accepted'] < accepted <= release['accepted'] + REPORT_WITHIN and recent['reportDate'][i]:
            found = (form, recent['accessionNumber'][i], recent['reportDate'][i])  # newest first: keep going to the earliest one
    return found


def quarter_fact(concept, unit, accession, period_end):
    for fact in (concept.get('units') or {}).get(unit, []):
        if fact.get('accn') != accession or fact.get('end') != period_end or not fact.get('start'):
            continue
        days = (datetime.strptime(fact['end'], '%Y-%m-%d') - datetime.strptime(fact['start'], '%Y-%m-%d')).days
        if QUARTER_DAYS[0] <= days <= QUARTER_DAYS[1]:
            return Decimal(str(fact['val']))
    return None


def compare(release_fact, kind, report_value):
    """(status, release text, report text) for one field."""
    import earnings_patrol as patrol
    read = patrol.amount(release_fact) if kind == 'amount' else patrol.per_share(release_fact)
    if read is None or read[0] != 'USD':
        return None
    if report_value is None:
        return 'not-found', release_fact, None
    filed = report_value / Decimal(1_000_000) if kind == 'amount' else report_value
    return ('match' if abs(filed - read[1]) <= read[2] + Decimal('0.000001') else 'differs'), release_fact, format(filed.normalize(), 'f')


def run(db, results, filings_by_ticker, now, fetch_json=None):
    """Reconcile every roster release whose quarterly report has arrived and was not reconciled yet. Yields one log entry per report."""
    import earnings_patrol as patrol
    fetch_json = fetch_json or patrol.get_json
    schema(db)
    for key, release in results.items():
        if not key.endswith(':release') or not release or 'facts' not in release or release.get('form') != '8-K':
            continue
        ticker = key[:-len(':release')]
        filings = filings_by_ticker.get(ticker)
        report = report_after(filings, release) if filings else None
        if not report:
            continue
        form, accession, period_end = report
        if db.execute('SELECT 1 FROM earnings_reconciliations WHERE ticker=? AND report_accession=? LIMIT 1', (ticker, accession)).fetchone():
            continue
        statuses, rows = {}, []
        for field, (tags, unit, fact_key, kind) in FIELDS.items():
            fact = release['facts'].get(fact_key)
            if not fact:
                continue
            # Every tag the report uses for this quarter is read; the release's figure matches when any of them agrees.
            outcome = None
            for tag in tags:
                try:
                    concept = fetch_json(f'https://data.sec.gov/api/xbrl/companyconcept/CIK{int(patrol.cik(ticker)):010d}/us-gaap/{tag}.json')
                except Exception:  # noqa: BLE001 - a tag the company does not use answers 404
                    continue
                value = quarter_fact(concept, unit, accession, period_end)
                if value is None:
                    continue
                outcome = compare(fact['value'], kind, value)
                if outcome and outcome[0] == 'match':
                    break
            outcome = outcome or compare(fact['value'], kind, None)
            if outcome:
                statuses[field] = outcome[0]
                rows.append((ticker, release['accession'], accession, form, period_end, field, outcome[1], outcome[2], outcome[0], now.isoformat(timespec='seconds')))
        if not rows:
            continue
        with db:
            db.executemany('INSERT OR IGNORE INTO earnings_reconciliations VALUES(?,?,?,?,?,?,?,?,?,?)', rows)
        differs = sorted(f for f, s in statuses.items() if s == 'differs')
        if differs:
            monitor.record_operational_incident(db, INCIDENT_PREFIX + ticker, CATEGORY, ticker, 'warning',
                                                'differs:' + '.'.join(differs), seen_at=now.isoformat(timespec='seconds'))
        else:
            monitor.resolve_operational_incident(db, INCIDENT_PREFIX + ticker, resolved_at=now.isoformat(timespec='seconds'))
        yield {'ticker': ticker, 'report': form, 'periodEnd': period_end, 'fields': statuses}


def diagnostics(db, limit=10):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_reconciliations'").fetchone():
        return {'reconciled': 0, 'differs': []}
    count = db.execute('SELECT count(DISTINCT report_accession) FROM earnings_reconciliations').fetchone()[0]
    differs = [{'ticker': r[0], 'periodEnd': r[1], 'field': r[2]} for r in db.execute(
        "SELECT ticker,period_end,field FROM earnings_reconciliations WHERE status='differs' ORDER BY at DESC LIMIT ?", (limit,))]
    return {'reconciled': count, 'differs': differs}


if __name__ == '__main__':
    print(json.dumps({'fields': sorted(FIELDS)}))
