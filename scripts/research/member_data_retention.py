"""Member data retention for the research monitor database (owner-approved, Nov 20).

Two jobs, both OFF unless their variable is exactly "true":

- MEMBER_ERASURE_ENABLED: erase the monitor-side data of a member whose Clerk account was deleted (退会). The website
  sends the Clerk user id plus the HMAC keys it uses for that member (it holds the key; this process never derives them).
  Push devices, saved research and notes, watchlists and Notes reactions are deleted; questions to Ask Rizel are kept as
  rows (the day's counts and published answers refer to them) with the text blanked and the owner key replaced by a value
  derived from the question id only. The Postgres steps (PRO billing, RESOLUTE) are queued for the erasure job.
- RESEARCH_RETENTION_PURGE_ENABLED: periodic purge of expired data (long-inactive push devices and their dependent rows,
  stale test-notice claims, orphaned device rows, text of questions deleted more than 30 days ago).

The owner accounts are never erased and their devices are never purged, whatever the request says.
Answers carry counts only: never a member id, key, endpoint or text.
"""
import hashlib
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone

# Mirrors OWNER_ACCOUNT_ID and PRODUCTION_OWNER_ACCOUNT_ID in lib/membership/entitlements.ts (a test keeps them equal).
OWNER_ACCOUNT_IDS = frozenset({"user_3JulL4D07KtVl5Eg2zdY1iczKbC", "user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb"})

MEMBER_ID = re.compile(r"user_[A-Za-z0-9]{1,128}")
OWNER_KEY = re.compile(r"[a-f0-9]{64}")
KEY_NAMES = ("savedResearch", "favorites", "question", "deskReaction")
STEPS = ("billing", "resolute")
REFUSALS = frozenset({"owner-account", "invalid-member", "invalid-keys", "invalid-request", "invalid-step"})

# Retention periods (seconds / days). See docs/DATA-RETENTION-2026-11-20.md.
INACTIVE_DEVICE_SECONDS = 90 * 86400
TEST_ATTEMPT_SECONDS = 86400
DELETED_QUESTION_TEXT_DAYS = 30
ERASURE_LOG_DAYS = 3 * 365


def _flag(name, env=None):
    return (os.environ if env is None else env).get(name, "").strip().lower() == "true"


def erasure_enabled(env=None):
    return _flag("MEMBER_ERASURE_ENABLED", env)


def purge_enabled(env=None):
    return _flag("RESEARCH_RETENTION_PURGE_ENABLED", env)


def is_owner(member_id):
    return member_id in OWNER_ACCOUNT_IDS


def schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS member_erasure_requests (
      member_id TEXT PRIMARY KEY, requested_at REAL NOT NULL, billing_done_at REAL, resolute_done_at REAL)""")
    # Proof that an erasure ran: a random receipt and counts. No member id, key or hash of one.
    db.execute("""CREATE TABLE IF NOT EXISTS member_erasure_log (
      receipt TEXT PRIMARY KEY, erased_at REAL NOT NULL, counts TEXT NOT NULL)""")


def _tables(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(db, table):
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def validate_request(payload):
    if not isinstance(payload, dict):
        raise ValueError("invalid-request")
    member = payload.get("memberId")
    if not isinstance(member, str) or not MEMBER_ID.fullmatch(member):
        raise ValueError("invalid-member")
    keys = payload.get("keys")
    if not isinstance(keys, dict) or set(keys) != set(KEY_NAMES) or not all(
            isinstance(keys[k], str) and OWNER_KEY.fullmatch(keys[k]) for k in KEY_NAMES):
        raise ValueError("invalid-keys")
    return member, {k: keys[k] for k in KEY_NAMES}


def _delete_devices(db, tables, device_ids):
    counts = {"pushDevices": 0}
    if not device_ids:
        return counts
    marks = ",".join("?" * len(device_ids))
    for table in ("push_deliveries", "push_device_preferences", "push_notices", "push_test_attempts"):
        if table in tables:
            db.execute(f"DELETE FROM {table} WHERE device_id IN ({marks})", device_ids)
    counts["pushDevices"] = db.execute(f"DELETE FROM push_devices WHERE id IN ({marks})", device_ids).rowcount
    return counts


def _stamp(now):
    return datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="milliseconds")


def erase_member(db, payload, now=None, env=None):
    """Erase one departed member's monitor data. Owner accounts are refused before anything else."""
    member, keys = validate_request(payload)
    if is_owner(member):
        raise ValueError("owner-account")
    if not erasure_enabled(env):
        return {"status": "disabled"}
    now = time.time() if now is None else now
    schema(db)
    tables = _tables(db)
    counts = {"pushDevices": 0, "savedResearch": 0, "favoriteLists": 0, "deskReactions": 0, "questionsAnonymized": 0}
    db.execute("BEGIN IMMEDIATE")
    try:
        if "push_devices" in tables:
            columns = _columns(db, "push_devices")
            clauses, args = [], []
            if "owner_id" in columns:
                clauses.append("owner_id=?")
                args.append(member)
            if "question_owner" in columns:
                clauses.append("question_owner=?")
                args.append(keys["question"])
            if clauses:
                ids = [r[0] for r in db.execute(f"SELECT id FROM push_devices WHERE {' OR '.join(clauses)}", args)]
                counts.update(_delete_devices(db, tables, ids))
        if "member_saved_research" in tables:
            counts["savedResearch"] = db.execute("DELETE FROM member_saved_research WHERE owner=?", (keys["savedResearch"],)).rowcount
        if "member_favorite_lists" in tables:
            counts["favoriteLists"] = db.execute("DELETE FROM member_favorite_lists WHERE owner=?", (keys["favorites"],)).rowcount
        if "desk_reactions" in tables:
            counts["deskReactions"] = db.execute("DELETE FROM desk_reactions WHERE owner_key=?", (keys["deskReaction"],)).rowcount
        if "member_questions" in tables:
            columns = _columns(db, "member_questions")
            rows = [r[0] for r in db.execute("SELECT id FROM member_questions WHERE owner_key=?", (keys["question"],))]
            for qid in rows:
                sets = ["body=''", "owner_key=?"]
                args = [hashlib.sha256(("erased-question:" + qid).encode()).hexdigest()]
                if "body_en" in columns:
                    sets.append("body_en=''")
                if "held_reason" in columns:
                    sets.append("held_reason=''")
                if "deleted_at" in columns:
                    sets.append("deleted_at=COALESCE(deleted_at, ?)")
                    args.append(_stamp(now))
                db.execute(f"UPDATE member_questions SET {', '.join(sets)} WHERE id=?", (*args, qid))
            counts["questionsAnonymized"] = len(rows)
        db.execute("""INSERT INTO member_erasure_requests(member_id, requested_at) VALUES(?,?)
          ON CONFLICT(member_id) DO NOTHING""", (member, now))
        receipt = secrets.token_hex(16)
        db.execute("INSERT INTO member_erasure_log VALUES(?,?,?)", (receipt, now, json.dumps(counts, sort_keys=True)))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"status": "erased", "receipt": receipt, **counts}


def pending_requests(db, limit=20):
    """Members whose Postgres steps are not done yet, for the erasure job (bearer-authenticated route only)."""
    schema(db)
    rows = db.execute("""SELECT member_id, billing_done_at, resolute_done_at FROM member_erasure_requests
      WHERE billing_done_at IS NULL OR resolute_done_at IS NULL ORDER BY requested_at LIMIT ?""", (max(1, min(int(limit), 100)),))
    return [{"memberId": r[0], "pending": [s for s, done in zip(STEPS, r[1:]) if done is None]}
            for r in rows if not is_owner(r[0])]


def acknowledge(db, payload, now=None):
    """Record one finished Postgres step. When every step is done the queued member id is removed."""
    if not isinstance(payload, dict) or payload.get("step") not in STEPS:
        raise ValueError("invalid-step")
    member = payload.get("memberId")
    if not isinstance(member, str) or not MEMBER_ID.fullmatch(member):
        raise ValueError("invalid-member")
    now = time.time() if now is None else now
    schema(db)
    with db:
        db.execute(f"UPDATE member_erasure_requests SET {payload['step']}_done_at=COALESCE({payload['step']}_done_at, ?) WHERE member_id=?",
                   (now, member))
        removed = db.execute("""DELETE FROM member_erasure_requests WHERE member_id=?
          AND billing_done_at IS NOT NULL AND resolute_done_at IS NOT NULL""", (member,)).rowcount
    return {"acknowledged": True, "complete": bool(removed)}


def purge_expired(db, now=None, env=None):
    """Periodic purge. Counts only. Owner accounts' devices are never purged."""
    if not purge_enabled(env):
        return {"status": "disabled"}
    now = time.time() if now is None else now
    schema(db)
    tables = _tables(db)
    counts = {"inactiveDevices": 0, "orphanRows": 0, "testAttempts": 0, "deletedQuestionText": 0, "erasureLog": 0}
    db.execute("BEGIN IMMEDIATE")
    try:
        if "push_devices" in tables:
            columns = _columns(db, "push_devices")
            owner_filter, args = "", [now - INACTIVE_DEVICE_SECONDS]
            if "owner_id" in columns:
                owner_filter = f" AND (owner_id IS NULL OR owner_id NOT IN ({','.join('?' * len(OWNER_ACCOUNT_IDS))}))"
                args += sorted(OWNER_ACCOUNT_IDS)
            ids = [r[0] for r in db.execute(f"SELECT id FROM push_devices WHERE active=0 AND since<?{owner_filter}", args)]
            counts["inactiveDevices"] = _delete_devices(db, tables, ids)["pushDevices"]
            for table in ("push_deliveries", "push_device_preferences", "push_notices", "push_test_attempts"):
                if table in tables:
                    counts["orphanRows"] += db.execute(
                        f"DELETE FROM {table} WHERE device_id NOT IN (SELECT id FROM push_devices)").rowcount
        if "push_test_attempts" in tables:
            counts["testAttempts"] = db.execute("DELETE FROM push_test_attempts WHERE attempted_at<?",
                                                (now - TEST_ATTEMPT_SECONDS,)).rowcount
        if "member_questions" in tables and "deleted_at" in _columns(db, "member_questions"):
            cutoff = _stamp(now - DELETED_QUESTION_TEXT_DAYS * 86400)
            extra = ", body_en=''" if "body_en" in _columns(db, "member_questions") else ""
            counts["deletedQuestionText"] = db.execute(
                f"UPDATE member_questions SET body=''{extra} WHERE deleted_at IS NOT NULL AND deleted_at<? AND body<>''",
                (cutoff,)).rowcount
        counts["erasureLog"] = db.execute("DELETE FROM member_erasure_log WHERE erased_at<?",
                                          (now - ERASURE_LOG_DAYS * 86400,)).rowcount
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"status": "purged", **counts}


if __name__ == "__main__":
    import argparse
    import sqlite3
    parser = argparse.ArgumentParser(description="Periodic purge of expired monitor data (needs RESEARCH_RETENTION_PURGE_ENABLED=true).")
    parser.add_argument("database")
    arguments = parser.parse_args()
    connection = sqlite3.connect(arguments.database, timeout=20, isolation_level=None)
    try:
        print(json.dumps({"event": "retention-purge", **purge_expired(connection)}))
    finally:
        connection.close()
