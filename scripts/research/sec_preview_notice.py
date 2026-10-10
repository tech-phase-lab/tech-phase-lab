"""Retained SEC filing metadata for preview only. No fetching or news claims."""
from datetime import timedelta
import hashlib
import re
from urllib.parse import urlsplit

import monitor

STATUS = 'sec-filing-notice-unreviewed'
PATH = re.compile(r'^/Archives/edgar/data/([1-9][0-9]{0,9})/([0-9]{18})/([A-Za-z0-9][A-Za-z0-9._-]{0,254})$')
FORM_TITLE = re.compile(r'^(8-K|6-K)(?: · | - |$)')


def identity(url, ticker=None):
    """Match configured issuer + accession, including primary/exhibit aliases."""
    try:
        parsed = urlsplit(url)
        match = PATH.fullmatch(parsed.path)
        if (parsed.scheme != 'https' or parsed.netloc != 'www.sec.gov' or not match
                or parsed.query or parsed.fragment or len(url) > 512):
            return None
        providers = [monitor.PROVIDERS[ticker]] if ticker in monitor.PROVIDERS else monitor.PROVIDERS.values() if ticker is None else []
        cik = match[1].zfill(10)
        for provider in providers:
            configs = [s for s in provider.get('supplementalSources', [])
                       if s.get('format') == 'sec-json' and s.get('cik') == cik]
            if configs and monitor.article_url(url, provider['ticker']) == url:
                digits = match[2]
                accession = digits[:10] + '-' + digits[10:12] + '-' + digits[12:]
                return {'key': 'sec:' + cik + ':' + accession, 'cik': cik, 'accession': accession,
                        'prefix': 'https://www.sec.gov' + parsed.path.rsplit('/', 1)[0] + '/',
                        'provider': provider, 'forms': {f for s in configs for f in s.get('forms', [])} & {'8-K', '6-K'}}
    except (TypeError, ValueError, AttributeError):
        pass
    return None


def _form(row, ref):
    supplied = [row.get(k) for k in ('sec_form', 'sec_cik', 'sec_accession')]
    if any(value is not None for value in supplied):
        return row.get('sec_form') if (row.get('sec_cik') == ref['cik']
            and row.get('sec_accession') == ref['accession'] and row.get('sec_form') in ref['forms']) else None
    title = row.get('title') or ''
    match = FORM_TITLE.match(title) if isinstance(title, str) else None
    return match[1] if match and match[1] in ref['forms'] else None


def _clocks(row, acquired, instant):
    accepted = monitor.valid_sec_acceptance_datetime(row.get('sec_acceptance_datetime'))
    if not instant(accepted) or instant(accepted) > acquired:
        accepted = None
    filing = monitor.valid_sec_filing_date(row.get('sec_filing_date'))
    if filing and filing > acquired.date().isoformat():
        filing = None
    return filing, accepted


def candidates(db, now, *, window_days, scan_limit, instant, withdrawal):
    """One bounded metadata-only lane, with family-wide denial and first clocks."""
    columns = {row[1] for row in db.execute('PRAGMA table_info(sources)')}
    if not {'url', 'ticker', 'title', 'discovered_at', 'status'} <= columns:
        return [], 0
    optional = [name for name in ('sec_form', 'sec_cik', 'sec_accession', 'sec_filing_date', 'sec_acceptance_datetime') if name in columns]
    fields = 'url,ticker,title,discovered_at,status' + ''.join(',' + name for name in optional)
    fields += ",substr(extracted_text,1,300) AS withdrawal_text,CASE WHEN sha256 IS NOT NULL AND length(extracted_text)>0 AND extracted_chars>0 THEN 1 ELSE 0 END AS has_body" if {'extracted_text', 'extracted_chars', 'sha256'} <= columns else ",NULL AS withdrawal_text,0 AS has_body"
    cutoff = now - timedelta(days=window_days)
    scanned = db.execute(f'''SELECT {fields} FROM sources
      WHERE url LIKE 'https://www.sec.gov/Archives/edgar/data/%'
        AND julianday(discovered_at) BETWEEN julianday(?) AND julianday(?)
      ORDER BY julianday(discovered_at) DESC,url LIMIT ?''', (cutoff.isoformat(), now.isoformat(), scan_limit)).fetchall()
    result, handled = [], set()
    for seed in scanned:
        ref = identity(seed['url'], seed['ticker'])
        if not ref or ref['key'] in handled:
            continue
        handled.add(ref['key'])
        family = [dict(row) for row in db.execute(f'''SELECT {fields} FROM sources
            WHERE url>=? AND url<? ORDER BY url LIMIT ?''', (ref['prefix'], ref['prefix'][:-1] + '0', scan_limit + 1))]
        if len(family) > scan_limit:
            continue
        # Holds/withdrawals apply to the complete accession, not just one file.
        if any(row['status'] in {'held', 'rejected'} or withdrawal.search(row.get('withdrawal_text') or '')
               or withdrawal.search(row.get('title') or '') for row in family):
            continue
        family = [row for row in family if (candidate := identity(row['url'], row['ticker'])) and candidate['key'] == ref['key']]
        if not family or any(not instant(row['discovered_at']) or instant(row['discovered_at']) > now for row in family):
            continue
        first = min(family, key=lambda row: (instant(row['discovered_at']), row['url']))
        acquired = instant(first['discovered_at'])
        if acquired < cutoff:
            continue  # A new exhibit or metadata enrichment cannot refresh age.
        forms = {_form(row, ref) for row in family}
        if None in forms or len(forms) != 1:
            continue  # Conflicting/unbound metadata never borrows another file's form.
        form = forms.pop()
        clocks = [_clocks(row, acquired, instant) for row in family]
        filing_dates = {filing for filing, _accepted in clocks if filing}
        accepted_times = {accepted for _filing, accepted in clocks if accepted}
        filing = next(iter(filing_dates)) if len(filing_dates) == 1 else None
        accepted = next(iter(accepted_times)) if len(accepted_times) == 1 else None
        item = {'id': 'original-preview-' + hashlib.sha256(ref['key'].encode()).hexdigest()[:24],
                'status': STATUS, 'sourceName': 'SEC EDGAR', 'sourceUrl': first['url'],
                'issuerName': ref['provider']['name'], 'issuerTicker': first['ticker'],
                'form': form, 'cik': ref['cik'], 'accession': ref['accession'],
                'filingDate': filing, 'acceptedAt': accepted,
                'bodyAvailability': 'retained-unreviewed' if any(row['has_body'] for row in family) else 'unavailable',
                'acquiredAt': first['discovered_at']}
        # A filing notice is one immutable admission, not a content excerpt.
        # Date enrichment/body arrival cannot relabel it as newly published.
        result.append({'key': ref['key'], 'source_id': 'primary-sec-' + first['ticker'],
                       'sha': hashlib.sha256(ref['key'].encode()).hexdigest(), 'item': item, 'primary': True})
    return result, len(scanned)
