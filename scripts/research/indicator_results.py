"""Official results of the economic indicators that have no reader of their own yet (owner, Nov 5).

FOMC, GDP and retail sales are read from the official page of the body that publishes them, and only from it:

- FOMC: the Federal Reserve's statement (federalreserve.gov/newsevents/pressreleases/monetary<date>a.htm); the sentence
  "The Committee decided to maintain/lower/raise the target range for the federal funds rate ... to X to Y percent".
- GDP: BEA's release page (found through BEA's list of current releases); "Real gross domestic product ... increased/decreased
  at an annual rate of X percent in the ... quarter".
- Retail sales: the Census Bureau's current release page; "sales for <month> ... were $X billion, up/down Y percent".

Nothing here writes a word: the Japanese and English text is fixed wording around numbers taken from the page. A page whose wording
differs from what is expected is not read, and the miss is recorded (event_feed_status), never guessed. A figure outside a sane range
is not read either. Results are stored in the same table as the other event results and reach the site through the same lane.

Weekly jobless claims are not read: the Department of Labor's own page refuses automated requests (HTTP 403) and the weekly claims
table on its data site was weeks behind. We do not work around a site's bot block, so claims stay a calendar entry without a result
until the Department of Labor offers a way to read it (see docs/INDICATOR-RESULTS-2026-11-05.md)."""

import html
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import event_results

CONFIG_PATH = Path(__file__).with_name("indicator_sources.json")
MAX_BYTES = 3_000_000
USER_AGENT = "TechPhaseResearch/1.0 (+https://techphase.app)"
EASTERN = {"EDT": -4, "EST": -5}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
QUARTERS = {"first": 1, "second": 2, "third": 3, "fourth": 4}
FAST_SECONDS = 30
NORMAL_SECONDS = 300


def load_config(path=CONFIG_PATH):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("version") != 1:
        raise ValueError("invalid-indicator-sources")
    return value


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("page-too-large")
    return body.decode("utf-8", "replace")


def page_text(markup):
    """The visible words of a page, one line of single spaces."""
    markup = re.sub(r"<script.*?</script>|<style.*?</style>", " ", markup, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()


def fraction(text):
    """"3-3/4" -> 3.75, "4" -> 4.0, "1/4" -> 0.25; None when it is not a plain number or fraction."""
    match = re.fullmatch(r"(\d+)(?:-(\d+)/(\d+))?|(\d+)/(\d+)", text.strip())
    if not match:
        return None
    whole, num, den, only_num, only_den = match.groups()
    if only_num is not None:
        return int(only_num) / int(only_den) if int(only_den) else None
    if num is None:
        return float(int(whole))
    return int(whole) + int(num) / int(den) if int(den) else None


def eastern_time(day, clock, zone):
    """"October 28, 2026" + "2:00 p.m." + "EDT" -> aware UTC time."""
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))? ?([ap])\.?m\.?", clock.strip(), re.I)
    if not match or zone not in EASTERN:
        return None
    hour = int(match.group(1)) % 12 + (12 if match.group(3).lower() == "p" else 0)
    local = datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=int(match.group(2) or 0), tzinfo=timezone(timedelta(hours=EASTERN[zone])))
    return local.astimezone(timezone.utc)


def long_date(text):
    match = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})", text)
    return datetime(int(match.group(3)), MONTHS.index(match.group(1)) + 1, int(match.group(2))).date() if match else None


# ---- FOMC ---------------------------------------------------------------------

FOMC = re.compile(
    r"The Committee decided to (?P<act>maintain|lower|raise) the target range for the federal funds rate "
    r"(?:by (?P<by>[\d\-/]+) percentage points? )?(?:at|to) (?P<lo>[\d\-/]+) to (?P<hi>[\d\-/]+) percent")
VOTE = re.compile(r"approved the following statement for release by an? (?P<yes>\d+) [–\-] (?P<no>\d+) vote")


def parse_fomc(text, meeting):
    """The rate decision of the statement released on `meeting` (a date); None when the page does not state one plainly."""
    match = FOMC.search(text)
    release = re.search(r"For release at (\d{1,2}(?::\d{2})? [ap]\.m\.) (E[DS]T)", text)
    if not match or not release or long_date(text) != meeting:
        return None
    low, high, step = fraction(match["lo"]), fraction(match["hi"]), fraction(match["by"]) if match["by"] else None
    # A policy range is a quarter-point wide, in quarter-point steps, between 0 and 10 percent.
    if low is None or high is None or not 0 <= low < high <= 10 or round(high - low, 4) != 0.25 or (low * 4) % 1:
        return None
    if (match["act"] == "maintain") != (step is None) or (step is not None and (step <= 0 or (step * 4) % 1)):
        return None
    vote = VOTE.search(text)
    at = eastern_time(meeting, release.group(1), release.group(2))
    if at is None:
        return None
    return {"action": match["act"], "low": low, "high": high, "step": step, "yes": int(vote["yes"]) if vote else None, "no": int(vote["no"]) if vote else None, "at": at}


def fomc_payload(decision, meeting, url, now):
    low, high = f"{decision['low']:.2f}", f"{decision['high']:.2f}"
    month = meeting.month
    verb_ja = {"maintain": "据え置き", "lower": f"{decision['step']:.2f}ポイント引き下げ" if decision["step"] else "引き下げ", "raise": f"{decision['step']:.2f}ポイント引き上げ" if decision["step"] else "引き上げ"}[decision["action"]]
    verb_en = {"maintain": "held", "lower": "cut", "raise": "raised"}[decision["action"]]
    vote_ja = f"賛成{decision['yes']}・反対{decision['no']}の採決でした。" if decision["yes"] is not None else ""
    vote_en = f"The vote was {decision['yes']} to {decision['no']}. " if decision["yes"] is not None else ""
    return {
        "id": f"fomc-{meeting.isoformat()}", "titleJa": f"FOMC 政策金利（{month}月会合）", "titleEn": f"FOMC rate decision ({MONTHS[month - 1]} {meeting.year})",
        "sourceName": "FRB", "releasedAt": event_results.stamp(decision["at"]),
        "resultJa": f"政策金利を{verb_ja}（{low}〜{high}%）", "resultEn": f"Policy rate {verb_en}: target range {low}% to {high}%",
        "detailJa": f"FRBの声明文から、フェデラルファンド金利の誘導目標レンジを取得。{vote_ja}市場予想との比較は含みません。",
        "detailEn": f"Target range for the federal funds rate from the Fed's statement. {vote_en}No consensus comparison is included.",
        "sourceUrl": url, "sources": [{"publisher": "Federal Reserve", "title": "Federal Reserve issues FOMC statement", "url": url}], "verifiedOn": event_results.stamp(now)[:10],
    }


# ---- GDP ----------------------------------------------------------------------

GDP_LINK = re.compile(r"/news/(20\d{2})/gdp-(advance|second|third)-estimate-(\d)(?:st|nd|rd|th)-quarter(?:-and-year)?-(20\d{2})")
GDP = re.compile(
    r"Real gross domestic product \(GDP\) (?P<dir>increased|decreased) at an annual rate of (?P<num>\d{1,2}\.\d) percent in the "
    r"(?P<quarter>first|second|third|fourth) quarter of (?P<year>20\d{2})[^.]*?according to the (?P<est>advance|second|third) estimate")


def parse_gdp(text):
    match = GDP.search(text)
    release = re.search(r"EMBARGOED UNTIL RELEASE AT (\d{1,2}(?::\d{2})? [ap]\.m\.) (E[DS]T), \w+day, ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2})", text)
    if not match or not release:
        return None
    value = float(match["num"])
    if not 0 <= value <= 30:
        return None
    at = eastern_time(long_date(release.group(3)), release.group(1), release.group(2))
    if at is None:
        return None
    return {"value": value if match["dir"] == "increased" else -value, "quarter": QUARTERS[match["quarter"]], "year": int(match["year"]), "estimate": match["est"], "at": at}


def gdp_payload(result, url, now):
    value = f"{result['value']:+.1f}"
    kind_ja = {"advance": "速報", "second": "改定値", "third": "確報"}[result["estimate"]]
    quarter_ja = {1: "1〜3月期", 2: "4〜6月期", 3: "7〜9月期", 4: "10〜12月期"}[result["quarter"]]
    return {
        "id": f"gdp-{result['year']}-q{result['quarter']}-{result['estimate']}", "titleJa": f"米国GDP（{quarter_ja}・{kind_ja}）",
        "titleEn": f"U.S. GDP (Q{result['quarter']} {result['year']}, {result['estimate']} estimate)", "sourceName": "BEA", "releasedAt": event_results.stamp(result["at"]),
        "resultJa": f"実質GDP 前期比年率{value}%", "resultEn": f"Real GDP {value}% annualized",
        "detailJa": "実質GDPの前期比年率をBEAの公式発表から取得。市場予想との比較は含みません。", "detailEn": "Annualized quarterly change in real GDP from BEA's release. No consensus comparison is included.",
        "sourceUrl": url, "sources": [{"publisher": "BEA", "title": f"GDP ({result['estimate'].title()} Estimate)", "url": url}], "verifiedOn": event_results.stamp(now)[:10],
    }


# ---- Retail sales ---------------------------------------------------------------

RETAIL = re.compile(
    r"Advance estimates of U\.S\. retail and food services sales for (?P<month>[A-Z][a-z]+) (?P<year>20\d{2}), adjusted for seasonal variation[^$]*?were "
    r"\$(?P<amount>[\d,.]+) billion, (?P<dir>up|down) (?P<num>\d{1,2}\.\d) percent \(")


def parse_retail(text):
    match = RETAIL.search(text)
    day = re.search(r"FOR IMMEDIATE RELEASE: \w+day, ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2})", text)
    if not match or not day or match["month"] not in MONTHS:
        return None
    value, amount = float(match["num"]), float(match["amount"].replace(",", ""))
    # A month's change beyond ten percent, or sales outside a sane size, is not read.
    if not 0 <= value <= 10 or not 300 <= amount <= 2000:
        return None
    return {"value": value if match["dir"] == "up" else -value, "amount": amount, "month": MONTHS.index(match["month"]) + 1, "year": int(match["year"]),
            "at": eastern_time(long_date(day.group(1)), "8:30 a.m.", "EDT" if _is_edt(long_date(day.group(1))) else "EST")}


def _is_edt(day):
    """U.S. daylight time: second Sunday of March to first Sunday of November."""
    march = datetime(day.year, 3, 8).date(); march += timedelta(days=(6 - march.weekday()) % 7)
    november = datetime(day.year, 11, 1).date(); november += timedelta(days=(6 - november.weekday()) % 7)
    return march <= day < november


def retail_payload(result, url, now):
    value = f"{result['value']:+.1f}"
    return {
        "id": f"retail-{result['year']}-{result['month']:02d}", "titleJa": f"米国小売売上高（{result['month']}月・速報）", "titleEn": f"U.S. retail sales ({MONTHS[result['month'] - 1]} {result['year']}, advance)",
        "sourceName": "Census Bureau", "releasedAt": event_results.stamp(result["at"]),
        "resultJa": f"前月比{value}%（売上高 {result['amount']:,.1f}十億ドル）",
        "resultEn": f"{value}% from the previous month (${result['amount']:,.1f} billion)",
        "detailJa": "小売・飲食サービス売上高の前月比を、米国勢調査局の公式発表から取得。市場予想との比較は含みません。", "detailEn": "Monthly change in retail and food services sales from the Census Bureau's release. No consensus comparison is included.",
        "sourceUrl": url, "sources": [{"publisher": "Census Bureau", "title": "Advance Monthly Sales for Retail and Food Services", "url": url}], "verifiedOn": event_results.stamp(now)[:10],
    }


# ---- running -------------------------------------------------------------------

def _status(db, name, now, ok, error=None):
    with db:
        db.execute("INSERT INTO event_feed_status VALUES(?,?,?,?,?) ON CONFLICT(publisher) DO UPDATE SET checked_at=excluded.checked_at,ok=excluded.ok,error=excluded.error,items=excluded.items",
                   (name, event_results.stamp(now), 1 if ok else 0, error, 0))


def _stored(db, event_id):
    row = db.execute("SELECT state FROM event_results WHERE id=?", (event_id,)).fetchone()
    return row["state"] if row else None


def _save(db, payload, now):
    if _stored(db, payload["id"]) is None:
        event_results._store(db, payload["id"], "published", payload, now)
        return 1
    return 0


def _guard(db, name, now, work):
    """One reader's turn. A page that cannot be read, or whose wording we do not recognise, is recorded and never stops the others."""
    try:
        return work()
    except urllib.error.HTTPError as error:
        # The statement page does not exist until the release; that is not a failure.
        _status(db, name, now, error.code == 404, "not-published-yet" if error.code == 404 else f"HTTPError:{error.code}")
    except Exception as error:
        _status(db, name, now, False, f"{type(error).__name__}:{str(error)[:60]}")
    return 0


def _fomc(db, config, now, transport):
    saved = 0
    for text in config.get("fomcMeetings", []):
        meeting = datetime.strptime(text, "%Y-%m-%d").date()
        opens = datetime.combine(meeting, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=17, minutes=55)
        if not opens <= now <= opens + timedelta(days=14) or _stored(db, f"fomc-{text}"):
            continue
        url = f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{meeting:%Y%m%d}a.htm"
        def work(meeting=meeting, url=url):
            decision = parse_fomc(page_text(transport(url)), meeting)
            if decision is None:
                _status(db, "FRB（FOMC声明）", now, False, "wording-not-recognised")
                return 0
            _status(db, "FRB（FOMC声明）", now, True)
            return _save(db, fomc_payload(decision, meeting, url, now), now)
        saved += _guard(db, "FRB（FOMC声明）", now, work)
    return saved


def _gdp(db, config, now, transport):
    index = "https://www.bea.gov/news/current-releases"
    def work():
        links = sorted({m.group(0) for m in GDP_LINK.finditer(transport(index))})
        _status(db, "BEA（発表一覧）", now, True)
        saved = 0
        for link in links:
            match = GDP_LINK.fullmatch(link)
            year, estimate, quarter = int(match.group(4)), match.group(2), int(match.group(3))
            if _stored(db, f"gdp-{year}-q{quarter}-{estimate}"):
                continue
            url = "https://www.bea.gov" + link
            result = parse_gdp(page_text(transport(url)))
            # The page must say the same quarter and estimate as its address.
            if result is None or (result["year"], result["quarter"], result["estimate"]) != (year, quarter, estimate):
                _status(db, "BEA（GDP）", now, False, "wording-not-recognised")
                continue
            _status(db, "BEA（GDP）", now, True)
            saved += _save(db, gdp_payload(result, url, now), now)
        return saved
    return _guard(db, "BEA（発表一覧）", now, work)


def _retail(db, config, now, transport):
    url = "https://www.census.gov/retail/sales.html"
    def work():
        result = parse_retail(page_text(transport(url)))
        if result is None:
            _status(db, "Census（小売売上高）", now, False, "wording-not-recognised")
            return 0
        _status(db, "Census（小売売上高）", now, True)
        return 0 if _stored(db, f"retail-{result['year']}-{result['month']:02d}") else _save(db, retail_payload(result, url, now), now)
    return _guard(db, "Census（小売売上高）", now, work)


def run_once(db_path, now=None, config=None, transport=None):
    """One pass over the three official pages. Returns how many results were newly stored."""
    now = now or datetime.now(timezone.utc)
    config = config or load_config()
    transport = transport or fetch
    with event_results.connect(db_path) as db:
        return _fomc(db, config, now, transport) + _gdp(db, config, now, transport) + _retail(db, config, now, transport)


def next_wait(now=None):
    """Seconds until the next pass: every 30 s around the usual 8:30 a.m. release time (U.S. Eastern) and the Fed's 2 p.m., else every 5 minutes."""
    now = now or datetime.now(timezone.utc)
    offset = -4 if _is_edt(now.date()) else -5
    local = now + timedelta(hours=offset)
    minutes = local.hour * 60 + local.minute
    fast = local.weekday() < 5 and (8 * 60 + 28 <= minutes <= 8 * 60 + 50 or 13 * 60 + 58 <= minutes <= 14 * 60 + 30)
    return FAST_SECONDS if fast else NORMAL_SECONDS
