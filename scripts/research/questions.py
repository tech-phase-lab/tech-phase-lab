"""PRO board posts, preserved private submissions, and owner moderation."""

import re
import secrets
import sqlite3
from datetime import datetime, timezone


QUESTION_ID = re.compile(r"q-[a-f0-9]{32}")
OWNER_KEY = re.compile(r"[a-f0-9]{64}")
POST_ID = re.compile(r"[a-z0-9-]{16,64}")
STATUSES = {"pending", "answered", "closed"}


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


def _item(row, include_body=True):
    value = {
        "id": row["id"], "status": row["status"], "audience": row["audience"],
        "answerPostId": row["answer_post_id"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }
    if include_body:
        value["body"] = row["body"]
        value["bodyEn"] = row["body_en"]
    return value


def submit(db, payload):
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
            return {"item": _item(current)}
        if audience == "pro-board":
            count = db.execute("SELECT count(*) FROM member_questions WHERE owner_key=? AND audience='pro-board' AND created_at>=?", (owner_key, now[:10])).fetchone()[0]
            if count >= 10:
                raise ValueError("question-daily-limit")
        db.execute(
            "INSERT INTO member_questions(id,owner_key,body,status,answer_post_id,created_at,updated_at,audience) VALUES(?,?,?,?,?,?,?,?)",
            (question_id, owner_key, body, "pending", None, now, now, audience),
        )
        return {"item": _item(db.execute(
            "SELECT * FROM member_questions WHERE id=?", (question_id,)
        ).fetchone())}


def member_queue(db, owner_key, limit=20):
    owner_key = _owner(owner_key)
    limit = max(1, min(int(limit), 20))
    rows = db.execute("""
      SELECT * FROM member_questions WHERE owner_key=?
      ORDER BY created_at DESC,id DESC LIMIT ?
    """, (owner_key, limit)).fetchall()
    return {"items": [_item(row) for row in rows]}


def board_queue(db, owner_key, limit=50):
    owner_key = _owner(owner_key)
    limit = max(1, min(int(limit), 50))
    rows = db.execute("SELECT * FROM member_questions WHERE audience='pro-board' AND status!='closed' ORDER BY created_at DESC,id DESC LIMIT ?", (limit,)).fetchall()
    items = [{**_item(row), "isMine": row["owner_key"] == owner_key} for row in rows]
    private = db.execute("SELECT * FROM member_questions WHERE owner_key=? AND audience='private' ORDER BY created_at DESC,id DESC LIMIT 20", (owner_key,)).fetchall()
    return {"items": items, "privateItems": [_item(row) for row in private], "audience": "pro-board"}


def moderation_queue(db, view="pending", limit=50):
    if view not in STATUSES | {"all"}:
        raise ValueError("invalid-question-view")
    limit = max(1, min(int(limit), 100))
    where = "" if view == "all" else "WHERE status=?"
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
    return {"items": [_item(row) for row in rows], "answers": answers, "counts": counts}


def review(db, payload):
    question_id = _question_id(payload.get("id"))
    decision = payload.get("decision")
    if decision not in {"answered", "closed", "pending"}:
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
