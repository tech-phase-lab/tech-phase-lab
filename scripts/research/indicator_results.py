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

- Weekly jobless claims (Nov 21): the Department of Labor's own weekly release, the PDF it publishes at dol.gov/ui/data.pdf at
  8:30 a.m. ET (normally Thursday). Its news pages still answer automated requests with HTTP 403 and are not read; the release PDF
  answers our plainly named reader (no browser disguise). "In the week ending <date>, the advance figure for seasonally adjusted
  initial claims was X, an increase/a decrease of Y from the previous week's revised level". If dol.gov starts refusing the PDF too,
  the refusal is recorded (event_feed_status) and nothing is worked around (see docs/INDICATOR-RESULTS-2026-11-05.md).
  Nov 26: the same paragraphs' 4-week average and continuing claims (insured unemployment, the week before) are read too and kept in
  the explanation; a result stored before that gets them once from the release that is still current (at most once an hour, for eight days)."""

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


# ---- Weekly jobless claims (DOL) ------------------------------------------------

CLAIMS_URL = "https://www.dol.gov/ui/data.pdf"
CLAIMS_SOURCE = "DOL（失業保険申請）"
_MONTH = r"January|February|March|April|May|June|July|August|September|October|November|December"
CLAIMS = re.compile(
    rf"In the week ending (?P<month>{_MONTH}) (?P<day>\d{{1,2}}), the advance figure for seasonally adjusted initial claims was "
    r"(?P<value>\d{1,3}(?:,\d{3})+), (?:(?:an|a) (?P<dir>increase|decrease) of (?P<change>\d{1,3}(?:,\d{3})*)|(?P<same>unchanged)) "
    r"from the previous week['’]s (?:revised|unrevised) level")
CLAIMS_RELEASE = re.compile(rf"EMBARGOED UNTIL (?P<hour>\d{{1,2}}):(?P<minute>\d{{2}}) (?P<half>[AP])\.M\. \(Eastern\) \w+day, (?P<day>(?:{_MONTH}) \d{{1,2}}, 20\d{{2}})")


def parse_claims(text):
    """The advance initial-claims figure of DOL's weekly release; None unless the wording, dates and size are as expected."""
    text = re.sub(r"\s+", " ", text)
    match, release = CLAIMS.search(text), CLAIMS_RELEASE.search(text)
    if not match or not release:
        return None
    released = long_date(release["day"])
    month = MONTHS.index(match["month"]) + 1
    # The week ends on the Saturday before the release (in the year before it, for a late-December week released in January).
    year = released.year - (1 if month > released.month else 0)
    try:
        week = datetime(year, month, int(match["day"])).date()
    except ValueError:
        return None
    if week.weekday() != 5 or not 2 <= (released - week).days <= 8:
        return None
    value = int(match["value"].replace(",", ""))
    change = 0 if match["same"] else int(match["change"].replace(",", "")) * (1 if match["dir"] == "increase" else -1)
    # A sane size: initial claims have stayed between about 160,000 and 7 million since 1967, and a week's move is smaller than the level.
    if not 100_000 <= value <= 7_000_000 or abs(change) >= value:
        return None
    clock = f"{release['hour']}:{release['minute']} {release['half'].lower()}.m."
    at = eastern_time(released, clock, "EDT" if _is_edt(released) else "EST")
    if at is None:
        return None
    return {"value": value, "change": change, "week": week, "at": at, **_claims_extras(text, week, value)}


# The rest of the release's opening paragraphs (owner, Nov 26: "PCEと同じ形で中身を"). Each figure is read only when its own sentence
# is worded as expected and its size is sane; a figure we cannot read is simply left out, never guessed.
_FIGURE = r"\d{1,3}(?:,\d{3})+"
_MOVE = r"(?:(?:an|a) (?P<dir>increase|decrease) of (?P<change>\d{1,3}(?:,\d{3})*)|(?P<same>unchanged))"
CLAIMS_AVERAGE = re.compile(
    rf"The 4-week moving average was (?P<value>{_FIGURE}), {_MOVE} from the previous week['’]s (?:revised|unrevised) average\."
    rf"(?: The previous week['’]s average was (?:revised (?:up|down) (?:by )?\d[\d,]* from (?P<before>{_FIGURE}) to {_FIGURE}|unrevised at (?P<kept>{_FIGURE}))\.)?")
CLAIMS_INSURED = re.compile(
    rf"The advance number for seasonally adjusted insured unemployment during the week ending (?P<month>{_MONTH}) (?P<day>\d{{1,2}}) was "
    rf"(?P<value>{_FIGURE}), {_MOVE} from the previous week['’]s (?:revised|unrevised) level\."
    rf"(?: The previous week['’]s level was (?:revised (?:up|down) (?:by )?\d[\d,]* from (?P<before>{_FIGURE}) to {_FIGURE}|unrevised at (?P<kept>{_FIGURE}))\.)?")


def _signed(match):
    return 0 if match["same"] else int(match["change"].replace(",", "")) * (1 if match["dir"] == "increase" else -1)


def _claims_extras(text, week, initial):
    """The 4-week average of initial claims and the insured unemployment (continuing claims) of the week before, from the same release.
    The figure each was revised from is the one the previous week's release gave, so it is kept for that week's row."""
    extras = {}
    first = CLAIMS.search(text).end()
    # Only the first figures after the initial-claims sentence: the insured-unemployment paragraph has a 4-week average of its own.
    average = CLAIMS_AVERAGE.search(text, first)
    insured = CLAIMS_INSURED.search(text, first)
    if average and (insured is None or average.start() < insured.start()):
        value, change = int(average["value"].replace(",", "")), _signed(average)
        if abs(value - initial) < initial and abs(change) < value:
            extras["average"] = {"value": value, "change": change}
            before = average["before"] or average["kept"]
            if before:
                extras["average"]["before"] = int(before.replace(",", ""))
    if insured:
        try:
            ending = datetime(week.year - (1 if int(MONTHS.index(insured["month"]) + 1) > week.month else 0), MONTHS.index(insured["month"]) + 1, int(insured["day"])).date()
        except ValueError:
            ending = None
        value, change = int(insured["value"].replace(",", "")), _signed(insured)
        # Continuing claims are for the week before the initial claims, and have stayed between about 900,000 and 25 million.
        if ending == week - timedelta(days=7) and 500_000 <= value <= 30_000_000 and abs(change) < value:
            extras["insured"] = {"value": value, "change": change, "week": ending}
            before = insured["before"] or insured["kept"]
            if before:
                extras["insured"]["before"] = int(before.replace(",", ""))
    return extras


def _week_ja(day):
    return f"{day.month}月{day.day}日終了週"


def _week_en(day):
    return f"week ending {MONTHS[day.month - 1]} {day.day}"


def _move_ja(change, unit):
    return "前週から変わらず" if change == 0 else f"前週比{abs(change):,}{unit}{'増' if change > 0 else '減'}"


def _move_en(change):
    return "unchanged from the previous week" if change == 0 else f"{'up' if change > 0 else 'down'} {abs(change):,} from the previous week"


CLAIMS_NOTE_JA = "季節調整済みの新規失業保険申請件数（速報値）を、米国労働省の週次発表から取得。市場予想との比較は含みません。"
CLAIMS_NOTE_EN = "Seasonally adjusted advance initial claims from the Department of Labor's weekly release. No consensus comparison is included."


def claims_detail(average=None, insured=None):
    """The stated extra figures as short sentences ("4週平均：196,000件（前週比1,500件減）。"), then the sourcing note.
    A figure without its change (one read from the next week's release) is shown on its own."""
    ja, en = [], []
    if average:
        ja.append(f"4週平均：{average['value']:,}件" + (f"（{_move_ja(average['change'], '件')}）" if "change" in average else "") + "。")
        en.append(f"4-week average: {average['value']:,}" + (f" ({_move_en(average['change'])})" if "change" in average else "") + ".")
    if insured:
        ja.append(f"継続受給者数：{insured['value']:,}人（{_week_ja(insured['week'])}" + (f"・{_move_ja(insured['change'], '人')}" if "change" in insured else "") + "）。")
        en.append(f"Continuing claims: {insured['value']:,} ({_week_en(insured['week'])}" + (f", {_move_en(insured['change'])}" if "change" in insured else "") + ").")
    return "".join(ja) + CLAIMS_NOTE_JA, " ".join(en + [CLAIMS_NOTE_EN])


def claims_payload(result, url, now):
    week, change = result["week"], result["change"]
    change_ja = "前週改定値から変わらず" if change == 0 else f"前週改定値から{abs(change):,}件{'増' if change > 0 else '減'}"
    change_en = "unchanged from the previous week's revised level" if change == 0 else f"{'up' if change > 0 else 'down'} {abs(change):,} from the previous week's revised level"
    detail_ja, detail_en = claims_detail(result.get("average"), result.get("insured"))
    return {
        "id": f"claims-{week.isoformat()}", "titleJa": f"米国新規失業保険申請件数（{week.month}月{week.day}日終了週）",
        "titleEn": f"U.S. initial jobless claims (week ending {MONTHS[week.month - 1]} {week.day}, {week.year})", "sourceName": "DOL",
        "releasedAt": event_results.stamp(result["at"]),
        "resultJa": f"{result['value']:,}件（{change_ja}）", "resultEn": f"{result['value']:,} ({change_en})",
        "detailJa": detail_ja, "detailEn": detail_en, "detailsRead": True,
        "sourceUrl": url, "sources": [{"publisher": "U.S. Department of Labor", "title": "Unemployment Insurance Weekly Claims", "url": url}],
        "verifiedOn": event_results.stamp(now)[:10],
    }


def _eastern(now):
    return now + timedelta(hours=-4 if _is_edt(now.date()) else -5)


def _thursday_holiday(day):
    """Thanksgiving (fourth Thursday of November), or New Year's Day, Independence Day or Christmas on a Thursday: DOL then
    releases on Wednesday."""
    return day.weekday() == 3 and ((day.month == 11 and 22 <= day.day <= 28) or (day.month, day.day) in ((1, 1), (7, 4), (12, 25)))


def claims_window(now):
    """The release comes out at 8:30 a.m. ET on Thursday, on Wednesday when Thursday is a holiday, and late (Friday) only rarely.
    The PDF is read from 8:29 a.m. to noon ET on Thursday and Friday, and on Wednesday only before a Thursday holiday; never again
    once the week's result is stored."""
    local = _eastern(now)
    minutes = local.hour * 60 + local.minute
    day = local.weekday()
    wanted = day in (3, 4) or (day == 2 and _thursday_holiday(local.date() + timedelta(days=1)))
    return wanted and 8 * 60 + 29 <= minutes <= 12 * 60


def expected_week(now):
    """The week a release made on `now`'s day (ET) reports: the Saturday before that day."""
    day = _eastern(now).date()
    return day - timedelta(days=(day.weekday() - 5) % 7 or 7)


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("pdf-too-large")
    return body


def pdf_text(content):
    """The release's first page as text, read by the monitor's resource-limited PDF reader."""
    import monitor
    return monitor.extract_pdf_text(content, first_pages=1)


CLAIMS_DETAIL_SOURCE = "DOL（失業保険申請・内訳）"
DETAIL_RETRY = timedelta(hours=1)


def _payload(db, event_id):
    row = db.execute("SELECT state,payload FROM event_results WHERE id=?", (event_id,)).fetchone()
    return (row["state"], json.loads(row["payload"])) if row else (None, None)


def _needs_details(db, now):
    """A published claims result stored before the extra figures were read (Nov 26), released within the last eight days: the release
    that holds its figures is still the current PDF. Asked again at most once an hour, so a release we cannot read is not fetched on
    every pass."""
    row = db.execute("SELECT id,payload FROM event_results WHERE id LIKE 'claims-%' AND state='published' ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return False
    payload = json.loads(row["payload"])
    if payload.get("detailsRead") or now - event_results.parse_time(payload["releasedAt"]) > timedelta(days=8):
        return False
    tried = db.execute("SELECT checked_at FROM event_feed_status WHERE publisher=?", (CLAIMS_DETAIL_SOURCE,)).fetchone()
    return not tried or now - event_results.parse_time(tried["checked_at"]) >= DETAIL_RETRY


def _add_details(db, result, now):
    """Adds the extra figures to the week's stored result, and to the week before's (the figures this release says it was revised
    from are the ones that week's own release gave). Only the explanation changes: the result line, its time and its notification stay."""
    weeks = [(result["week"], result.get("average"), result.get("insured"), True)]
    before = {"average": result.get("average", {}).get("before"), "insured": result.get("insured", {}).get("before")}
    weeks.append((result["week"] - timedelta(days=7), before["average"] and {"value": before["average"]},
                  before["insured"] and {"value": before["insured"], "week": result["insured"]["week"] - timedelta(days=7)}, False))
    changed = 0
    for week, average, insured, read in weeks:
        state, payload = _payload(db, f"claims-{week.isoformat()}")
        if state != "published" or payload.get("detailsRead") or not (read or average or insured):
            continue
        payload["detailJa"], payload["detailEn"] = claims_detail(average or None, insured or None)
        payload["detailsRead"] = True
        event_results._store(db, payload["id"], "published", payload, now, keep_time=True)
        changed += 1
    return changed


def _claims(db, now, fetch_pdf, read_pdf):
    fresh = claims_window(now) and not _stored(db, f"claims-{expected_week(now).isoformat()}")
    details = not fresh and _needs_details(db, now)
    if not fresh and not details:
        return 0
    source = CLAIMS_SOURCE if fresh else CLAIMS_DETAIL_SOURCE
    def work():
        result = parse_claims(read_pdf(fetch_pdf(CLAIMS_URL)))
        if result is None:
            _status(db, source, now, False, "wording-not-recognised")
            return 0
        _status(db, source, now, True)
        # Before 8:30 the PDF still holds the week before: that result is stored once (if it is not already) and nothing else happens.
        saved = 0 if _stored(db, f"claims-{result['week'].isoformat()}") else _save(db, claims_payload(result, CLAIMS_URL, now), now)
        _add_details(db, result, now)
        return saved
    return _guard(db, source, now, work)


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


def run_once(db_path, now=None, config=None, transport=None, fetch_pdf=None, read_pdf=None):
    """One pass over the official pages (and, around its release, DOL's claims PDF). Returns how many results were newly stored."""
    now = now or datetime.now(timezone.utc)
    config = config or load_config()
    # A caller that hands in its own page reader (a test) reads the PDF only through its own `fetch_pdf`, never the network.
    fetch_pdf = fetch_pdf or (fetch_bytes if transport is None else None)
    transport = transport or fetch
    with event_results.connect(db_path) as db:
        return (_fomc(db, config, now, transport) + _gdp(db, config, now, transport) + _retail(db, config, now, transport)
                + (_claims(db, now, fetch_pdf, read_pdf or pdf_text) if fetch_pdf else 0))


def next_wait(now=None):
    """Seconds until the next pass: every 30 s around the usual 8:30 a.m. release time (U.S. Eastern) and the Fed's 2 p.m., else every 5 minutes."""
    now = now or datetime.now(timezone.utc)
    offset = -4 if _is_edt(now.date()) else -5
    local = now + timedelta(hours=offset)
    minutes = local.hour * 60 + local.minute
    fast = local.weekday() < 5 and (8 * 60 + 28 <= minutes <= 8 * 60 + 50 or 13 * 60 + 58 <= minutes <= 14 * 60 + 30)
    return FAST_SECONDS if fast else NORMAL_SECONDS
