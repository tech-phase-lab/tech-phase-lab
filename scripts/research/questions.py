"""PRO board posts, preserved private submissions, and owner moderation."""

import json
import re
import secrets
import sqlite3
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path


QUESTION_ID = re.compile(r"q-[a-f0-9]{32}")
OWNER_KEY = re.compile(r"[a-f0-9]{64}")
POST_ID = re.compile(r"[a-z0-9-]{16,64}")
STATUSES = {"pending", "answered", "closed"}
JST = timezone(timedelta(hours=9))
SETTINGS_PATH = Path(__file__).with_name("question_settings.json")
URL_PATTERN = re.compile(r"(?:https?://|ftp://|www\.|[a-z0-9-]+\.(?:com|net|org|jp|io|info|biz|xyz|app|dev|top|site|online|link|click)\b|bit\.ly|t\.co)", re.I)
DUPLICATE_WINDOW = timedelta(hours=24)


@lru_cache(maxsize=1)
def settings():
    """The one place for the daily limit and the hold words (not written into the code)."""
    value = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    limit = value.get("dailyLimit")
    words = value.get("holdWords")
    if type(limit) is not int or not 1 <= limit <= 100 or not isinstance(words, list) or any(not isinstance(w, str) or not w.strip() for w in words):
        raise ValueError("invalid-question-settings")
    return {"dailyLimit": limit, "holdWords": [w.strip() for w in words]}


def day_start(now=None):
    """The start of today in Japan time, as the UTC timestamp format stored in created_at."""
    moment = (now or datetime.now(timezone.utc)).astimezone(JST).replace(hour=0, minute=0, second=0, microsecond=0)
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def _fold(text):
    return re.sub(r"[\s\u3000\W_]+", "", unicodedata.normalize("NFKC", text).lower())


def hold_reason(db, owner_key, body, now):
    """Why a post is held for the owner instead of shown to the other members, or "" when it is fine."""
    if URL_PATTERN.search(unicodedata.normalize("NFKC", body)):
        return "URLを含む"
    folded = unicodedata.normalize("NFKC", body).lower()
    for word in settings()["holdWords"]:
        if unicodedata.normalize("NFKC", word).lower() in folded:
            return f"NGワード「{word}」を含む"
    since = (datetime.fromisoformat(now) - DUPLICATE_WINDOW).isoformat(timespec="milliseconds")
    same = _fold(body)
    for row in db.execute("SELECT body FROM member_questions WHERE owner_key=? AND audience='pro-board' AND created_at>=?", (owner_key, since)):
        if _fold(row["body"]) == same:
            return "同じ内容の連投"
    return ""


def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS member_questions(
        id TEXT PRIMARY KEY,
        owner_key TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        answer_post_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(status IN ('pending','answered','closed'))
      );
      CREATE INDEX IF NOT EXISTS idx_member_questions_owner
        ON member_questions(owner_key,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_member_questions_status
        ON member_questions(status,created_at ASC);
    """)
    columns = {row["name"] for row in db.execute("PRAGMA table_info(member_questions)")}
    if "audience" not in columns:
        db.execute("ALTER TABLE member_questions ADD COLUMN audience TEXT NOT NULL DEFAULT 'private'")
        db.commit()
    if "body_en" not in columns:
        db.execute("ALTER TABLE member_questions ADD COLUMN body_en TEXT NOT NULL DEFAULT ''")
        db.commit()
    if "held_reason" not in columns:
        # Held posts: shown to the owner only (and to their author). A deleted post keeps its row so the day's count never goes back.
        db.execute("ALTER TABLE member_questions ADD COLUMN held INTEGER NOT NULL DEFAULT 0")
        db.execute("ALTER TABLE member_questions ADD COLUMN held_reason TEXT NOT NULL DEFAULT ''")
        db.execute("ALTER TABLE member_questions ADD COLUMN deleted_at TEXT")
        db.commit()
    return db


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _owner(value):
    if not isinstance(value, str) or not OWNER_KEY.fullmatch(value):
        raise ValueError("invalid-question-owner")
    return value


def _question_id(value):
    if not isinstance(value, str) or not QUESTION_ID.fullmatch(value):
        raise ValueError("invalid-question-id")
    return value


def _item(row, include_body=True, owner_view=False):
    value = {
        "id": row["id"], "status": row["status"], "audience": row["audience"],
        "answerPostId": row["answer_post_id"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }
    if include_body:
        value["body"] = row["body"]
        value["bodyEn"] = row["body_en"]
    if owner_view:
        value["held"] = bool(row["held"])
        value["heldReason"] = row["held_reason"]
    return value


def _used_today(db, owner_key):
    return db.execute("SELECT count(*) FROM member_questions WHERE owner_key=? AND audience='pro-board' AND created_at>=?", (owner_key, day_start())).fetchone()[0]


def _left(db, owner_key):
    return max(0, settings()["dailyLimit"] - _used_today(db, owner_key))


def _withdraw_answer(db, row, now):
    if row["answer_post_id"]:
        db.execute("UPDATE editorial_posts SET status='withdrawn',updated_at=? WHERE id=? AND kind='qa'", (now, row["answer_post_id"]))


def _remove(db, row, now):
    _withdraw_answer(db, row, now)
    db.execute("UPDATE member_questions SET status='closed',answer_post_id=NULL,deleted_at=?,updated_at=? WHERE id=?", (now, now, row["id"]))


def delete_own(db, payload):
    """A member deletes their own post. The row stays, so the day's count is not given back."""
    owner_key = _owner(payload.get("ownerKey"))
    question_id = _question_id(payload.get("id"))
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM member_questions WHERE id=?", (question_id,)).fetchone()
        if not row or row["owner_key"] != owner_key or row["audience"] != "pro-board" or row["deleted_at"]:
            raise ValueError("question-not-found")
        _remove(db, row, now)
    return {"item": {"id": question_id, "deleted": True}, "left": _left(db, owner_key)}


def submit(db, payload):
    if payload.get("action") == "delete":
        return delete_own(db, payload)
    owner_key = _owner(payload.get("ownerKey"))
    audience = payload.get("audience", "private")
    if audience not in {"private", "pro-board"}:
        raise ValueError("invalid-question-audience")
    body = payload.get("body")
    if not isinstance(body, str) or "\x00" in body:
        raise ValueError("invalid-question-body")
    body = body.strip()
    if not 10 <= len(body) <= 1200:
        raise ValueError("invalid-question-body")
    question_id = payload.get("requestId")
    if question_id is None:
        question_id = "q-" + secrets.token_hex(16)
    question_id = _question_id(question_id)
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(
            "SELECT * FROM member_questions WHERE id=?", (question_id,)
        ).fetchone()
        if current:
            if current["owner_key"] != owner_key or current["body"] != body or current["audience"] != audience:
                raise ValueError("question-conflict")
            return {"item": _item(current), "left": _left(db, owner_key)}
        held, reason = 0, ""
        if audience == "pro-board":
            if _used_today(db, owner_key) >= settings()["dailyLimit"]:
                raise ValueError("question-daily-limit")
            reason = hold_reason(db, owner_key, body, now)
            held = int(bool(reason))
        db.execute(
            "INSERT INTO member_questions(id,owner_key,body,status,answer_post_id,created_at,updated_at,audience,held,held_reason) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (question_id, owner_key, body, "pending", None, now, now, audience, held, reason),
        )
        # The author is never told a post is held: the reply looks the same.
        return {"item": _item(db.execute(
            "SELECT * FROM member_questions WHERE id=?", (question_id,)
        ).fetchone()), "left": _left(db, owner_key)}


def member_queue(db, owner_key, limit=20):
    owner_key = _owner(owner_key)
    limit = max(1, min(int(limit), 20))
    rows = db.execute("""
      SELECT * FROM member_questions WHERE owner_key=?
      ORDER BY created_at DESC,id DESC LIMIT ?
    """, (owner_key, limit)).fetchall()
    return {"items": [_item(row) for row in rows]}


def board_queue(db, owner_key, limit=10, page=1, owner_view=False):
    import editorial_posts
    owner_key = _owner(owner_key)
    limit = max(1, min(int(limit), 10))
    if type(page) is not int or not 1 <= page <= 100000:
        raise ValueError("invalid-question-page")
    # Other members never see a held post; its author still does, as an ordinary one. The owner sees every post, held ones marked.
    visible = "" if owner_view else " AND (held=0 OR owner_key=?)"
    args = (limit + 1, (page - 1) * limit) if owner_view else (owner_key, limit + 1, (page - 1) * limit)
    rows = db.execute(f"SELECT * FROM member_questions WHERE audience='pro-board' AND status!='closed' AND deleted_at IS NULL{visible} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", args).fetchall()
    items = []
    for row in rows[:limit]:
        value = {**_item(row, owner_view=owner_view), "isMine": row["owner_key"] == owner_key}
        if row["status"] == "answered" and row["answer_post_id"]:
            answer = db.execute("SELECT * FROM editorial_posts WHERE id=? AND kind='qa' AND status='published'", (row["answer_post_id"],)).fetchone()
            if answer:
                value["answer"] = editorial_posts.item(answer)
        items.append(value)
    private = db.execute("SELECT * FROM member_questions WHERE owner_key=? AND audience='private' ORDER BY created_at DESC,id DESC LIMIT 20", (owner_key,)).fetchall()
    return {"items": items, "privateItems": [_item(row) for row in private], "audience": "pro-board", "page": page, "hasNext": len(rows) > limit,
            "limit": settings()["dailyLimit"], "left": _left(db, owner_key)}


def moderation_queue(db, view="pending", limit=50):
    if view not in STATUSES | {"all"}:
        raise ValueError("invalid-question-view")
    limit = max(1, min(int(limit), 100))
    where = "WHERE deleted_at IS NULL" if view == "all" else "WHERE deleted_at IS NULL AND status=?"
    args = (limit,) if view == "all" else (view, limit)
    rows = db.execute(f"""
      SELECT * FROM member_questions {where}
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
               created_at ASC,id ASC LIMIT ?
    """, args).fetchall()
    candidates = db.execute("""
      SELECT id,content,published_at FROM editorial_posts
      WHERE kind='qa' AND status='published'
      ORDER BY published_at DESC,id DESC LIMIT 50
    """).fetchall()
    import json
    answers = []
    for row in candidates:
        content = json.loads(row["content"])
        answers.append({
            "id": row["id"], "titleJa": content.get("titleJa", ""),
            "publishedAt": row["published_at"],
        })
    counts = {status: db.execute(
        "SELECT count(*) FROM member_questions WHERE status=?", (status,)
    ).fetchone()[0] for status in STATUSES}
    return {"items": [_item(row, owner_view=True) for row in rows], "answers": answers, "counts": counts}


def review(db, payload):
    question_id = _question_id(payload.get("id"))
    decision = payload.get("decision")
    if decision not in {"answered", "closed", "pending", "release", "delete"}:
        raise ValueError("invalid-question-decision")
    answer_post_id = payload.get("answerPostId")
    if decision == "answered":
        if not isinstance(answer_post_id, str) or not POST_ID.fullmatch(answer_post_id):
            raise ValueError("question-answer-required")
    elif answer_post_id not in {None, ""}:
        raise ValueError("invalid-question-answer")
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM member_questions WHERE id=?", (question_id,)
        ).fetchone()
        if not row:
            raise ValueError("question-not-found")
        if decision == "delete":
            _remove(db, row, now)
            return {"item": {"id": question_id, "deleted": True}}
        if decision == "release":
            # The owner shows a held post: from now on it is an ordinary question for everyone.
            db.execute("UPDATE member_questions SET held=0,held_reason='',updated_at=? WHERE id=?", (now, question_id))
            return {"item": _item(db.execute("SELECT * FROM member_questions WHERE id=?", (question_id,)).fetchone(), owner_view=True)}
        if decision == "answered":
            answer = db.execute("""
              SELECT id FROM editorial_posts
              WHERE id=? AND kind='qa' AND status='published'
            """, (answer_post_id,)).fetchone()
            if not answer:
                raise ValueError("question-answer-not-published")
        else:
            answer_post_id = None
        db.execute("""
          UPDATE member_questions SET status=?,answer_post_id=?,updated_at=?
          WHERE id=?
        """, (decision, answer_post_id, now, question_id))
        return {"item": _item(db.execute(
            "SELECT * FROM member_questions WHERE id=?", (question_id,)
        ).fetchone())}


def answer(db, payload):
    """Publish an owner-authored reply and link it atomically; retries are idempotent."""
    import json
    import editorial_posts
    question_id = _question_id(payload.get("id"))
    body = payload.get("body")
    if not isinstance(body, str) or not 1 <= len(body.strip()) <= 6000 or "\x00" in body:
        raise ValueError("invalid-answer-body")
    body = body.strip()
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM member_questions WHERE id=?", (question_id,)).fetchone()
        if not row or row["audience"] != "pro-board" or row["status"] == "closed":
            raise ValueError("question-not-found")
        post_id = "qa-" + question_id[2:]
        current = db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone()
        if current and "expectedVersion" in payload:
            expected = payload["expectedVersion"]
            if type(expected) is not int or expected < 1 or current["version"] != expected or current["status"] != "published" or row["answer_post_id"] != post_id or current["kind"] != "qa":
                raise ValueError("answer-conflict")
            content = json.loads(current["content"])
            if content["bodyJa"] == body:
                return {"item": _item(row), "post": editorial_posts.item(current)}
            content.update(bodyJa=body, titleEn="", introEn="", bodyEn="")
            encoded = json.dumps(content, ensure_ascii=False)
            db.execute("UPDATE editorial_posts SET version=version+1,content=?,updated_at=? WHERE id=?", (encoded, now, post_id))
            db.execute("INSERT INTO editorial_post_history(post_id,version,action,content,actor,reason,at) VALUES(?,?,'published',?,'authenticated-owner','Owner corrected reply',?)", (post_id, expected + 1, json.dumps({"kind": "qa", **content}, ensure_ascii=False), now))
            return {"item": _item(row), "post": editorial_posts.item(db.execute("SELECT * FROM editorial_posts WHERE id=?", (post_id,)).fetchone())}
        if "expectedVersion" in payload:
            raise ValueError("answer-conflict")
        if current and current["status"] == "withdrawn" and row["status"] == "pending" and row["answer_post_id"] is None:
            content = json.loads(current["content"])
            content.update(bodyJa=body, titleEn="", introEn="", bodyEn="")
            encoded = json.dumps(content, ensure_ascii=False)
            db.execute("UPDATE editorial_posts SET version=version+1,status='published',content=?,updated_at=?,published_at=? WHERE id=?", (encoded, now, now, post_id))
            db.execute("INSERT INTO editorial_post_history(post_id,version,action,content,actor,reason,at) VALUES(?,?,'published',?,'authenticated-owner','Owner answered again',?)", (post_id, current["version"] + 1, json.dumps({"kind": "qa", **content}, ensure_ascii=False), now))
            db.execute("UPDATE member_questions SET status='answered',answer_post_id=?,updated_at=? WHERE id=?", (post_id, now, question_id))
            return {"item": _item(db.execute("SELECT * FROM member_questions WHERE id=?", (question_id,)).fetchone())}
        if current:
            if current["status"] != "published" or json.loads(current["content"])["bodyJa"] != body or row["answer_post_id"] != post_id:
                raise ValueError("answer-conflict")
            return {"item": _item(row), "post": editorial_posts.item(current)}
        if row["status"] == "answered":
            raise ValueError("answer-conflict")
        content = {key: "" for key in editorial_posts.FIELDS}
        content.update(titleJa=row["body"][:180], introJa="", bodyJa=body,
                       sourceNotes="owner-question-answer", sources=[])
        encoded = json.dumps(content, ensure_ascii=False)
        db.execute("INSERT INTO editorial_posts VALUES(?,1,'qa',?,'published',?,?)", (post_id,encoded,now,now))
        db.execute("INSERT INTO editorial_post_history(post_id,version,action,content,actor,reason,at) VALUES(?,1,'published',?,'authenticated-owner','Direct owner reply',?)", (post_id,json.dumps({"kind":"qa",**content},ensure_ascii=False),now))
        db.execute("UPDATE member_questions SET status='answered',answer_post_id=?,updated_at=? WHERE id=?", (post_id,now,question_id))
        return {"item": _item(db.execute("SELECT * FROM member_questions WHERE id=?", (question_id,)).fetchone())}
