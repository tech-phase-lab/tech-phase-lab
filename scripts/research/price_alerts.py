"""ウォッチリストの価格通知: delivery of the price alerts members save on a stock's page (Nov 21).

Off unless PRICE_ALERT_PUSH_ENABLED is exactly "true" (the owner turns it on). The alerts themselves are the ones the website already
stores with each member's watchlists (member_favorite_lists, document.alerts: ticker, price, above/below, currency). A device is matched
to its member's watchlists by the watchlist key the website sends with the device's registration (push_devices.favorites_owner); this
process never derives a member's key.

How it runs
- Only while the U.S. regular session is open (9:30 to 16:00 ET, 13:00 on early-close days, NYSE holidays off), once every
  CHECK_SECONDS. One batched Twelve Data /quote read per pass: 1 credit per distinct ticker (at most MAX_SYMBOLS), and only when the
  key's credits used this minute leave room for the site's own price screens (CREDIT_CEILING of the plan's per-minute limit).
- An alert fires when the price CROSSES its level: "above" when it reaches the level from below, "below" when it reaches it from above.
  The first time an alert is seen, the side it starts on is taken from the previous close, so a gap through the level at the open
  counts, and an alert saved on the wrong side of the price (already met) waits until the price has gone back.
- One notice per crossing. It re-arms only after the price has gone back past the level by REARM_FRACTION (1%), so a price that
  wobbles around the level does not send a stream of notices; and at most one notice per alert per U.S. trading day.
- Stock splits: a price that jumped by a split-sized ratio since the last pass is checked against Twelve Data's /splits. A split that
  took effect since the alert was first seen divides the alert's level by the split ratio (a $150 alert on a 10-for-1 split becomes
  $15). A jump that /splits does not explain is held for HOLD_PASSES passes (about 15 minutes) before it is believed.
- Sending reuses web_push.announce: the claim is written before the network call, PRO (or an owner account) is checked again right
  before each send, and おやすみモード sends it at once, quietly and marked. A device only receives alerts while its 価格通知 switch
  (price_alerts) is on.

Never logged: a member, a key, a device, a price level or an alert. The health counters are aggregate."""
import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import web_push

ET = ZoneInfo('America/New_York')
CHECK_SECONDS = 300
BUSY_RETRY_SECONDS = 60  # a pass the minute had no room for is tried again in the next minute
MAX_SYMBOLS = 120
# The plan's per-minute credit limit is shared by the site's price screens, the comparison, the thermometer and this check
# (lib/research/twelve-credit-gate.ts: 610). A pass waits for a later turn when this minute's use plus its own cost would pass this.
CREDIT_CEILING = 600  # critical tier (lib/research/twelve-budget.ts): above the site's page views (480) and background jobs (450)
REARM_FRACTION = 0.01
QUOTE_FRESH_SECONDS = 20 * 60
SPLIT_LOW, SPLIT_HIGH = 0.55, 1.8
SPLIT_LOOKBACK_DAYS = 10
SPLIT_LOOKUPS_PER_PASS = 5
HOLD_PASSES = 3
STATE_RETENTION_DAYS = 30

# NYSE holidays and early closes, the same calendar as lib/research/us-market-session.ts (a test keeps them equal). Outside 2026-2027
# the session is unknown and nothing is checked: extend both each December.
HOLIDAYS = frozenset({
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
})
EARLY_CLOSE = frozenset({"2026-11-27", "2026-12-24", "2027-11-26"})

STATUS = {'passes': 0, 'skippedForCredits': 0, 'quoted': 0, 'sent': 0, 'splitAdjusted': 0, 'held': 0, 'lastPassAt': None, 'lastError': None}


def enabled(env=None):
    return (os.environ if env is None else env).get('PRICE_ALERT_PUSH_ENABLED', '').strip().lower() == 'true'


def regular_session(now):
    """True while the U.S. regular session is open at epoch `now`."""
    local = datetime.fromtimestamp(now, ET)
    day = local.strftime('%Y-%m-%d')
    if not 2026 <= local.year <= 2027 or local.weekday() >= 5 or day in HOLIDAYS:
        return False
    minutes = local.hour * 60 + local.minute
    return 9 * 60 + 30 <= minutes < (13 * 60 if day in EARLY_CLOSE else 16 * 60)


def trading_day(now):
    return datetime.fromtimestamp(now, ET).strftime('%Y-%m-%d')


def provider_symbol(ticker):
    """Twelve Data writes a share class with a dot (BRK.B); the SEC list the site uses writes BRK-B (lib/research/provider-symbol.ts)."""
    head, _, tail = ticker.partition('-')
    return f'{head}.{tail}' if tail and len(tail) == 1 and tail != 'P' and head.isalpha() and len(head) <= 6 else ticker


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS price_alert_state (
      owner TEXT NOT NULL, ticker TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL,
      first_seen REAL NOT NULL, armed INTEGER NOT NULL, crossings INTEGER NOT NULL DEFAULT 0, sent_day TEXT, checked_at REAL NOT NULL,
      PRIMARY KEY(owner, ticker, direction))''')
    db.execute('''CREATE TABLE IF NOT EXISTS price_alert_quotes (
      ticker TEXT PRIMARY KEY, price REAL NOT NULL, at REAL NOT NULL, held INTEGER NOT NULL DEFAULT 0)''')
    db.execute('''CREATE TABLE IF NOT EXISTS price_alert_splits (
      ticker TEXT NOT NULL, day TEXT NOT NULL, ratio REAL NOT NULL, found_at REAL NOT NULL, PRIMARY KEY(ticker, day))''')


def member_alerts(db):
    """{favorites key: [alert, ...]} for the members who have at least one device that takes price alerts."""
    owners = [row[0] for row in db.execute('''SELECT DISTINCT favorites_owner FROM push_devices
        WHERE active=1 AND owner_id IS NOT NULL AND price_alerts=1 AND favorites_owner IS NOT NULL''')]
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not owners or 'member_favorite_lists' not in tables:
        return {}
    found = {}
    for owner in owners:
        row = db.execute('SELECT document FROM member_favorite_lists WHERE owner=?', (owner,)).fetchone()
        try:
            alerts = json.loads(row[0]).get('alerts', []) if row else []
        except (TypeError, ValueError, AttributeError):
            continue
        clean = [a for a in alerts if isinstance(a, dict) and isinstance(a.get('ticker'), str) and a.get('direction') in ('above', 'below')
                 and type(a.get('price')) in (int, float) and math.isfinite(a['price']) and a['price'] > 0 and isinstance(a.get('currency'), str)]
        if clean:
            found[owner] = clean[:100]
    return found


# ---- Twelve Data ------------------------------------------------------------------

def _get(path, params, env=None, timeout=20):
    env = os.environ if env is None else env
    base = (env.get('TWELVE_DATA_BASE_URL') or 'https://api.twelvedata.com').rstrip('/')
    query = dict(params)
    key = (env.get('TWELVE_DATA_API_KEY') or '').strip()
    if key:
        query['apikey'] = key
    request = urllib.request.Request(f'{base}/{path}?{urllib.parse.urlencode(query)}', headers={'User-Agent': 'tech-phase-price-alerts/1'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read(2_000_001).decode('utf-8'))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'twelve-data-{path}-http-{error.code}') from None
    except Exception as error:  # the message may carry the URL and the key: never print it
        raise RuntimeError(f'twelve-data-{path}-{type(error).__name__}') from None


def credits_used(transport):
    """Credits used this minute (Twelve Data /api_usage), or None when it cannot be read."""
    try:
        body = transport('api_usage', {})
        used = body.get('current_usage') if isinstance(body, dict) else None
        return used if isinstance(used, (int, float)) and not isinstance(used, bool) and used >= 0 else None
    except Exception:
        return None


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def read_quotes(tickers, transport):
    """{ticker: {price, previousClose, currency, at}} from one batched /quote read. A symbol that does not answer is absent."""
    symbols = {provider_symbol(t): t for t in tickers}
    body = transport('quote', {'symbol': ','.join(symbols)})
    if not isinstance(body, dict):
        return {}
    if len(symbols) == 1 and 'close' in body:
        body = {next(iter(symbols)): body}
    quotes = {}
    for symbol, ticker in symbols.items():
        raw = body.get(symbol)
        if not isinstance(raw, dict) or raw.get('status') == 'error' or str(raw.get('symbol', symbol)).upper() != symbol.upper():
            continue
        price, at = _number(raw.get('close')), _number(raw.get('last_quote_at')) or _number(raw.get('timestamp'))
        if price is None or at is None:
            continue
        quotes[ticker] = {'price': price, 'previousClose': _number(raw.get('previous_close')), 'at': at,
                          'currency': raw.get('currency') if isinstance(raw.get('currency'), str) else 'USD'}
    return quotes


def read_splits(ticker, transport, now):
    """[(day, ratio)] for splits in the last SPLIT_LOOKBACK_DAYS, ratio = old price / new price (10 for a 10-for-1 split)."""
    start = datetime.fromtimestamp(now - SPLIT_LOOKBACK_DAYS * 86400, ET).strftime('%Y-%m-%d')
    body = transport('splits', {'symbol': provider_symbol(ticker), 'start_date': start})
    rows = body.get('splits') if isinstance(body, dict) else None
    found = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        day, a, b = row.get('date'), _number(row.get('from_factor')), _number(row.get('to_factor'))
        if isinstance(day, str) and len(day) == 10 and day >= start and a and b and a != b:
            found.append((day, a, b))
    return found


# ---- judgment ---------------------------------------------------------------------

def met(direction, price, level):
    return price >= level if direction == 'above' else price <= level


def rearmed(direction, price, level):
    """The price has gone back past the level by REARM_FRACTION."""
    return price < level * (1 - REARM_FRACTION) if direction == 'above' else price > level * (1 + REARM_FRACTION)


def effective_level(alert_price, first_seen, splits):
    """The alert's level in today's shares: divided by every split that took effect after the alert was first seen."""
    level = alert_price
    for day, ratio in splits:
        if datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=ET).timestamp() > first_seen:
            level /= ratio
    return level


def split_ratio(previous, price, candidates):
    """The listed split that explains a jump from `previous` to `price` (either way the provider writes the factors), or None."""
    jump = previous / price
    for day, a, b in candidates:
        for ratio in (a / b, b / a):
            if abs(jump / ratio - 1) <= 0.25:
                return day, ratio
    return None


def payload_for(alert, price, level):
    ticker, currency, above = alert['ticker'], alert['currency'], alert['direction'] == 'above'
    fmt = lambda v: f'{v:,.2f}' if v < 1000 else f'{v:,.0f}'
    def make(ja):
        if ja:
            return {'title': f'{ticker} 価格通知',
                    'body': f"{ticker}が{fmt(level)} {currency}{'以上' if above else '以下'}になりました（現在 {fmt(price)} {currency}）",
                    'url': '/research/watchlist'}
        return {'title': f'{ticker} price alert',
                'body': f"{ticker} is {'at or above' if above else 'at or below'} {fmt(level)} {currency} (now {fmt(price)} {currency})",
                'url': '/research/watchlist'}
    return make


def _key(owner, alert, crossings):
    raw = f"{owner}|{alert['ticker']}|{alert['direction']}|{alert['price']!r}|{alert['currency']}|{crossings}"
    return 'price-' + hashlib.sha256(raw.encode()).hexdigest()[:32]


DEVICES = web_push.MEMBERS + ' AND price_alerts=1 AND favorites_owner=?'


def run_once(db, *, transport=None, now=None, env=None, send=None, entitlement=None, wall_now=time.time):
    """One pass. Returns aggregate counts. `db` is the monitor's connection with the push tables (web_push.connect)."""
    now = time.time() if now is None else now
    if not enabled(env):
        return {'status': 'disabled'}
    if not web_push.configuration()['enabled']:
        return {'status': 'push-disabled'}
    if not regular_session(now):
        return {'status': 'market-closed'}
    transport = transport or (lambda path, params: _get(path, params, env))
    schema(db)
    alerts = member_alerts(db)
    tickers = sorted({a['ticker'] for found in alerts.values() for a in found})[:MAX_SYMBOLS]
    STATUS.update(passes=STATUS['passes'] + 1, lastPassAt=datetime.fromtimestamp(now, timezone.utc).isoformat(timespec='seconds'))
    if not tickers:
        _prune(db, alerts, now)
        return {'status': 'ready', 'tickers': 0, 'sent': 0}
    used = credits_used(transport)
    if used is not None and used + len(tickers) > CREDIT_CEILING:
        STATUS['skippedForCredits'] += 1
        return {'status': 'credits-busy', 'tickers': len(tickers)}
    quotes = read_quotes(tickers, transport)
    STATUS['quoted'] += len(quotes)
    usable = {}
    lookups = 0
    for ticker, quote in quotes.items():
        if not 0 <= now - quote['at'] <= QUOTE_FRESH_SECONDS:
            continue
        last = db.execute('SELECT price,at,held FROM price_alert_quotes WHERE ticker=?', (ticker,)).fetchone()
        if last and now - last[1] <= 4 * 86400 and not SPLIT_LOW <= quote['price'] / last[0] <= SPLIT_HIGH:
            found = None
            if lookups < SPLIT_LOOKUPS_PER_PASS:
                lookups += 1
                try:
                    found = split_ratio(last[0], quote['price'], read_splits(ticker, transport, now))
                except Exception:
                    found = None
            if found:
                with db:
                    db.execute('INSERT OR IGNORE INTO price_alert_splits VALUES(?,?,?,?)', (ticker, found[0], found[1], now))
                STATUS['splitAdjusted'] += 1
            elif last[2] + 1 < HOLD_PASSES:
                # A jump no split explains is held for a few passes before it is believed (a bad tick, or a split not yet listed).
                with db:
                    db.execute('UPDATE price_alert_quotes SET held=held+1 WHERE ticker=?', (ticker,))
                STATUS['held'] += 1
                continue
        with db:
            db.execute('INSERT INTO price_alert_quotes VALUES(?,?,?,0) ON CONFLICT(ticker) DO UPDATE SET price=excluded.price,at=excluded.at,held=0',
                       (ticker, quote['price'], now))
        usable[ticker] = quote
    splits = {}
    for ticker, day, ratio in db.execute('SELECT ticker,day,ratio FROM price_alert_splits'):
        splits.setdefault(ticker, []).append((day, ratio))
    today = trading_day(now)
    sent = 0
    options = {'now': now, 'wall_now': wall_now, **({'transport': send} if send else {}), **({'entitlement': entitlement} if entitlement else {})}
    for owner, found in alerts.items():
        for alert in found:
            quote = usable.get(alert['ticker'])
            if quote is None or quote['currency'] != alert['currency']:
                continue
            row = db.execute('SELECT * FROM price_alert_state WHERE owner=? AND ticker=? AND direction=?', (owner, alert['ticker'], alert['direction'])).fetchone()
            if row is None or row['price'] != alert['price'] or row['currency'] != alert['currency']:
                # New (or edited) alert: the side it starts on is the previous close's, so a gap through the level at the open counts.
                first_seen = now
                level = effective_level(alert['price'], first_seen, splits.get(alert['ticker'], []))
                start = quote['previousClose'] or quote['price']
                row = {'first_seen': first_seen, 'armed': 0 if met(alert['direction'], start, level) else 1, 'crossings': 0, 'sent_day': None}
            level = effective_level(alert['price'], row['first_seen'], splits.get(alert['ticker'], []))
            armed, crossings, sent_day = row['armed'], row['crossings'], row['sent_day']
            price = quote['price']
            if armed and met(alert['direction'], price, level):
                armed, crossings = 0, crossings + 1
                if sent_day != today:
                    sent_day = today
                    result = web_push.announce(db, _key(owner, alert, crossings), DEVICES, (owner,), payload_for(alert, price, level), (now,), **options)
                    sent += result.get('attempted', 0)
            elif not armed and rearmed(alert['direction'], price, level):
                armed = 1
            with db:
                db.execute('''INSERT INTO price_alert_state VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,ticker,direction) DO UPDATE SET
                    price=excluded.price,currency=excluded.currency,first_seen=excluded.first_seen,armed=excluded.armed,crossings=excluded.crossings,
                    sent_day=excluded.sent_day,checked_at=excluded.checked_at''',
                    (owner, alert['ticker'], alert['direction'], alert['price'], alert['currency'], row['first_seen'], armed, crossings, sent_day, now))
    STATUS['sent'] += sent
    _prune(db, alerts, now)
    return {'status': 'ready', 'tickers': len(tickers), 'quoted': len(quotes), 'sent': sent}


def _prune(db, alerts, now):
    """Forget the state of alerts that were removed (or whose member no longer has a device for them), and old quotes and splits."""
    keep = {(owner, a['ticker'], a['direction']) for owner, found in alerts.items() for a in found}
    with db:
        for owner, ticker, direction in db.execute('SELECT owner,ticker,direction FROM price_alert_state').fetchall():
            if (owner, ticker, direction) not in keep:
                db.execute('DELETE FROM price_alert_state WHERE owner=? AND ticker=? AND direction=?', (owner, ticker, direction))
        db.execute('DELETE FROM price_alert_quotes WHERE at<?', (now - STATE_RETENTION_DAYS * 86400,))
        db.execute('DELETE FROM price_alert_splits WHERE found_at<?', (now - 400 * 86400,))


def forget_member(db, favorites_key):
    """退会: the member's alert state (member_data_retention). Returns the number of rows removed."""
    schema(db)
    return db.execute('DELETE FROM price_alert_state WHERE owner=?', (favorites_key,)).rowcount


def public_status():
    """Aggregate counters for /health: never a member, a ticker or a level."""
    return {'enabled': enabled(), **STATUS}
