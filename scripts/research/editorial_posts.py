"""Manually authored PRO columns. No AI calls, scheduling or push delivery."""
import json
import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlsplit

KINDS = {"weekly", "qa", "notes"}
FIELDS = {"titleJa": 180, "titleEn": 180, "introJa": 500, "introEn": 500,
          "bodyJa": 6000, "bodyEn": 6000, "sourceNotes": 4000}


def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS editorial_posts(
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, kind TEXT NOT NULL,
        content TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
        published_at TEXT);
      CREATE TABLE IF NOT EXISTS editorial_post_history(
        id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL,
        version INTEGER NOT NULL, action TEXT NOT NULL, content TEXT NOT NULL,
        actor TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
    """)
    return db


def stamp():
    return datetime.now(timezone.utc).isoformat()


def identity(payload):
    post_id, version = payload.get("id"), payload.get("version")
    if not isinstance(post_id, str) or not re.fullmatch(r"[a-z0-9-]{16,64}", post_id):
        raise ValueError("invalid-post-id")
    if type(version) is not int or version < 0:
        raise ValueError("invalid-post-version")
    return post_id, version


def content(payload):
    kind = payload.get("kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValueError("invalid-post-kind")
    value = {}
    for name, limit in FIELDS.items():
        text = payload.get(name, "")
        if not isinstance(text, str) or len(text) > limit or "\x00" in text:
            raise ValueError("invalid-post-content")
        value[name] = text.strip()
    refs = payload.get("sources", [])
    if not isinstance(refs, list) or len(refs) > 8:
        raise ValueError("invalid-post-sources")
    value["sources"] = []
    for ref in refs:
        if not isinstance(ref, dict):
            raise ValueError("invalid-post-sources")
        title, url = ref.get("title"), ref.get("url")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 180 or not isinstance(url, str) or len(url) > 1000:
            raise ValueError("invalid-post-sources")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in url):
            raise ValueError("invalid-post-sources")
        value["sources"].append({"title": title.strip(), "url": url})
    return kind, value


def item(row, private=False):
    value = json.loads(row["content"])
    result = {"id": row["id"], "version": row["version"], "kind": row["kind"],
              "status": row["status"], "updatedAt": row["updated_at"], "publishedAt": row["published_at"],
              **{key: value[key] for key in FIELDS if key != "sourceNotes"}, "sources": value["sources"]}
    if private:
        result["sourceNotes"] = value["sourceNotes"]
    return result


def queue(db, limit=20, published=False, offset=0):
    limit = max(1, min(int(limit), 20))
    offset = max(0, min(int(offset), 100000))
    where = "WHERE status='published'" if published else ""
    order = "published_at" if published else "updated_at"
    rows = db.execute(f"SELECT * FROM editorial_posts {where} ORDER BY {order} DESC,id LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    total = db.execute(f"SELECT count(*) FROM editorial_posts {where}").fetchone()[0]
    return {"items": [item(row, not published) for row in rows],
            "nextOffset": offset + len(rows) if offset + len(rows) < total else None}


def save(db, payload):
    post_id, version = identity(payload)
    kind, value = content(payload)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone()
        if (row and row["version"] != version) or (not row and version != 0):
            raise ValueError("post-conflict")
        db.execute("""INSERT INTO editorial_posts VALUES(?,?,?,?,?,?,NULL)
          ON CONFLICT(id) DO UPDATE SET version=excluded.version,kind=excluded.kind,
          content=excluded.content,status='draft',updated_at=excluded.updated_at""",
                   (post_id, version + 1, kind, encoded, "draft", now))
        db.execute("INSERT INTO editorial_post_history(post_id,version,action,content,actor,reason,at) VALUES(?,?,?,?,?,?,?)",
                   (post_id, version + 1, "draft", json.dumps({"kind": kind, **value}, ensure_ascii=False), "editor-token", "manual-save", now))
        return {"item": item(db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone(), True)}


def review(db, payload):
    post_id, version = identity(payload)
    decision = payload.get("decision")
    actor, reason = payload.get("reviewer"), payload.get("reason")
    if decision not in {"published", "withdrawn"} or not isinstance(actor, str) or not 2 <= len(actor.strip()) <= 120 or not isinstance(reason, str) or not 5 <= len(reason.strip()) <= 500:
        raise ValueError("invalid-post-review")
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone()
        if not row or row["version"] != version:
            raise ValueError("post-conflict")
        value = json.loads(row["content"])
        if decision == "published":
            if payload.get("verified") is not True:
                raise ValueError("post-review-required")
            for key in ("titleJa", "titleEn", "introJa", "introEn", "bodyJa", "bodyEn"):
                if not value[key] or (key.startswith("body") and len(value[key]) < 20):
                    raise ValueError("post-bilingual-required")
            if not value["sourceNotes"] or (row["kind"] != "notes" and not value["sources"]):
                raise ValueError("post-sources-required")
        now = stamp()
        published = now if decision == "published" else row["published_at"]
        db.execute("UPDATE editorial_posts SET version=?,status=?,updated_at=?,published_at=? WHERE id=?",
                   (version + 1, decision, now, published, post_id))
        db.execute("INSERT INTO editorial_post_history(post_id,version,action,content,actor,reason,at) VALUES(?,?,?,?,?,?,?)",
                   (post_id, version + 1, decision, json.dumps({"kind": row["kind"], **value}, ensure_ascii=False), actor.strip(), reason.strip(), now))
        return {"item": item(db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone(), True)}
