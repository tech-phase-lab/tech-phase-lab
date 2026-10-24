"""Strict factual CPI release projection from the BLS news release page.

Oct 14: the CPI result reached the site only through a social-media flash and
was late. The release itself is on bls.gov at the scheduled second, so it is
read from there directly. No AI, forecasts or investment impact; anything
unclear fails closed and publishes nothing.
"""
from datetime import datetime
from decimal import Decimal
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

MONTHS = "January February March April May June July August September October November December".split()
PAGE = "https://www.bls.gov/news.release/cpi.nr0.htm"
ARCHIVE = r"/news\.release/archives/cpi_(\d{2})(\d{2})(20\d{2})\.htm"
VERB = r"(increased|rose|decreased|fell|declined)"
NUMBER = r"(\d{1,2}\.\d)"


def release_url(released):
    """The dated archive copy BLS keeps for this release (stable, one per month)."""
    return f"https://www.bls.gov/news.release/archives/cpi_{released:%m%d%Y}.htm"


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
        raise ValueError("bls-cpi-invalid-release")
    flat = " ".join(text.split())
    heading = re.findall(r"CONSUMER PRICE INDEX - ([A-Z]+) (20\d{2})\b", flat)
    if len(heading) != 1:
        raise ValueError("bls-cpi-heading-missing")
    month = heading[0][0].capitalize()
    year = int(heading[0][1])
    if month not in MONTHS:
        raise ValueError("bls-cpi-period-invalid")
    clocks = re.findall(
        r"embargoed until (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.) \((ET)\) "
        r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (20\d{2})", flat)
    if len(clocks) != 1:
        raise ValueError("bls-cpi-release-time-missing")
    hour, minute, meridiem, _zone, weekday, release_month, day, release_year = clocks[0]
    if not 1 <= int(hour) <= 12 or release_month not in MONTHS:
        raise ValueError("bls-cpi-invalid-release-time")
    hour = int(hour) % 12 + (12 if meridiem == "p.m." else 0)
    released = datetime(int(release_year), MONTHS.index(release_month) + 1, int(day), hour,
                        int(minute), tzinfo=ZoneInfo("America/New_York"))
    # The reference month is always before the month of release.
    if released.strftime("%A") != weekday or (released.year, released.month) <= (year, MONTHS.index(month) + 1):
        raise ValueError("bls-cpi-invalid-release-time")
    headline_month = re.findall(
        rf"\(CPI-U\) {VERB} {NUMBER} percent on a seasonally adjusted basis in {month}\b", flat)
    headline_year = re.findall(
        rf"Over the last 12 months, the all items index {VERB} {NUMBER} percent before seasonal adjustment", flat)
    core_month = re.findall(
        rf"The index for all items less food and energy {VERB} {NUMBER} percent in {month}\b", flat)
    core_year = re.findall(
        rf"The all items less food and energy index {VERB} {NUMBER} percent over the (?:year|last 12 months)", flat)
    # BLS repeats a sentence in its summary and detail; repeats must agree exactly.
    if not all(len(set(found)) == 1 for found in (headline_month, headline_year, core_month, core_year)):
        raise ValueError("bls-cpi-measures-missing-or-ambiguous")

    def signed(found):
        direction, number = found[0]
        if Decimal(number) > 50:
            raise ValueError("bls-cpi-measure-out-of-range")
        return ("+" if direction in {"increased", "rose"} else "-") + number + "%"

    hm, hy, cm, cy = (signed(found) for found in (headline_month, headline_year, core_month, core_year))
    number = MONTHS.index(month) + 1
    return {
        "publishedAt": released.isoformat(),
        "url": release_url(released),
        "period": f"{year}-{number:02d}",
        "title": f"U.S. {month} CPI: headline {hm} MoM / {hy} YoY; core {cm} MoM / {cy} YoY",
        "translationJa": f"米国{number}月CPI：総合 前月比{hm}・前年比{hy}／コア 前月比{cm}・前年比{cy}",
    }
