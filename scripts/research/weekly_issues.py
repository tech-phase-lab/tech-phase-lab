"""週刊 Tech Phase PRO: structured issues (owner, Nov 2).

An issue = headline, "今週のひとこと", a list of parts chosen for that week, and sources. A draft is written by the weekly
generator (or by hand), read and fixed by the owner, and published; the number goes up by one at each publication. Numbers on a
card are stored as numbers: the change (+13.4% / -0.75pt) is calculated by the screen, never written by the model."""

import json
import math
import re
import sqlite3
import uuid
from datetime import date as Date, datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
ISSUE_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
TONES = {"up", "down", "flat"}
MAX_PARTS = 12


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def today():
    return datetime.now(JST).date().isoformat()


def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS weekly_issues(
        id TEXT PRIMARY KEY, number INTEGER, status TEXT NOT NULL CHECK(status IN ('draft','published')),
        date TEXT NOT NULL, headline TEXT NOT NULL, lead TEXT NOT NULL, parts TEXT NOT NULL, sources TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '[]', auto INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_number ON weekly_issues(number) WHERE number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_weekly_status ON weekly_issues(status,number DESC,created_at DESC);
      CREATE TABLE IF NOT EXISTS weekly_settings(
        id INTEGER PRIMARY KEY CHECK(id=1), auto_publish INTEGER NOT NULL DEFAULT 0, next_number INTEGER NOT NULL DEFAULT 1);
      INSERT OR IGNORE INTO weekly_settings(id) VALUES(1);
    """)
    # The weekly auto-draft (Nov 4): off until the owner turns it on; Saturday 08:00 Japan time unless changed.
    have = {row[1] for row in db.execute("PRAGMA table_info(weekly_settings)")}
    for column, definition in (("generate_enabled", "INTEGER NOT NULL DEFAULT 0"), ("generate_hour", "INTEGER NOT NULL DEFAULT 8"),
                               ("last_generated_week", "TEXT"), ("attempt_week", "TEXT"), ("attempts", "INTEGER NOT NULL DEFAULT 0"),
                               ("next_attempt_at", "REAL NOT NULL DEFAULT 0")):
        if column not in have:
            db.execute(f"ALTER TABLE weekly_settings ADD COLUMN {column} {definition}")
    db.commit()
    return db


# ---- checking what is written ------------------------------------------------

def _text(value, field, limit, required=True):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError(f"invalid-weekly-{field}")
    value = value.strip()
    if (required and not value) or len(value) > limit:
        raise ValueError(f"invalid-weekly-{field}")
    return value


def _number(value, field, required=False):
    if value is None:
        if required:
            raise ValueError(f"invalid-weekly-{field}")
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e13:
        raise ValueError(f"invalid-weekly-{field}")
    return value


def _list(value, field, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"invalid-weekly-{field}")
    return value


SECTIONS = ("summary", "earnings", "indicators", "market", "schedule")


def _part(raw):
    """One part, strictly. `section` (where it sits in the reading order) is optional so that issues saved before it existed still load."""
    if not isinstance(raw, dict):
        raise ValueError("invalid-weekly-part")
    part = _part_body(raw)
    section = raw.get("section")
    if section is not None:
        if section not in SECTIONS:
            raise ValueError("invalid-weekly-section")
        part["section"] = section
    return part


def _part_body(raw):
    kind = raw.get("type")
    if kind == "highlight":
        return {"type": "highlight", "text": _text(raw.get("text"), "highlight", 200)}
    part = {"type": kind, "heading": _text(raw.get("heading"), "heading", 80)}
    if kind == "text":
        part["body"] = _text(raw.get("body"), "body", 3000)
    elif kind == "numbers":
        cards = []
        for card in _list(raw.get("cards"), "cards", 8):
            if not isinstance(card, dict):
                raise ValueError("invalid-weekly-card")
            delta = card.get("delta")
            if delta not in (None, "pct", "pt"):
                raise ValueError("invalid-weekly-delta")
            item = {"label": _text(card.get("label"), "label", 40), "value": _number(card.get("value"), "value"), "outlook": _number(card.get("outlook"), "outlook"),
                    "previous": _number(card.get("previous"), "previous"), "unit": _text(card.get("unit"), "unit", 12, False), "outlookUnit": _text(card.get("outlookUnit"), "unit", 12, False),
                    "range": _text(card.get("range"), "range", 80, False), "delta": delta}
            if item["value"] is None and item["outlook"] is None:
                raise ValueError("invalid-weekly-card")
            cards.append(item)
        part["cards"] = cards
        part["note"] = _text(raw.get("note"), "note", 600, False)
    elif kind == "timeline":
        points = []
        for point in _list(raw.get("points"), "points", 12):
            if not isinstance(point, dict) or point.get("tone", "flat") not in TONES:
                raise ValueError("invalid-weekly-point")
            points.append({"when": _text(point.get("when"), "when", 30), "event": _text(point.get("event"), "event", 120), "comment": _text(point.get("comment"), "comment", 200, False), "tone": point.get("tone", "flat")})
        part["points"] = points
    elif kind == "schedule":
        items = []
        for item in _list(raw.get("items"), "items", 10):
            if not isinstance(item, dict):
                raise ValueError("invalid-weekly-item")
            try:
                day = Date.fromisoformat(item.get("date"))
            except (TypeError, ValueError):
                raise ValueError("invalid-weekly-date") from None
            items.append({"date": day.isoformat(), "name": _text(item.get("name"), "name", 80), "comment": _text(item.get("comment"), "comment", 200, False)})
        part["items"] = items
    elif kind == "chart":
        bars = []
        for bar in _list(raw.get("bars"), "bars", 10):
            value = _number(bar.get("value") if isinstance(bar, dict) else None, "bar", True)
            if value < 0:
                raise ValueError("invalid-weekly-bar")
            bars.append({"label": _text(bar.get("label"), "label", 30), "value": value})
        part.update(title=_text(raw.get("title"), "title", 60, False), unit=_text(raw.get("unit"), "unit", 12, False), bars=bars, note=_text(raw.get("note"), "note", 200, False))
    else:
        raise ValueError("invalid-weekly-part-type")
    return part


def validate(value):
    """A strict copy of an issue: only the known parts and fields, whatever was sent."""
    if not isinstance(value, dict):
        raise ValueError("invalid-weekly-issue")
    parts = [_part(raw) for raw in _list(value.get("parts", []), "parts", MAX_PARTS)]
    sources = []
    for source in _list(value.get("sources", []), "sources", 30):
        url = source.get("url") if isinstance(source, dict) else None
        if not isinstance(url, str) or not re.fullmatch(r"https://[^\s]{1,990}", url):
            raise ValueError("invalid-weekly-source")
        sources.append({"title": _text(source.get("title"), "source", 180), "url": url})
    notes = [_text(note, "note", 300) for note in _list(value.get("notes", []), "notes", 30)]
    day = value.get("date") or today()
    try:
        day = Date.fromisoformat(day).isoformat()
    except (TypeError, ValueError):
        raise ValueError("invalid-weekly-date") from None
    return {"date": day, "headline": _text(value.get("headline"), "headline", 120), "lead": _text(value.get("lead"), "lead", 400), "parts": parts, "sources": sources, "notes": notes}


# ---- reading -----------------------------------------------------------------

def _issue(row, owner=False):
    value = {"id": row["id"], "number": row["number"], "status": row["status"], "date": row["date"], "headline": row["headline"], "lead": row["lead"],
             "parts": json.loads(row["parts"]), "sources": json.loads(row["sources"])}
    if owner:
        value.update(notes=json.loads(row["notes"]), auto=bool(row["auto"]), updatedAt=row["updated_at"], createdAt=row["created_at"])
    return value


def settings(db):
    row = db.execute("SELECT * FROM weekly_settings WHERE id=1").fetchone()
    return {"autoPublish": bool(row["auto_publish"]), "nextNumber": row["next_number"], "generateEnabled": bool(row["generate_enabled"]),
            "generateHour": row["generate_hour"], "lastGenerated": row["last_generated_week"]}


def member_issues(db, number=None, limit=6, before=None):
    """What a PRO member reads: published issues only, newest first; the one asked for (or the latest) in full."""
    limit = max(1, min(int(limit), 30))
    if number is not None and (type(number) is not int or number < 1):
        raise ValueError("invalid-weekly-number")
    if before is not None and (type(before) is not int or before < 1):
        raise ValueError("invalid-weekly-number")
    rows = db.execute("SELECT number,date,headline FROM weekly_issues WHERE status='published' AND (? IS NULL OR number<?) ORDER BY number DESC LIMIT ?", (before, before, limit + 1)).fetchall()
    latest = db.execute("SELECT MAX(number) FROM weekly_issues WHERE status='published'").fetchone()[0]
    shown = db.execute("SELECT * FROM weekly_issues WHERE status='published' AND number=?", (number if number is not None else latest,)).fetchone() if latest else None
    return {"issues": [{"number": row["number"], "date": row["date"], "headline": row["headline"]} for row in rows[:limit]], "hasMore": len(rows) > limit,
            "latest": latest, "issue": _issue(shown) if shown else None}


def owner_view(db):
    drafts = db.execute("SELECT * FROM weekly_issues WHERE status='draft' ORDER BY created_at DESC LIMIT 30").fetchall()
    return {"drafts": [_issue(row, True) for row in drafts], "settings": settings(db)}


def recent_drafts(db, hours=3):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="milliseconds")
    rows = db.execute("SELECT id,created_at FROM weekly_issues WHERE status='draft' AND created_at>=? ORDER BY created_at DESC", (since,)).fetchall()
    return [{"id": row["id"], "createdAt": row["created_at"]} for row in rows]


def recent_published(db, hours=3):
    """Issues published in the last hours, for the "new issue" phone notice (Nov 4)."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="milliseconds")
    rows = db.execute("SELECT id,number,published_at FROM weekly_issues WHERE status='published' AND published_at>=? ORDER BY published_at DESC", (since,)).fetchall()
    return [{"id": row["id"], "number": row["number"], "publishedAt": row["published_at"]} for row in rows]


# ---- writing -----------------------------------------------------------------

def _row(db, issue_id):
    if not isinstance(issue_id, str) or not ISSUE_ID.fullmatch(issue_id):
        raise ValueError("invalid-weekly-id")
    row = db.execute("SELECT * FROM weekly_issues WHERE id=?", (issue_id,)).fetchone()
    if not row:
        raise ValueError("weekly-not-found")
    return row


def _publish(db, issue_id, now):
    config = db.execute("SELECT next_number FROM weekly_settings WHERE id=1").fetchone()
    highest = db.execute("SELECT COALESCE(MAX(number),0) FROM weekly_issues").fetchone()[0]
    number = max(config["next_number"], highest + 1)
    db.execute("UPDATE weekly_issues SET status='published',number=?,published_at=?,updated_at=? WHERE id=?", (number, now, now, issue_id))
    db.execute("UPDATE weekly_settings SET next_number=? WHERE id=1", (number + 1,))


def save_draft(db, payload):
    """Create a draft, or fix an existing draft. A draft from the generator (auto=true) is published at once when the owner turned that on."""
    value = validate(payload)
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        if payload.get("id") is None:
            issue_id = str(uuid.uuid4())
            db.execute("INSERT INTO weekly_issues(id,status,date,headline,lead,parts,sources,notes,auto,created_at,updated_at) VALUES(?,'draft',?,?,?,?,?,?,?,?,?)",
                       (issue_id, value["date"], value["headline"], value["lead"], json.dumps(value["parts"], ensure_ascii=False), json.dumps(value["sources"], ensure_ascii=False),
                        json.dumps(value["notes"], ensure_ascii=False), int(payload.get("auto") is True), now, now))
            if payload.get("auto") is True and settings(db)["autoPublish"]:
                _publish(db, issue_id, now)
        else:
            row = _row(db, payload["id"])
            if row["status"] != "draft":
                raise ValueError("weekly-already-published")
            issue_id = row["id"]
            db.execute("UPDATE weekly_issues SET date=?,headline=?,lead=?,parts=?,sources=?,notes=?,updated_at=? WHERE id=?",
                       (value["date"], value["headline"], value["lead"], json.dumps(value["parts"], ensure_ascii=False), json.dumps(value["sources"], ensure_ascii=False),
                        json.dumps(value["notes"], ensure_ascii=False), now, issue_id))
    return {"item": _issue(db.execute("SELECT * FROM weekly_issues WHERE id=?", (issue_id,)).fetchone(), True)}


def publish(db, payload):
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = _row(db, payload.get("id"))
        if row["status"] != "draft":
            raise ValueError("weekly-already-published")
        if not json.loads(row["parts"]) and not row["lead"]:
            raise ValueError("weekly-empty")
        _publish(db, row["id"], stamp())
    return {"item": _issue(db.execute("SELECT * FROM weekly_issues WHERE id=?", (row["id"],)).fetchone(), True)}


def delete(db, payload):
    with db:
        row = _row(db, payload.get("id"))
        db.execute("DELETE FROM weekly_issues WHERE id=?", (row["id"],))
    return {"deleted": row["id"]}


def save_settings(db, payload):
    with db:
        if "autoPublish" in payload:
            if type(payload["autoPublish"]) is not bool:
                raise ValueError("invalid-weekly-settings")
            db.execute("UPDATE weekly_settings SET auto_publish=? WHERE id=1", (int(payload["autoPublish"]),))
        if "generateEnabled" in payload:
            if type(payload["generateEnabled"]) is not bool:
                raise ValueError("invalid-weekly-settings")
            db.execute("UPDATE weekly_settings SET generate_enabled=? WHERE id=1", (int(payload["generateEnabled"]),))
        if "generateHour" in payload:
            hour = payload["generateHour"]
            if type(hour) is not int or not 0 <= hour <= 23:
                raise ValueError("invalid-weekly-settings")
            db.execute("UPDATE weekly_settings SET generate_hour=? WHERE id=1", (hour,))
        if "nextNumber" in payload:
            number = payload["nextNumber"]
            highest = db.execute("SELECT COALESCE(MAX(number),0) FROM weekly_issues").fetchone()[0]
            if type(number) is not int or number < max(1, highest + 1) or number > 100000:
                raise ValueError("invalid-weekly-settings")
            db.execute("UPDATE weekly_settings SET next_number=? WHERE id=1", (number,))
    return {"settings": settings(db)}
