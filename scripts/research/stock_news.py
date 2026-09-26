"""Opt-in Stock News API intake. Private saved queue; never auto-publishes.

Only the API endpoint is fetched. Article/image links are not downloaded.
Run one shared worker against one persistent SQLite database, not per viewer.
"""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ENDPOINT = "https://stocknewsapi.com/api/v1"
MAX_BYTES = 2_000_000


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def article_url(value):
    """Normalize known tracking params only; never fetch a supplied article URL."""
    url = urlsplit(value)
    if (url.scheme not in {"http", "https"} or not url.hostname or
            url.username or url.password or url.port not in {None, 80, 443} or
            "." not in url.hostname or len(value) > 4096):
        raise ValueError("invalid-article-url")
    try:
        ipaddress.ip_address(url.hostname)
    except ValueError:
        pass
    else:
        raise ValueError("invalid-article-url")
    query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
    return urlunsplit((url.scheme, url.netloc.lower(), url.path or "/", urlencode(sorted(query)), ""))


def normalize(row, tickers):
    if not isinstance(row, dict):
        raise ValueError("invalid-news-item")
    url = article_url(row.get("news_url", ""))
    title, text, publisher = (row.get(k) for k in ("title", "text", "source_name"))
    if not all(isinstance(v, str) for v in (title, text, publisher)) or not title.strip() or not publisher.strip():
        raise ValueError("invalid-news-item")
    if len(title) > 2000 or len(text) > 100000 or len(publisher) > 500:
        raise ValueError("news-item-too-large")
    published = parsedate_to_datetime(row.get("date", ""))
    if published.tzinfo is None:
        raise ValueError("news-date-without-timezone")
    tags = row.get("tickers")
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValueError("invalid-news-tickers")
    matched = sorted(set(tags) & set(tickers))
    if not matched:
        return None
    item = {"url": url, "title": title.strip(), "text": text.strip(), "publisher": publisher.strip(),
            "tickers": matched, "publishedAt": published.astimezone(timezone.utc).isoformat()}
    item["id"] = hashlib.sha256(url.encode()).hexdigest()
    item["revision"] = hashlib.sha256(json.dumps(item, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return item


def connect(path):
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS news_intake_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS news_api_calls(at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS news_calls_at ON news_api_calls(at);
      CREATE TABLE IF NOT EXISTS news_articles(
        id TEXT PRIMARY KEY, revision TEXT NOT NULL, body TEXT NOT NULL,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        summary_ja TEXT, summary_en TEXT, draft_revision TEXT, displayed_at TEXT);
    """)
    return db


def state(db, key):
    row = db.execute("SELECT value FROM news_intake_state WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def put_state(db, key, value):
    db.execute("INSERT INTO news_intake_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def reserve_call(db, now, cap):
    """Reserve before network I/O, including failed calls; serialize workers."""
    with db:
        db.execute("BEGIN IMMEDIATE")
        month = now[:7]
        used = db.execute("SELECT COUNT(*) FROM news_api_calls WHERE at>=?", (month + "-01",)).fetchone()[0]
        if used >= cap:
            raise ValueError("stock-news-monthly-limit")
        db.execute("INSERT INTO news_api_calls VALUES(?)", (now,))
        db.execute("DELETE FROM news_api_calls WHERE at<?", ((datetime.fromisoformat(now)-timedelta(days=65)).isoformat(),))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("stock-news-redirect-blocked")


def request_page(tickers, page, token):
    params = {"tickers": ",".join(tickers), "items": 100, "page": page, "token": token}
    request = Request(ENDPOINT + "?" + urlencode(params), headers={"Accept": "application/json"})
    # Never propagate exception text/URLs: the provider uses a query-string key.
    try:
        with build_opener(NoRedirect()).open(request, timeout=20) as response:
            if response.headers.get_content_type() != "application/json":
                raise ValueError("stock-news-content-type")
            body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("stock-news-response-limit")
        data = json.loads(body)
        if not isinstance(data, dict) or not isinstance(data.get("data"), list) or len(data["data"]) > 100:
            raise ValueError("stock-news-invalid-response")
        return data["data"]
    except HTTPError as exc:
        raise ValueError(f"stock-news-http-{exc.code}") from None
    except Exception:
        raise ValueError("stock-news-fetch-failed") from None


def save_items(db, items, now):
    added = changed = 0
    with db:
        for item in items:
            row = db.execute("SELECT revision FROM news_articles WHERE id=?", (item["id"],)).fetchone()
            added += row is None
            changed += row is not None and row[0] != item["revision"]
            db.execute("""INSERT INTO news_articles(id,revision,body,first_seen,last_seen)
              VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
              body=excluded.body,last_seen=excluded.last_seen""", (
                item["id"], item["revision"], json.dumps(item, ensure_ascii=False), now, now))
    return added, changed


def save_draft(db, article_id, revision, japanese, english):
    """One bilingual draft per article revision; rejects stale work after correction."""
    if not all(isinstance(v, str) and 1 <= len(v.strip()) <= 2000 for v in (japanese, english)):
        raise ValueError("both-news-languages-required")
    with db:
        result = db.execute("""UPDATE news_articles SET summary_ja=?,summary_en=?,draft_revision=?
          WHERE id=? AND revision=?""", (japanese.strip(), english.strip(), revision, article_id, revision))
        if result.rowcount != 1:
            raise ValueError("stale-news-draft")


def queue(db, limit=20):
    items = []
    for row in db.execute("SELECT * FROM news_articles ORDER BY first_seen DESC,id LIMIT ?", (max(1, min(50, limit)),)):
        item = json.loads(row["body"])
        delta = (datetime.fromisoformat(row["first_seen"]) - datetime.fromisoformat(item["publishedAt"])).total_seconds()
        current_draft = row["draft_revision"] == row["revision"]
        items.append({**item, "observedAt": row["first_seen"], "lastSeenAt": row["last_seen"],
                      "publicationToIntakeMs": round(delta*1000) if delta >= 0 else None,
                      "summaryJa": row["summary_ja"] if current_draft else None,
                      "summaryEn": row["summary_en"] if current_draft else None,
                      "draftCurrent": current_draft, "displayedAt": row["displayed_at"]})
    month = stamp()[:7] + "-01"
    calls = db.execute("SELECT COUNT(*) FROM news_api_calls WHERE at>=?", (month,)).fetchone()[0]
    return {"items": items, "callsThisMonth": calls, "lastSuccessAt": state(db, "last_success"),
            "lastError": state(db, "last_error"), "publicationEnabled": False}


def poll(db, tickers, *, transport=request_page):
    token = os.environ.get("STOCK_NEWS_API_KEY", "").strip()
    if os.environ.get("STOCK_NEWS_ENABLED", "").lower() != "true" or not token:
        return {"status": "disabled", "calls": 0, "publicationEnabled": False}
    tickers = sorted(set(tickers))
    if not 1 <= len(tickers) <= 50 or not all(re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", t) for t in tickers):
        raise ValueError("stock-news-requires-1-to-50-tickers")
    cap = int(os.environ.get("STOCK_NEWS_MONTHLY_CALL_LIMIT", "48000"))
    if not 1 <= cap <= 50000:
        raise ValueError("invalid-stock-news-call-limit")
    now = stamp()
    with db:
        db.execute("BEGIN IMMEDIATE")
        next_at = state(db, "next_poll")
        if next_at and next_at > now:
            return {"status": "waiting", "calls": 0}
        # Lease covers up to five 20-second requests before another worker may run.
        put_state(db, "next_poll", (datetime.fromisoformat(now)+timedelta(seconds=180)).isoformat())
    watch_key = hashlib.sha256(",".join(tickers).encode()).hexdigest()
    initial = state(db, "watch_key") != watch_key
    known = {r[0] for r in db.execute("SELECT id FROM news_articles")}
    calls = added = changed = rejected = 0
    saturated = False
    try:
        for page in range(1, 6):
            reserve_call(db, stamp(), cap)
            calls += 1
            rows = transport(tickers, page, token)
            if not isinstance(rows, list) or len(rows) > 100:
                raise ValueError("stock-news-invalid-response")
            items = []
            for row in rows:
                try:
                    item = normalize(row, tickers)
                    if item:
                        items.append(item)
                except (ValueError, TypeError, AttributeError, OverflowError):
                    rejected += 1
            a, c = save_items(db, items, stamp())
            added += a
            changed += c
            overlap = any(item["id"] in known for item in items)
            saturated = len(rows) == 100 and not overlap
            if initial or len(rows) < 100 or overlap:
                break
        with db:
            put_state(db, "watch_key", watch_key)
            put_state(db, "last_success", stamp())
            put_state(db, "last_error", "")
            put_state(db, "next_poll", (datetime.fromisoformat(now)+timedelta(seconds=60)).isoformat())
        return {"status": "ok", "calls": calls, "added": added, "changed": changed,
                "rejected": rejected, "initialBaseline": initial, "historyIncomplete": saturated,
                "publicationEnabled": False}
    except Exception:
        # Persist only a fixed code; no secret-bearing URLs or provider bodies.
        with db:
            put_state(db, "last_error", "stock-news-intake-failed")
            put_state(db, "next_poll", (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
        return {"status": "error", "calls": calls, "added": added, "changed": changed,
                "error": "stock-news-intake-failed", "publicationEnabled": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--tickers", required=True, help="Comma-separated symbols, max 50")
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    with connect(args.db) as db:
        while True:
            print(json.dumps(poll(db, args.tickers.split(","))), flush=True)
            if not args.watch:
                break
            time.sleep(60)
