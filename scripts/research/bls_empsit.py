"""Strict factual jobs report (Employment Situation) projection from the BLS news release page.

Oct 15: CPI and PPI are read from bls.gov at the scheduled second; the jobs report joins them so
it never depends on a social-media flash. Only the two headline facts are published: the change in
total nonfarm payroll employment and the unemployment rate. Wording that is unclear, repeated with
different numbers, or missing fails closed and publishes nothing.
"""
from datetime import datetime
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

MONTHS = "January February March April May June July August September October November December".split()
PAGE = "https://www.bls.gov/news.release/empsit.nr0.htm"
ARCHIVE = r"/news\.release/archives/empsit_(\d{2})(\d{2})(20\d{2})\.htm"
UP = ("rose", "increased", "edged up", "grew", "added", "gained")
DOWN = ("fell", "decreased", "declined", "edged down", "lost", "dropped")
AMOUNT = r"(\d{1,3}(?:,\d{3})*)"


def release_url(released):
    """The dated archive copy BLS keeps for this release (stable, one per month)."""
    return f"https://www.bls.gov/news.release/archives/empsit_{released:%m%d%Y}.htm"


def is_page_url(url):
    return url == PAGE


def is_release_url(url):
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == "www.bls.gov"
            and not parsed.username and not parsed.password and not parsed.port
            and not parsed.query and not parsed.fragment
            and re.fullmatch(ARCHIVE, parsed.path) is not None)


def parse_release(text):
    """Fail closed if the period, release clock, payroll change or unemployment rate is unclear."""
    if not isinstance(text, str) or len(text) > 160_000:
        raise ValueError("bls-jobs-invalid-release")
    flat = " ".join(text.split())
    heading = re.findall(r"THE EMPLOYMENT SITUATION - ([A-Z]+) (20\d{2})\b", flat)
    if len(heading) != 1:
        raise ValueError("bls-jobs-heading-missing")
    month = heading[0][0].capitalize()
    year = int(heading[0][1])
    if month not in MONTHS:
        raise ValueError("bls-jobs-period-invalid")
    clocks = re.findall(
        r"embargoed until USDL[- ][\d-]+ (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.) \((ET)\) "
        r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (20\d{2})", flat)
    if len(clocks) != 1:
        raise ValueError("bls-jobs-release-time-missing")
    hour, minute, meridiem, _zone, weekday, release_month, day, release_year = clocks[0]
    if not 1 <= int(hour) <= 12 or release_month not in MONTHS:
        raise ValueError("bls-jobs-invalid-release-time")
    hour = int(hour) % 12 + (12 if meridiem == "p.m." else 0)
    released = datetime(int(release_year), MONTHS.index(release_month) + 1, int(day), hour,
                        int(minute), tzinfo=ZoneInfo("America/New_York"))
    # The reference month is always before the month of release.
    if released.strftime("%A") != weekday or (released.year, released.month) <= (year, MONTHS.index(month) + 1):
        raise ValueError("bls-jobs-invalid-release-time")
    up, down = "|".join(UP), "|".join(DOWN)
    payrolls = [m.replace(",", "") for m in re.findall(rf"nonfarm payroll employment \(([+-]\d{{1,3}}(?:,\d{{3}})*)\)(?:[^.]|\d\.\d){{0,160}}? in {month}\b", flat, re.I)]
    payrolls += [("" if verb.lower() in UP else "-") + n.replace(",", "") for verb, n in re.findall(
        rf"total nonfarm payroll employment ({up}|{down}) by {AMOUNT} in {month}\b", flat, re.I)]
    payrolls = [p if p.startswith("-") else p.lstrip("+") for p in payrolls]
    rates = re.findall(r"unemployment rate(?: \(| \w+ at |, at | at )(\d{1,2}\.\d) percent", flat, re.I)
    rates += re.findall(r"unemployment rate \((\d{1,2}\.\d) percent\)", flat, re.I)
    if len(set(payrolls)) != 1 or len(set(rates)) != 1:
        raise ValueError("bls-jobs-measures-missing-or-ambiguous")
    change = int(payrolls[0])
    rate = rates[0]
    if abs(change) > 3_000_000 or float(rate) > 30:
        raise ValueError("bls-jobs-measure-out-of-range")
    thousands = f"{change / 1000:+.0f}K" if change % 1000 == 0 else f"{change:+,}"
    persons = f"{change:+,}"
    number = MONTHS.index(month) + 1
    return {
        "publishedAt": released.isoformat(),
        "url": release_url(released),
        "period": f"{year}-{number:02d}",
        "title": f"U.S. {month} jobs report: nonfarm payrolls {thousands} / unemployment rate {rate}%",
        "translationJa": f"米国{number}月雇用統計：非農業部門雇用者数 {persons}人／失業率 {rate}%",
    }
