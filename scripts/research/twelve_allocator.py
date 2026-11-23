"""The single Twelve Data credit allocator (owner, Nov 23: "absolutely no problem" up to 1,000 members, whatever the number of website
instances). The plan's 610 credits a minute are shared by the website (Vercel, any number of instances) and this monitor. Every
website instance asks this process for each call's credits (POST /twelve/lease, lib/research/twelve-gateway.ts), and this monitor's
own jobs report what they spend, so one place sees every credit before it is sent.

Usage this minute = the provider's meter (read here at most every METER_MAX_AGE seconds, one credit a read) + every credit granted or
spent since a little before that reading (counted twice rather than missed: a call granted just before the reading may not be in it).
A grant is all or nothing and only while usage + cost stays at or under its tier's ceiling (the same table as
lib/research/twelve-budget.ts CEILING; a test keeps them equal). An unreadable meter grants nothing to the website (it shows its last
good copies) while the monitor's jobs keep their own rules. Nothing is logged but aggregate counters; never a key."""
import json
import os
import threading
import time
import urllib.parse
import urllib.request

CEILING = {'critical': 600, 'warm': 460, 'user': 480, 'background': 450, 'fast': 200}
PLAN_CREDITS_PER_MINUTE = 610
METER_MAX_AGE = 3.0
OVERLAP = 2.0          # for the website's grants: credits granted this long before a reading are counted again (they may not be in it yet)
MAX_COST = 120         # one lease never asks for more than this

PER_CALL = {'statistics': 50, 'earnings': 20, 'splits': 20, 'income_statement': 100, 'cash_flow': 100, 'balance_sheet': 100,
            'dividends': 20, 'profile': 10, 'api_usage': 1, 'symbol_search': 1}


def credit_cost(path, params):
    if path in PER_CALL:
        return PER_CALL[path]
    symbols = [s for s in str((params or {}).get('symbol', '')).split(',') if s]
    return max(1, len(symbols))


def read_provider_meter(env=None):
    """The provider's own count for this minute, or None. The key never leaves this function."""
    env = os.environ if env is None else env
    key = (env.get('TWELVE_DATA_API_KEY') or '').strip()
    if not key:
        return None
    base = (env.get('TWELVE_DATA_BASE_URL') or 'https://api.twelvedata.com').rstrip('/')
    request = urllib.request.Request(f'{base}/api_usage?{urllib.parse.urlencode({"apikey": key})}', headers={'User-Agent': 'tech-phase-allocator/1'})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            used = json.loads(response.read(100_000).decode('utf-8')).get('current_usage')
        return used if isinstance(used, (int, float)) and not isinstance(used, bool) and used >= 0 else None
    except Exception:
        return None


class Allocator:
    def __init__(self, read_meter=read_provider_meter, clock=time.time):
        self.read_meter, self.clock = read_meter, clock
        self.lock = threading.Lock()
        self.meter = None  # (used or None, at)
        self.events = []   # (at, credits) granted or spent this minute
        self.stats = {'granted': 0, 'refused': 0, 'grantedCredits': 0, 'meterReads': 0, 'unknownMeter': 0}

    @staticmethod
    def _minute(t):
        return int(t // 60)

    def _usage(self, overlap=OVERLAP):
        now = self.clock()
        minute_start = self._minute(now) * 60
        self.events = [e for e in self.events if e[0] >= minute_start]
        if self.meter is None or now - self.meter[1] >= METER_MAX_AGE or self._minute(self.meter[1]) != self._minute(now):
            self.stats['meterReads'] += 1
            used = self.read_meter()
            self.meter = (used, self.clock())
            if used is not None:
                self.events.append((self.meter[1], 1))  # the reading itself
        used, at = self.meter
        if used is None:
            return None
        same = self._minute(at) == self._minute(now)
        since = max(at - overlap, minute_start) if same else minute_start
        return (used if same else 0) + sum(c for t, c in self.events if t >= since)

    def usage(self):
        """This minute's usage for the monitor's own jobs, or None when the meter cannot be read. Their calls go out from this process
        right after the decision, so nothing granted before the reading is counted twice here: a price-alert pass is not turned away by
        the website's double-counted margin."""
        with self.lock:
            return self._usage(0.0)

    def grant(self, cost, tier):
        """True (and counted) when `cost` credits may be sent now under `tier`. Never waits."""
        if tier not in CEILING or not isinstance(cost, int) or isinstance(cost, bool) or not 0 < cost <= MAX_COST:
            return False
        with self.lock:
            used = self._usage()
            if used is None:
                self.stats['unknownMeter'] += 1
                ok = False
            else:
                ok = used + cost <= CEILING[tier]
            if ok:
                self.events.append((self.clock(), cost))
                self.stats['granted'] += 1
                self.stats['grantedCredits'] += cost
            else:
                self.stats['refused'] += 1
            return ok

    def record(self, cost):
        """Credits this monitor's own jobs sent (they decide with usage() first)."""
        if cost > 0:
            with self.lock:
                self.events.append((self.clock(), cost))


_installed = None


def install(allocator=None):
    """Called once by the monitor service; tests and the CLI leave it off (their transports are their own)."""
    global _installed
    _installed = allocator or Allocator()
    return _installed


def installed():
    return _installed


def intercept(path, params):
    """For the monitor's Twelve Data clients: an api_usage read answered from the allocator, or None to send the call."""
    if _installed is not None and path == 'api_usage':
        used = _installed.usage()
        return {'current_usage': used} if used is not None else {}
    return None


def spent(path, params):
    if _installed is not None and path != 'api_usage':
        _installed.record(credit_cost(path, params))
