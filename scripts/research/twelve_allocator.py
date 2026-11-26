"""The single Twelve Data credit allocator (owner, Nov 23: "absolutely no problem" up to 1,000 members, whatever the number of website
instances). The plan's 610 credits a minute are shared by the website (Vercel, any number of instances) and this monitor. Every
website instance asks this process for each call's credits (POST /twelve/lease, lib/research/twelve-gateway.ts), and this monitor's
own jobs report what they spend, so one place sees every credit before it is sent.

Usage this minute = the provider's meter (read here at most every METER_MAX_AGE seconds, one credit a read) + every credit granted or
spent since a little before that reading (counted twice rather than missed: a call granted just before the reading may not be in it).
A grant is all or nothing and only while usage + cost stays at or under its tier's ceiling (the same table as
lib/research/twelve-budget.ts CEILING; a test keeps them equal). An unreadable meter grants nothing to the website (it shows its last
good copies) while the monitor's jobs keep their own rules. Nothing is logged but aggregate counters; never a key.

Members first (owner: Twelve Data must never slow or stop for members, even with 1,000 of them). Production log, Nov 25: the comparison's
background job took ~455 credits at the start of every minute, so members' pages had ~25 left under their ceiling of 480. The warm and
background tiers now yield to members: their ceiling is lowered by a member reserve, at least MEMBER_RESERVE_MIN and otherwise
MEMBER_RESERVE_FACTOR times the most credits members asked for (granted or refused) in any of the last MEMBER_WINDOW minutes. A minute
in which members were refused anything leaves the jobs nothing at all for the next MEMBER_WINDOW minutes beyond what members asked.
Once a minute a summary line (credits granted and refused by tier and caller, the reserve) is printed: the measurement by caller."""
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

CEILING = {'critical': 600, 'warm': 420, 'user': 480, 'background': 400, 'fast': 200}
PLAN_CREDITS_PER_MINUTE = 610
METER_MAX_AGE = 3.0
OVERLAP = 2.0          # for the website's grants: credits granted this long before a reading are counted again (they may not be in it yet)
MAX_COST = 120         # one lease never asks for more than this
MEMBER_TIERS = ('user',)              # what members' pages ask for (the optional 15-second refresh, 'fast', is not a need)
YIELDING_TIERS = ('warm', 'background')
MEMBER_RESERVE_MIN = 60               # warm 420 + 60 = members' 480: members always have at least this much above the jobs
MEMBER_RESERVE_FACTOR = 2             # room for twice the busiest recent minute of members' asks
MEMBER_WINDOW = 5                     # minutes of members' asks remembered
CALLER = re.compile(r'[a-z][a-z0-9_-]{0,31}')  # a caller's label in the summary (the provider path); anything else counts under its tier

RESOLUTE_TIERS = ('critical', 'warm', 'background')  # RESOLUTE's jobs (lib/resolute/twelve-lease.ts); never a member page's tiers
PRIVILEGED_TOKENS = ('RESEARCH_API_TOKEN', 'RESEARCH_EDITOR_TOKEN', 'RESOLUTE_NEWS_READ_TOKEN', 'RESOLUTE_PUSH_TOKEN')


def resolute_token_ok(supplied, env=None):
    """RESOLUTE's own lease token (RESOLUTE_TWELVE_LEASE_TOKEN): at least 32 characters, never one of the monitor's other tokens. It
    opens POST /twelve/lease only, for RESOLUTE_TIERS only."""
    import hmac
    env = os.environ if env is None else env
    token = env.get('RESOLUTE_TWELVE_LEASE_TOKEN', '')
    others = [env.get(k, '') for k in PRIVILEGED_TOKENS]
    return len(token) >= 32 and token not in others and isinstance(supplied, str) and hmac.compare_digest(supplied, 'Bearer ' + token)


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
        self.member_asks = {}  # minute -> credits members asked for (granted or refused)
        self.member_refused = {}  # minute -> credits members were refused
        self.minute = None
        self.summary = self._empty_summary()
        self.log = print

    @staticmethod
    def _empty_summary():
        return {'granted': {}, 'refused': {}, 'monitor': 0, 'meter': None}

    def _roll(self, now):
        """At a new minute: print the last minute's summary (aggregate counters only) and forget member asks older than the window."""
        minute = self._minute(now)
        if self.minute == minute:
            return
        previous, summary = self.minute, self.summary
        self.minute, self.summary = minute, self._empty_summary()
        for book in (self.member_asks, self.member_refused):
            for m in [m for m in book if m < minute - MEMBER_WINDOW]:
                del book[m]
        if previous is not None and (summary['granted'] or summary['refused'] or summary['monitor']):
            try:
                line = {'event': 'twelve-minute', 'minute': time.strftime('%Y-%m-%dT%H:%M', time.gmtime(previous * 60)),
                        'meter': summary['meter'], 'granted': summary['granted'], 'refused': summary['refused'],
                        'monitor': summary['monitor'], 'memberReserve': self._member_reserve(previous)}
                self.log(json.dumps(line, sort_keys=True), flush=True)
            except Exception:
                pass

    def _member_reserve(self, minute):
        """Credits kept free for members above the jobs: the busiest of the last MEMBER_WINDOW minutes (this one included), doubled.
        A refusal of a member in that window means members asked for more than they got: the jobs leave them the whole tier."""
        recent = [c for m, c in self.member_asks.items() if minute - MEMBER_WINDOW < m <= minute]
        if any(c > 0 for m, c in self.member_refused.items() if minute - MEMBER_WINDOW < m <= minute):
            return CEILING['user']
        return max(MEMBER_RESERVE_MIN, MEMBER_RESERVE_FACTOR * max(recent, default=0))

    def ceiling(self, tier):
        """The tier's ceiling now: the warm and background jobs' is lowered while members are using the site."""
        if tier not in YIELDING_TIERS:
            return CEILING[tier]
        return max(0, min(CEILING[tier], CEILING['user'] - self._member_reserve(self._minute(self.clock()))))

    @staticmethod
    def _minute(t):
        return int(t // 60)

    def _usage(self, overlap=OVERLAP):
        now = self.clock()
        self._roll(now)
        minute_start = self._minute(now) * 60
        self.events = [e for e in self.events if e[0] >= minute_start]
        if self.meter is None or now - self.meter[1] >= METER_MAX_AGE or self._minute(self.meter[1]) != self._minute(now):
            self.stats['meterReads'] += 1
            used = self.read_meter()
            self.meter = (used, self.clock())
            if used is not None:
                self.events.append((self.meter[1], 1))  # the reading itself
                self.summary['meter'] = used
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

    def grant(self, cost, tier, caller=None):
        """True (and counted) when `cost` credits may be sent now under `tier`. Never waits. `caller` (the provider path, e.g. "quote")
        only labels the minute's summary."""
        if tier not in CEILING or not isinstance(cost, int) or isinstance(cost, bool) or not 0 < cost <= MAX_COST:
            return False
        label = f"{tier}:{caller}" if isinstance(caller, str) and CALLER.fullmatch(caller) else tier
        with self.lock:
            used = self._usage()
            minute = self._minute(self.clock())
            if tier in MEMBER_TIERS:
                self.member_asks[minute] = self.member_asks.get(minute, 0) + cost
            if used is None:
                self.stats['unknownMeter'] += 1
                ok = False
            else:
                ok = used + cost <= self.ceiling(tier)
            book = self.summary['granted' if ok else 'refused']
            book[label] = book.get(label, 0) + cost
            if ok:
                self.events.append((self.clock(), cost))
                self.stats['granted'] += 1
                self.stats['grantedCredits'] += cost
            else:
                self.stats['refused'] += 1
                if tier in MEMBER_TIERS:
                    self.member_refused[minute] = self.member_refused.get(minute, 0) + cost
            return ok

    def record(self, cost):
        """Credits this monitor's own jobs sent (they decide with usage() first)."""
        if cost > 0:
            with self.lock:
                self._roll(self.clock())
                self.events.append((self.clock(), cost))
                self.summary['monitor'] += cost


_installed = None


def install(allocator=None):
    """Called once by the monitor service; tests and the CLI leave it off (their transports are their own)."""
    global _installed
    _installed = allocator or Allocator()
    return _installed


def installed():
    return _installed


def intercept(path, params, tier=None):
    """For the monitor's Twelve Data clients: an api_usage read answered from the allocator, or None to send the call. A job of a
    yielding tier ('background') sees the usage raised by what its ceiling is lowered for members, so its own fixed ceiling yields too."""
    if _installed is not None and path == 'api_usage':
        used = _installed.usage()
        if used is not None and tier in YIELDING_TIERS:
            with _installed.lock:
                used += CEILING[tier] - _installed.ceiling(tier)
        return {'current_usage': used} if used is not None else {}
    return None


def spent(path, params):
    if _installed is not None and path != 'api_usage':
        _installed.record(credit_cost(path, params))
