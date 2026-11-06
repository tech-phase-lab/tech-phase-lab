"""Seat counts for an election, read from the infobox of the Wikipedia articles that follow the AP count (owner, Nov 6).

Headlines say who won; they rarely carry the seat numbers. The Wikipedia election articles keep the running count in their infobox
(updated from AP), so the monitor reads it every twenty minutes while the election watch is open and adds it to the published result,
always named as such ("Wikipedia, based on the AP count"). It is a secondary source that anyone can edit, so every number is checked
before it is shown: whole numbers or a range inside the size of the chamber, the parties in the order the infobox names them, and the
House count must agree with the winner the outlets called. Anything unclear leaves the numbers out and the result unchanged.
"""
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

USER_AGENT = "TechPhaseResearch/1.0 (+https://techphase.app; research monitor)"
API = "https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&section=0&format=json&redirects=1&page="
REFRESH_SECONDS = 1200
MAX_BYTES = 400_000
CHAMBER_SIZE = {"house": 435, "senate": 100}
DEM, REP = "Democratic", "Republican"
EASTERN = timezone(timedelta(hours=-5))  # the article says "EST"; the Nov 5 timestamp is after the clocks went back


def fetch_wikitext(page):
    url = API + urllib.parse.quote(page, safe="_")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("seat-page-too-large")
    return json.loads(body)["parse"]["wikitext"]["*"]


def _field(text, name):
    match = re.search(rf"^\|\s*{name}\s*=\s*(.*)$", text, re.M)
    return match.group(1) if match else None


def _count(raw):
    """'253' or "'''253'''<!-- note -->" -> 253; '52–54{{efn|..}}' -> (52, 54); anything else -> None."""
    if raw is None:
        return None
    raw = re.sub(r"<!--.*?-->|<ref.*?(?:/>|</ref>)|\{\{.*?\}\}", "", raw, flags=re.S)
    raw = raw.replace("'''", "").replace("''", "").strip()
    if "| seats_after" in raw:
        raw = raw.split("| seats_after", 1)[1].split("=", 1)[-1].strip()
    match = re.match(r"^(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?(?=\s|$|\|)", raw)
    if not match:
        return None
    low = int(match.group(1))
    return low if match.group(2) is None else (low, int(match.group(2)))


def parse_infobox(text, chamber):
    """{'democrats': n|(low, high), 'republicans': n|(low, high), 'declared': float|None, 'asOf': iso|None} or None."""
    if not isinstance(text, str) or "party1" not in text or len(text) > MAX_BYTES:
        return None
    parties = {1: _field(text, "party1") or "", 2: _field(text, "party2") or ""}
    if DEM not in parties[1] or REP not in parties[2]:
        return None
    def seats(index):
        for name in (f"seats{index}", f"seats_after{index}"):
            value = _count(_field(text, name))
            if value is not None:
                return value
        # Some infoboxes put "seats1 = | seats_after1 = ..." on one line.
        match = re.search(rf"seats_after{index}\s*=\s*([^\n]*)", text)
        return _count(match.group(1)) if match else None
    democrats, republicans = seats(1), seats(2)
    if democrats is None or republicans is None:
        return None
    size = CHAMBER_SIZE[chamber]
    low = lambda value: value[0] if isinstance(value, tuple) else value
    high = lambda value: value[1] if isinstance(value, tuple) else value
    if low(democrats) + low(republicans) > size or high(democrats) > size or high(republicans) > size:
        return None
    declared = None
    raw = _field(text, "declared")
    if raw and re.fullmatch(r"\s*\d{1,3}(?:\.\d)?\s*", raw) and 0 <= float(raw) <= 100:
        declared = float(raw)
    as_of = None
    stamp = _field(text, "last_update")
    match = re.match(r"\s*(\d{1,2}):(\d{2}) (AM|PM), ([A-Za-z]+) (\d{1,2}), (20\d{2})", stamp or "")
    if match:
        months = "January February March April May June July August September October November December".split()
        if match.group(4) in months:
            hour = int(match.group(1)) % 12 + (12 if match.group(3) == "PM" else 0)
            as_of = datetime(int(match.group(6)), months.index(match.group(4)) + 1, int(match.group(5)), hour, int(match.group(2)), tzinfo=EASTERN).astimezone(timezone.utc).isoformat()
    return {"democrats": democrats, "republicans": republicans, "declared": declared, "asOf": as_of}


def _show(value, ja):
    if isinstance(value, tuple):
        return f"{value[0]}〜{value[1]}" if ja else f"{value[0]}-{value[1]}"
    return str(value)


def describe(figures, called):
    """(Japanese, English) sentences for the figures that survive the checks; ('', '') when none do.
    `called` maps a chamber to the party the outlets called ('democrats' / 'republicans' / None): a House count that
    disagrees with it is dropped, because one of the two sources is wrong and we cannot tell which."""
    ja, en = [], []
    for chamber in ("house", "senate"):
        data = figures.get(chamber)
        if not data:
            continue
        winner = called.get(chamber)
        d, r = data["democrats"], data["republicans"]
        if chamber == "house" and isinstance(d, int) and isinstance(r, int):
            if (winner == "democrats" and d <= r) or (winner == "republicans" and r <= d):
                continue
        name_ja, name_en = ("下院", "House") if chamber == "house" else ("上院", "Senate")
        part_ja = f"{name_ja} 民主党{_show(d, True)}・共和党{_show(r, True)}"
        part_en = f"{name_en} Democrats {_show(d, False)}, Republicans {_show(r, False)}"
        if data.get("declared") is not None:
            part_ja += f"（当確{data['declared']:g}%）"; part_en += f" ({data['declared']:g}% of seats called)"
        elif isinstance(d, tuple) or isinstance(r, tuple):
            part_ja += "（未確定の議席あり）"; part_en += " (some seats still uncalled)"
        ja.append(part_ja); en.append(part_en)
    return ("、".join(ja), "; ".join(en))


def refresh(db, watch, now, fetcher=fetch_wikitext):
    """Read each configured page at most every REFRESH_SECONDS; keep the last good figures. Errors are swallowed."""
    spec = watch.get("seats")
    if not spec:
        return
    db.execute("CREATE TABLE IF NOT EXISTS event_seats(watch_id TEXT NOT NULL, chamber TEXT NOT NULL, payload TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(watch_id, chamber))")
    for chamber, page in spec["pages"].items():
        if chamber not in CHAMBER_SIZE:
            continue
        row = db.execute("SELECT checked_at FROM event_seats WHERE watch_id=? AND chamber=?", (watch["id"], chamber)).fetchone()
        if row and (now - datetime.fromisoformat(row[0])).total_seconds() < REFRESH_SECONDS:
            continue
        try:
            data = parse_infobox(fetcher(page), chamber)
        except Exception:
            data = None
        with db:
            if data is None:
                if row:  # keep the last good figures; just remember that we looked
                    db.execute("UPDATE event_seats SET checked_at=? WHERE watch_id=? AND chamber=?", (now.isoformat(), watch["id"], chamber))
                continue
            db.execute("INSERT INTO event_seats VALUES(?,?,?,?) ON CONFLICT(watch_id,chamber) DO UPDATE SET payload=excluded.payload, checked_at=excluded.checked_at",
                       (watch["id"], chamber, json.dumps(data, ensure_ascii=False, default=list), now.isoformat()))


def stored(db, watch_id):
    try:
        rows = db.execute("SELECT chamber,payload FROM event_seats WHERE watch_id=?", (watch_id,)).fetchall()
    except Exception:
        return {}
    figures = {}
    for chamber, payload in rows:
        data = json.loads(payload)
        for party in ("democrats", "republicans"):
            if isinstance(data[party], list):
                data[party] = tuple(data[party])
        figures[chamber] = data
    return figures
