"""Strict factual PCE release projection. No AI, forecasts or investment impact."""
from datetime import datetime
from decimal import Decimal
import re
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

MONTHS = "January February March April May June July August September October November December".split()
PATH = r"/news/(20\d{2})/personal-income-and-outlays-([a-z]+)-(20\d{2})"


def release_title(text):
    # BEA has a generic first H1, followed by the actual release heading.
    headings = re.findall(r"BEA \d{2}[–-]\d{2}\s+(Personal Income and Outlays, [A-Za-z]+ 20\d{2})", text)
    if len(headings) != 1:
        raise ValueError("bea-pce-release-heading-missing")
    return headings[0]


def is_release_url(url):
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == "www.bea.gov"
            and not parsed.username and not parsed.password and not parsed.port
            and not parsed.query and not parsed.fragment
            and re.fullmatch(PATH, parsed.path) is not None)


def canonical_release_url(url):
    """Collapse BEA's observed Drupal front-controller alias, only for PCE."""
    parsed = urlsplit(url)
    path = parsed.path.removeprefix('/index.php') if parsed.path.startswith('/index.php/news/') else parsed.path
    candidate = urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))
    return candidate if is_release_url(candidate) else None


def parse_release(title, text, url):
    """Fail closed if period, release clock or any of the four measures is unclear."""
    if not is_release_url(url) or not isinstance(text, str) or len(text) > 160_000:
        raise ValueError("bea-pce-invalid-release")
    heading = re.fullmatch(r"Personal Income and Outlays, ([A-Za-z]+) (20\d{2})", title.strip())
    path = re.fullmatch(PATH, urlsplit(url).path)
    if (not heading or heading[1] not in MONTHS or heading[1].lower() != path[2]
            or heading[2] != path[3]):
        raise ValueError("bea-pce-period-mismatch")
    month, year = heading[1], int(heading[2])
    clocks = re.findall(
        r"EMBARGOED UNTIL RELEASE AT (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.) (EDT|EST), "
        r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (20\d{2})",
        text,
    )
    if len(clocks) != 1:
        raise ValueError("bea-pce-release-time-missing")
    hour, minute, meridiem, abbreviation, weekday, release_month, day, release_year = clocks[0]
    if not 1 <= int(hour) <= 12 or release_month not in MONTHS:
        raise ValueError("bea-pce-invalid-release-time")
    hour = int(hour) % 12 + (12 if meridiem == "p.m." else 0)
    released = datetime(int(release_year), MONTHS.index(release_month) + 1, int(day), hour,
                        int(minute), tzinfo=ZoneInfo("America/New_York"))
    if (released.tzname() != abbreviation or released.strftime("%A") != weekday
            or (released.year, released.month) <= (year, MONTHS.index(month) + 1)):
        raise ValueError("bea-pce-invalid-release-time")
    flat = " ".join(text.split())
    value = r"(increased|decreased) (\d{1,2}\.\d{1,3}) percent"
    monthly = re.findall(
        rf"From the preceding month, the PCE price index for {month} {value}\. "
        rf"Excluding food and energy, the PCE price index (?:also )?{value}\.", flat)
    annual = re.findall(
        rf"From the same month one year ago, the PCE price index for {month} {value}\. "
        rf"Excluding food and energy, the PCE price index {value} from one year ago\.", flat)
    if len(monthly) != 1 or len(annual) != 1:
        raise ValueError("bea-pce-measures-missing-or-ambiguous")

    def signed(direction, number):
        if Decimal(number) > 50:
            raise ValueError("bea-pce-measure-out-of-range")
        return ("+" if direction == "increased" else "-") + number + "%"

    hm, cm = signed(*monthly[0][:2]), signed(*monthly[0][2:])
    hy, cy = signed(*annual[0][:2]), signed(*annual[0][2:])
    return {
        "publishedAt": released.isoformat(),
        "title": f"U.S. {month} PCE: headline {hm} MoM / {hy} YoY; core {cm} MoM / {cy} YoY",
        "translationJa": f"米国{MONTHS.index(month) + 1}月PCE：総合 前月比{hm}・前年比{hy}／コア 前月比{cm}・前年比{cy}",
    }
