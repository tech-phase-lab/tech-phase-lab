"""Strict factual PPI release projection from the BLS news release page.

Oct 15: the PPI result did not reach the site at all, because only CPI was read from
bls.gov directly. Same rules as bls_cpi: the page is read at the scheduled second, no AI,
no forecasts, and anything unclear fails closed and publishes nothing.
"""
from datetime import datetime
from decimal import Decimal
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

MONTHS = "January February March April May June July August September October November December".split()
PAGE = "https://www.bls.gov/news.release/ppi.nr0.htm"
ARCHIVE = r"/news\.release/archives/ppi_(\d{2})(\d{2})(20\d{2})\.htm"
UP = ("increased", "rose", "moved up", "climbed", "advanced", "edged up", "jumped", "inched up")
DOWN = ("decreased", "fell", "declined", "dropped", "edged down", "moved down", "slipped")
VERB = "(" + "|".join(UP + DOWN) + ")"
NUMBER = r"(\d{1,2}\.\d)"
CORE = "final demand less foods, energy, and trade services"


def release_url(released):
    """The dated archive copy BLS keeps for this release (stable, one per month)."""
    return f"https://www.bls.gov/news.release/archives/ppi_{released:%m%d%Y}.htm"


def is_page_url(url):
    return url == PAGE


def is_release_url(url):
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == "www.bls.gov"
            and not parsed.username and not parsed.password and not parsed.port
            and not parsed.query and not parsed.fragment
            and re.fullmatch(ARCHIVE, parsed.path) is not None)


def parse_release(text):
    """Fail closed if the period, release clock or any of the four measures is unclear."""
    if not isinstance(text, str) or len(text) > 160_000:
        raise ValueError("bls-ppi-invalid-release")
    flat = " ".join(text.split())
    heading = re.findall(r"PRODUCER PRICE INDEXES - ([A-Z]+) (20\d{2})\b", flat)
    if len(heading) != 1:
        raise ValueError("bls-ppi-heading-missing")
    month = heading[0][0].capitalize()
    year = int(heading[0][1])
    if month not in MONTHS:
        raise ValueError("bls-ppi-period-invalid")
    clocks = re.findall(
        r"embargoed until USDL [\d-]+ (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.) \((ET)\) "
        r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (20\d{2})", flat)
    if len(clocks) != 1:
        raise ValueError("bls-ppi-release-time-missing")
    hour, minute, meridiem, _zone, weekday, release_month, day, release_year = clocks[0]
    if not 1 <= int(hour) <= 12 or release_month not in MONTHS:
        raise ValueError("bls-ppi-invalid-release-time")
    hour = int(hour) % 12 + (12 if meridiem == "p.m." else 0)
    released = datetime(int(release_year), MONTHS.index(release_month) + 1, int(day), hour,
                        int(minute), tzinfo=ZoneInfo("America/New_York"))
    # The reference month is always before the month of release.
    if released.strftime("%A") != weekday or (released.year, released.month) <= (year, MONTHS.index(month) + 1):
        raise ValueError("bls-ppi-invalid-release-time")
    headline_month = re.findall(
        rf"The Producer Price Index for final demand {VERB} {NUMBER} percent in {month}, seasonally adjusted", flat)
    headline_year = re.findall(
        rf"On an unadjusted basis, the index for final demand {VERB} {NUMBER} percent for the 12 months ended in {month}\b", flat)
    core_month = re.findall(
        rf"Prices for {CORE} {VERB} {NUMBER} percent in {month}\b", flat)
    core_year = re.findall(
        rf"For the 12 months ended in {month}, the index for {CORE} {VERB} {NUMBER} percent", flat)
    # BLS repeats a sentence in its summary and detail; repeats must agree exactly.
    if not all(found and len(set(found)) == 1 for found in (headline_month, headline_year, core_month, core_year)):
        raise ValueError("bls-ppi-measures-missing-or-ambiguous")

    def signed(found):
        direction, number = found[0]
        if Decimal(number) > 50:
            raise ValueError("bls-ppi-measure-out-of-range")
        return ("+" if direction in UP else "-") + number + "%"

    hm, hy, cm, cy = (signed(found) for found in (headline_month, headline_year, core_month, core_year))
    number = MONTHS.index(month) + 1
    return {
        "publishedAt": released.isoformat(),
        "url": release_url(released),
        "period": f"{year}-{number:02d}",
        "title": f"U.S. {month} PPI: final demand {hm} MoM / {hy} YoY; core {cm} MoM / {cy} YoY",
        "translationJa": f"米国{number}月PPI：総合 前月比{hm}・前年比{hy}／コア 前月比{cm}・前年比{cy}",
    }
