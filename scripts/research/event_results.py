"""Big non-numeric events (an election, ...) turned into "発表済みの結果" automatically (owner, Nov 4).

The earnings and indicator channels only read numbers. An event such as the U.S. midterms has no number to read, so it used to
reach the site only when a person noticed. This reads the public headline feeds of major outlets while a watch is open and
publishes a result only when it is solid:

- a headline counts only if it has the shape of a call: a party, a winning verb and a chamber, close together, with no hedge
  ("could", "poll", "odds", "if", ...). "Democrats win the House" counts; "Democrats could win the House" does not.
- the same claim must come from at least two different outlets inside the watch's time window;
- if both parties are reported as winning the same chamber, nothing is published (held as a conflict);
- the Japanese and English wording is fixed text from the watch file. The model writes nothing and no number is shown;
- the owner can withdraw a result, and a withdrawn result is never published again.

A watch can also be numeric (ADP's private payrolls, Nov 4): the figure is read from headlines ("ADP: private employers added
42,000 jobs") and published only when at least two different outlets give the very same signed figure. A figure that comes after
a word of expectation ("expected", "forecast", "likely", ...) is never read, and a weekly or average figure is never read."""

import json
import re
import sqlite3
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit

CONFIG_PATH = Path(__file__).with_name("event_watches.json")
MAX_BYTES = 2_000_000
USER_AGENT = "TechPhaseResearch/1.0 (+https://techphase.app)"
POLL_SECONDS = 300
IDLE_SECONDS = 900

PARTIES = {"democrats": r"(?:democrats|dems|democratic party)", "republicans": r"(?:republicans|gop)"}
CHAMBERS = {"house": r"(?<!white )house(?: of representatives)?", "senate": r"senate"}
BOTH = r"(?:both (?:the )?(?:house and (?:the )?senate|chambers(?: of congress)?)|congress)"
VERBS = (r"(?:wins?|won|take[sn]?|took|flips?|flipped|seiz(?:e|es|ed)|captur(?:e|es|ed)|retak(?:e|es|ing)|retook|clinch(?:es|ed)?|"
         r"secur(?:e|es|ed)|hold|holds|held|keeps?|kept|retains?|retained|gains?|gained|(?:will|to) (?:win|take|flip|hold|keep|control))")
FILLER = r"(?:\s+(?:the|control|of|a|an|majority|in|power|back|full|outright|narrow|slim))*"
HEDGE = re.compile(r"\b(?:could|might|may|can|would|if|whether|polls?|odds|chances?|forecasts?|predict\w*|expect\w*|hope\w*|bid|race to|path to|"
                   r"need|needs|must|looks? to|aims?|aiming|fights?|fighting|battles?|battling|struggl\w*|lose|loses|lost|losing|risk|fears?|"
                   r"worr\w*|favou?red|leans?|toss-?up|too close|yet to|not yet|no clear)\b", re.I)


UP = r"(?:added|adds|add|rose|rise|rises|gained|gains|gain|grew|grow|grows|jumped|jump|jumps|climbed|climb|climbs|increased|increase|increases|hired|created|surged|surge|surges)"
DOWN = r"(?:lost|loses|lose|shed|sheds|fell|fall|falls|dropped|drop|drops|slid|slide|slides|slipped|slip|slips|cut|cuts|declined|decline|declines|decreased|decrease|decreases|shrank|shrink|shrinks)"
FIGURE = r"(?P<num>\d{1,3}(?:,\d{3})+|\d{3,7}|\d{1,3}(?=K\b))(?P<k>K)?\b"
# Words of expectation anywhere before the figure, or a comparison word right before it ("vs 90,000", "from 133,000"), mean it is not the result.
EXPECTING = re.compile(r"\b(?:expect\w*|forecast\w*|likely|estimate[sd]?|consensus|project\w*|seen|predict\w*|poll|survey|economists?|anticipat\w*|preview|ahead of)\b", re.I)
COMPARING = re.compile(r"(?:\bvs\.?|\bversus|\bthan|\bfrom|\bprior|\bprevious\w*|\brevised?|\bto)\W*(?:\w+\W+){0,2}$", re.I)
NOT_MONTHLY = re.compile(r"\b(?:week|weekly|pulse|average|averaged|four-week|4-week|per week|a week)\b", re.I)


def read_figure(title, spec):
    """The signed integer a headline states as the result (None when it is not a plain statement of the result)."""
    if not isinstance(title, str) or len(title) > 300 or NOT_MONTHLY.search(title):
        return None
    if not all(re.search(rule, title, re.I) for rule in spec["must"]):
        return None
    found = []
    for sign, verbs in (("+", UP), ("-", DOWN)):
        for match in re.finditer(rf"\b{verbs}\b(?:\s+(?:by|about|nearly|roughly|only|just|an? )?)?\s*(?:[+\-−]?\s*)?{FIGURE}", title, re.I):
            found.append((match.start(), sign, match))
    # The figure may come first: "86,000 jobs added".
    for sign, verbs in (("+", UP), ("-", DOWN)):
        for match in re.finditer(rf"{FIGURE}\s+(?:new\s+)?jobs?\s+(?:were\s+|was\s+)?\b{verbs}\b", title, re.I):
            found.append((match.start(), sign, match))
    # An explicit sign right before the figure ("ADP: private payrolls +42K") counts too.
    for match in re.finditer(rf"(?<![\w,.])(?P<sign>[+\-−])\s?{FIGURE}", title):
        found.append((match.start(), "-" if match["sign"] in "-−" else "+", match))
    for _, sign, match in sorted(found, key=lambda item: item[0]):
        before = title[:match.start()]
        if EXPECTING.search(before) or COMPARING.search(before[-30:]):
            continue
        value = int(match["num"].replace(",", "")) * (1000 if match["k"] else 1)
        if 100 <= value <= 1_000_000:
            return int(f"{sign}{value}")
    return None


SEAT = r"(?P<n>\d{2,3})\s+(?P<chamber>House|Senate)\s+seats?"
TALLY_HEDGE = re.compile(r"\b(?:at least|more than|over|up to|nearly|almost|around|about|roughly|could|might|may|would|if|projected to (?:win|hold|have)|on track|poised|expect\w*|forecast\w*|likely|polls?|odds|need\w*|must|to win)\b", re.I)


def read_tallies(title, spec):
    """{(party, chamber): seats} a headline states as the current count ("Democrats now have 54 Senate seats, Republicans 44").
    A figure with "at least", "on track", "need" and the like is not a count, and nothing is read from a hedged headline."""
    if not isinstance(title, str) or len(title) > 300 or TALLY_HEDGE.search(title):
        return {}
    found = {}
    parties = spec["tallies"]["parties"]
    for key, rule in parties.items():
        for match in re.finditer(rf"\b{rule}\b(?:\W+\w+){{0,6}}?\W+{SEAT}", title, re.I):
            # Another party's name between the party and the figure means the figure belongs to that one.
            between = title[match.start():match.start("n")]
            if any(re.search(rf"\b{other}\b", between[len(re.match(rf"\b{rule}\b", between, re.I).group(0)):], re.I) for okey, other in parties.items() if okey != key):
                continue
            chamber = match["chamber"].lower()
            value = int(match["n"])
            if (chamber == "house" and 1 <= value <= 435) or (chamber == "senate" and 1 <= value <= 100):
                found.setdefault((key, chamber), value)
    # "Senate: Democrats 54, Republicans 44" / "Democrats 54-44" style lines.
    pair = re.search(r"\b(?P<chamber>House|Senate)\b\W+\s*(?P<a>Democrats?|Dems?)\W+\s*(?P<an>\d{2,3})\W+\s*(?P<b>Republicans?|GOP)\W+\s*(?P<bn>\d{2,3})\b", title, re.I)
    if pair:
        chamber = pair["chamber"].lower()
        for key, value in (("democrats", int(pair["an"])), ("republicans", int(pair["bn"]))):
            if (chamber == "house" and 1 <= value <= 435) or (chamber == "senate" and 1 <= value <= 100):
                found.setdefault((key, chamber), value)
    return found


def read_release(title, outlet, spec):
    """The figure in the issuer's own release title (ADP: "Private-Sector Employment Increased by 86,000 Jobs in October"),
    only when it comes from the issuer's own distributor. None otherwise."""
    rule = spec.get("release")
    if not rule or outlet not in rule["outlets"]:
        return None
    match = re.match(rule["pattern"], title or "")
    if not match:
        return None
    value = int(match["num"].replace(",", ""))
    if not 100 <= value <= 1_000_000:
        return None
    return value if match["dir"].lower().startswith("incr") else -value


def load_config(path=CONFIG_PATH):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("version") != 1 or not isinstance(value.get("feeds"), list) or not isinstance(value.get("watches"), list):
        raise ValueError("invalid-event-watches")
    for feed in value["feeds"]:
        if urlsplit(feed["url"]).scheme != "https" or not feed.get("publisher") or not feed.get("group"):
            raise ValueError("invalid-event-feed")
    return value


def stamp(moment=None):
    return (moment or datetime.now(timezone.utc)).isoformat(timespec="seconds")


def parse_time(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---- reading a headline -------------------------------------------------------

def _pattern(party, chamber):
    target = CHAMBERS[chamber]
    # "win a Senate seat / House race" is one contest, not control of the chamber.
    single = r"(?!\W+(?:seats?|races?|contests?|elections?|runoffs?|primar\w*|districts?|candidates?|nominees?|campaigns?|battles?))"
    # Between the party and the verb: at most two plain words ("also", "narrowly"), never another party or a chamber, never punctuation.
    between = r"(?:\s+(?!(?:house|senate|democrats|republicans|gop|dems|congress)\b)\w+){0,2}?"
    return re.compile(rf"\b{PARTIES[party]}\b{between}\s+{VERBS}{FILLER}\s+(?:{target}|{BOTH})\b{single}", re.I)


def reads_as_call(title, claim):
    """True when the headline states the claim as a result. Hedged, conditional or other-party phrasing is not a call."""
    if not isinstance(title, str) or len(title) > 300 or HEDGE.search(title):
        return False
    return bool(_pattern(claim["party"], claim["chamber"]).search(title))


# ---- storing what was seen ----------------------------------------------------

def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS event_observations(
        watch_id TEXT NOT NULL, claim_key TEXT NOT NULL, publisher TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
        published_at TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(watch_id, claim_key, publisher));
      CREATE TABLE IF NOT EXISTS event_results(
        id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('published','withdrawn','conflict')), payload TEXT NOT NULL,
        published_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_feed_status(
        publisher TEXT PRIMARY KEY, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, items INTEGER NOT NULL DEFAULT 0);
    """)
    return db


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("feed-too-large")
    if re.search(rb"<!(?:DOCTYPE|ENTITY)", body[:4096], re.I):
        raise ValueError("feed-doctype")
    return body


def parse_feed(body):
    """(title, https link, UTC time, outlet) for each item of an RSS or Atom body; malformed items are skipped.
    A news-search feed names the outlet of each item in <source>; for other feeds the outlet is "" (the feed's own name is used)."""
    rows = []
    root = ET.fromstring(body)
    for item in root.iter():
        name = item.tag.rsplit("}", 1)[-1]
        if name not in ("item", "entry"):
            continue
        child = {sub.tag.rsplit("}", 1)[-1]: sub for sub in item}
        title = (child["title"].text or "").strip() if "title" in child else ""
        link = (child["link"].text or "").strip() if "link" in child and child["link"].text else (child["link"].get("href", "") if "link" in child else "")
        when = next((child[key].text for key in ("pubDate", "published", "updated", "date") if key in child and child[key].text), "")
        try:
            # An Atom date is ISO 8601 ("2026-11-04T13:15:00Z"); an RSS date is RFC 822 ("Wed, 04 Nov 2026 13:15:00 GMT").
            # (The letter T in "GMT" is not the ISO separator.)
            iso = re.match(r"^\s*\d{4}-\d{2}-\d{2}T", when)
            moment = datetime.fromisoformat(when.strip().replace("Z", "+00:00")) if iso else parsedate_to_datetime(when)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            moment = moment.astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        outlet = (child["source"].text or "").strip() if "source" in child and child["source"].text else ""
        if outlet and title.endswith(" - " + outlet):
            title = title[:-len(outlet) - 3].rstrip()
        if title and link.startswith("https://"):
            rows.append((title, link, moment, outlet))
    return rows


def ingest(db, config, publisher, rows, now, group="politics"):
    """Keep the first headline each outlet gave for each claim, inside each open watch's window."""
    saved = 0
    for watch in config["watches"]:
        start, end = parse_time(watch["from"]), parse_time(watch["until"])
        if not start <= now <= end or watch.get("feedGroup", "politics") != group:
            continue
        for title, url, moment, outlet in rows:
            if not start <= moment <= end:
                continue
            if "numeric" in watch:
                spec = watch["numeric"]
                official = read_release(title, outlet, spec)
                figure = official if official is not None else read_figure(title, spec)
                if figure is not None:
                    # The issuer's own release is recorded under one fixed name, so it counts once and stands alone.
                    name = spec["release"]["label"] if official is not None else (outlet or publisher)
                    with db:
                        cursor = db.execute("INSERT OR IGNORE INTO event_observations VALUES(?,?,?,?,?,?,?)",
                                            (watch["id"], f"figure:{figure}", name, url, title[:300], stamp(moment), stamp(now)))
                    saved += cursor.rowcount
                continue
            if "tallies" in watch:
                for (party, chamber), count in read_tallies(title, watch).items():
                    with db:
                        cursor = db.execute("INSERT OR IGNORE INTO event_observations VALUES(?,?,?,?,?,?,?)",
                                            (watch["id"], f"tally:{party}:{chamber}:{count}", outlet or publisher, url, title[:300], stamp(moment), stamp(now)))
                    saved += cursor.rowcount
            for claim in watch["claims"]:
                if reads_as_call(title, claim):
                    with db:
                        cursor = db.execute("INSERT OR IGNORE INTO event_observations VALUES(?,?,?,?,?,?,?)",
                                            (watch["id"], claim["key"], outlet or publisher, url, title[:300], stamp(moment), stamp(now)))
                    saved += cursor.rowcount
    return saved


# ---- deciding what is solid ---------------------------------------------------

def evaluate(db, config, now):
    """Publish a claim once enough different outlets stated it; hold a conflict; never touch a withdrawn result."""
    for watch in config["watches"]:
        existing = db.execute("SELECT state FROM event_results WHERE id=?", (watch["id"],)).fetchone()
        if existing and existing["state"] == "withdrawn":
            continue
        need = int(watch.get("requirePublishers", 2))
        if "numeric" in watch:
            _evaluate_figure(db, watch, need, now, existing)
            continue
        confirmed, sources = {}, {}
        for claim in watch["claims"]:
            rows = db.execute("SELECT publisher,url,title,published_at FROM event_observations WHERE watch_id=? AND claim_key=? ORDER BY published_at",
                              (watch["id"], claim["key"])).fetchall()
            if len({row["publisher"] for row in rows}) >= need:
                confirmed[claim["key"]] = claim
                sources[claim["key"]] = rows
        # Both parties reported as winning the same chamber: the sources disagree, so nothing is said.
        chambers = {}
        for key, claim in confirmed.items():
            chambers.setdefault(claim["chamber"], set()).add(claim["party"])
        if any(len(parties) > 1 for parties in chambers.values()):
            _store(db, watch["id"], "conflict", {"watch": watch["id"], "claims": sorted(confirmed)}, now)
            continue
        if not confirmed:
            continue
        ja, en, left = [], [], set(confirmed)
        for combo in watch.get("combine", []):
            if set(combo["requires"]) <= left:
                ja.append(combo["ja"]); en.append(combo["en"]); left -= set(combo["requires"])
        for claim in watch["claims"]:
            if claim["key"] in left:
                ja.append(claim["ja"]); en.append(claim["en"])
        counts = _tallies(db, watch, need)
        chosen = [row for key in confirmed for row in sources[key]]
        publishers, links, seen = [], [], set()
        for row in sorted(chosen, key=lambda r: r["published_at"]):
            if row["publisher"] not in seen:
                seen.add(row["publisher"]); publishers.append(row["publisher"])
                links.append({"publisher": row["publisher"], "title": row["title"], "url": row["url"]})
        # The result time is when the need-th different outlet had said it.
        released = sorted(row["published_at"] for row in chosen)[max(0, need - 1)] if len(chosen) >= need else stamp(now)
        names = "・".join(publishers[:4]) + ("ほか" if len(publishers) > 4 else "")
        payload = {
            "id": watch["id"], "titleJa": watch["titleJa"], "titleEn": watch["titleEn"],
            "sourceName": names + "(報道)", "releasedAt": released,
            "resultJa": "、".join(ja) + f"（{len(publishers)}社が当確を報道）" + _tally_text(watch, counts, "ja"),
            "resultEn": "; ".join(en) + f" (called by {len(publishers)} outlets)" + _tally_text(watch, counts, "en"),
            "detailJa": f"{names}が報じました。" + ("議席数は、別々の2社以上が同じ数字を報じたものです。" if counts else "") + watch.get("noteJa", ""),
            "detailEn": f"Reported by {', '.join(publishers[:4])}{' and others' if len(publishers) > 4 else ''}. " + ("Seat counts are figures that at least two different outlets gave. " if counts else "") + watch.get("noteEn", ""),
            "sourceUrl": links[0]["url"], "sources": links[:6], "verifiedOn": stamp(now)[:10],
        }
        _store(db, watch["id"], "published", payload, now, keep_time=existing is not None and existing["state"] == "published")


def _tallies(db, watch, need):
    """{(party, chamber): seats}: for each count, the figure that at least `need` different outlets gave, newest first."""
    if "tallies" not in watch:
        return {}
    rows = db.execute("SELECT claim_key,publisher,published_at FROM event_observations WHERE watch_id=? AND claim_key LIKE 'tally:%' ORDER BY published_at", (watch["id"],)).fetchall()
    best = {}
    seen = {}
    for row in rows:
        _, party, chamber, count = row["claim_key"].split(":")
        entries = seen.setdefault((party, chamber, int(count)), [])
        if row["publisher"] not in {name for _, name in entries}:
            entries.append((row["published_at"], row["publisher"]))
    for (party, chamber, count), entries in seen.items():
        if len(entries) >= need:
            reached = entries[need - 1][0]
            if (party, chamber) not in best or reached > best[(party, chamber)][0]:
                best[(party, chamber)] = (reached, count)
    return {key: value[1] for key, value in best.items()}


def _tally_text(watch, counts, lang):
    if not counts:
        return ""
    chambers = [("senate", "上院", "Senate"), ("house", "下院", "House")]
    names = watch["tallies"]["partyJa" if lang == "ja" else "partyEn"]
    parts = []
    for chamber, ja, en in chambers:
        line = [f"{names[party]}{counts[(party, chamber)]}" + ("議席" if lang == "ja" else "") for party in names if (party, chamber) in counts]
        if line:
            parts.append(f"{ja if lang == 'ja' else en} " + ("・" if lang == "ja" else ", ").join(line))
    if not parts:
        return ""
    return ("（現時点の議席: " + "／".join(parts) + "）") if lang == "ja" else (" (seats so far: " + "; ".join(parts) + ")")


def _evaluate_figure(db, watch, need, now, existing):
    """One signed figure stated by at least `need` different outlets is published; two such figures that disagree are held."""
    rows = db.execute("SELECT claim_key,publisher,url,title,published_at FROM event_observations WHERE watch_id=? ORDER BY published_at", (watch["id"],)).fetchall()
    by_figure = {}
    for row in rows:
        by_figure.setdefault(row["claim_key"], []).append(row)
    label = watch["numeric"].get("release", {}).get("label")
    solid = {key: group for key, group in by_figure.items() if len({r["publisher"] for r in group}) >= need or (label and any(r["publisher"] == label for r in group))}
    if len(solid) > 1:
        _store(db, watch["id"], "conflict", {"watch": watch["id"], "figures": sorted(solid)}, now)
        return
    if not solid:
        return
    key, group = next(iter(solid.items()))
    value = int(key.split(":", 1)[1])
    publishers, links, seen = [], [], set()
    for row in group:
        if row["publisher"] not in seen:
            seen.add(row["publisher"]); publishers.append(row["publisher"])
            links.append({"publisher": row["publisher"], "title": row["title"], "url": row["url"]})
    names = "・".join(publishers[:4]) + ("ほか" if len(publishers) > 4 else "")
    shown = f"{value:+,}"
    released = sorted(r["published_at"] for r in group)[need - 1]
    payload = {
        "id": watch["id"], "titleJa": watch["titleJa"], "titleEn": watch["titleEn"], "sourceName": names + "(報道)", "releasedAt": released,
        "resultJa": watch["resultJa"].replace("{value}", shown) + f"（{len(publishers)}社が同じ数字を報道）",
        "resultEn": watch["resultEn"].replace("{value}", shown) + f" (the same figure from {len(publishers)} outlets)",
        "detailJa": f"{names}の見出しが、同じ数字を伝えました。" + watch.get("noteJa", ""),
        "detailEn": f"Headlines from {', '.join(publishers[:4])}{' and others' if len(publishers) > 4 else ''} gave the same figure. " + watch.get("noteEn", ""),
        "sourceUrl": links[0]["url"], "sources": links[:6], "verifiedOn": stamp(now)[:10],
    }
    _store(db, watch["id"], "published", payload, now, keep_time=existing is not None and existing["state"] == "published")


def _store(db, event_id, state, payload, now, keep_time=False):
    with db:
        row = db.execute("SELECT published_at FROM event_results WHERE id=?", (event_id,)).fetchone()
        first = row["published_at"] if row and keep_time else stamp(now)
        db.execute("""INSERT INTO event_results(id,state,payload,published_at,updated_at) VALUES(?,?,?,?,?)
                      ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated_at=excluded.updated_at,published_at=?""",
                   (event_id, state, json.dumps(payload, ensure_ascii=False), first, stamp(now), first))


def run_once(db_path, now=None, config=None, transport=None):
    """One pass: read each outlet's feed, save the calls, decide. Returns how many calls were newly saved."""
    now = now or datetime.now(timezone.utc)
    config = config or load_config()
    if not any(parse_time(w["from"]) <= now <= parse_time(w["until"]) for w in config["watches"]):
        return None
    transport = transport or fetch
    saved = 0
    groups = {w.get("feedGroup", "politics") for w in config["watches"] if parse_time(w["from"]) <= now <= parse_time(w["until"])}
    with connect(db_path) as db:
        for feed in config["feeds"]:
            if feed["group"] not in groups:
                continue
            try:
                rows = parse_feed(transport(feed["url"]))
                saved += ingest(db, config, feed["publisher"], rows, now, feed["group"])
                state = (1, None, len(rows))
            except Exception as error:
                state = (0, f"{type(error).__name__}:{str(error)[:60]}", 0)
            with db:
                db.execute("INSERT INTO event_feed_status VALUES(?,?,?,?,?) ON CONFLICT(publisher) DO UPDATE SET checked_at=excluded.checked_at,ok=excluded.ok,error=excluded.error,items=excluded.items",
                           (feed["publisher"], stamp(now), state[0], state[1], state[2]))
        evaluate(db, config, now)
    return saved


def active(config, now=None):
    now = now or datetime.now(timezone.utc)
    return any(parse_time(w["from"]) <= now <= parse_time(w["until"]) for w in config["watches"])


# ---- what the site and the owner see -------------------------------------------

def public_view(db):
    rows = db.execute("SELECT payload FROM event_results WHERE state='published' ORDER BY published_at DESC LIMIT 20").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def owner_view(db):
    results = db.execute("SELECT id,state,payload,updated_at FROM event_results ORDER BY updated_at DESC LIMIT 30").fetchall()
    feeds = db.execute("SELECT publisher,checked_at,ok,error,items FROM event_feed_status ORDER BY publisher").fetchall()
    return {"results": [{"id": r["id"], "state": r["state"], "updatedAt": r["updated_at"], **json.loads(r["payload"])} for r in results],
            "feeds": [dict(row) for row in feeds]}


def withdraw(db, payload):
    """The owner takes a result down. It is never published again."""
    event_id = payload.get("id") if isinstance(payload, dict) else None
    row = db.execute("SELECT payload FROM event_results WHERE id=?", (event_id,)).fetchone() if isinstance(event_id, str) else None
    if not row:
        raise ValueError("event-result-not-found")
    with db:
        db.execute("UPDATE event_results SET state='withdrawn',updated_at=? WHERE id=?", (stamp(), event_id))
    return {"withdrawn": event_id}
