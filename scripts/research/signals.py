"""Private, multi-company discovery. No publishing, AI calls, or notifications.

Feeds are fetched once per publisher. Company association uses accessible item
bodies, not just titles. Documents produce revisions at the same URL. The first
successful fetch is a baseline, including after errors but not after restarts.
"""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener
import xml.etree.ElementTree as ET

import monitor
import x_api

SOURCES = json.loads(Path(__file__).with_name("signal_sources.json").read_text())
MAX_BYTES = 12 * 1024 * 1024
MAX_TEXT = 160_000
MAX_ITEMS = 500
X_API_DAILY_REQUEST_LIMIT_DEFAULT = 100
X_API_DAILY_REQUEST_LIMIT_MAX = 10_000
ALIASES = {ticker: [p["name"]] for ticker, p in monitor.PROVIDERS.items()}
ALIASES.update({
    "ARM": ["Arm Holdings"], "BE": ["Bloom Energy"],
    "MU": ["Micron", "マイクロン"], "NBIS": ["Nebius", "ネビウス"],
    "TSM": ["TSMC", "Taiwan Semiconductor", "台湾積体電路"],
    "GOOGL": ["Google", "Alphabet"], "MSFT": ["Microsoft"],
    "AMD": ["AMD", "Advanced Micro Devices"], "NVDA": ["NVIDIA"],
    "SKHY": ["SK hynix", "SKハイニックス"], "GEV": ["GE Vernova"],
    "CRDO": ["Credo Technology"],
})
X_EXTRA_TICKERS = {ticker for source in SOURCES if source.get("format") == "x-api"
                   for ticker in source.get("extraTickers", [])}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def safe_url(value, source):
    url = urlsplit(value)
    if (url.scheme != "https" or url.hostname not in source["allowedHosts"]
            or url.username or url.password or url.port not in (None, 443)):
        raise ValueError("unapproved-signal-url")
    query = [(k, v) for k, v in parse_qsl(url.query) if not k.lower().startswith("utm_")]
    return urlunsplit(("https", url.netloc, url.path, urlencode(query), ""))


class Redirects(HTTPRedirectHandler):
    def __init__(self, source):
        self.source = source

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl, self.source)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(source, validators):
    url = safe_url(source["url"], source)
    headers = {"User-Agent": "TechPhaseResearch/0.1 (+source-monitor)", "Accept-Encoding": "identity"}
    for key, header in (("etag", "If-None-Match"), ("last_modified", "If-Modified-Since")):
        value = monitor.http_validator(validators.get(key))
        if value:
            headers[header] = value
    try:
        with build_opener(Redirects(source)).open(Request(url, headers=headers), timeout=20) as response:
            content_type = response.headers.get_content_type()
            allowed = ({"text/html"} if source["format"] == "document" else {
                "application/rss+xml", "application/atom+xml", "application/xml", "text/xml",
            })
            if content_type not in allowed:
                raise ValueError("unexpected-signal-content-type")
            body, started = bytearray(), time.monotonic()
            while True:
                block = response.read(65536)
                if not block:
                    break
                body.extend(block)
                if len(body) > MAX_BYTES or time.monotonic() - started > 30:
                    raise ValueError("signal-response-limit")
            if not body:
                raise ValueError("empty-signal-response")
            return {"body": bytes(body), "etag": monitor.http_validator(response.headers.get("ETag")),
                    "last_modified": monitor.http_validator(response.headers.get("Last-Modified"))}
    except HTTPError as exc:
        if exc.code == 304:
            return {"not_modified": True}
        raise


def enabled_sources(sources=SOURCES):
    """Keep billable X reads opt-in even when a bearer token is present."""
    enabled = os.environ.get("X_API_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    return [source for source in sources
            if not source.get("enabledBy") or (enabled and bool(token))]


def acquire(source, validators, tickers=None):
    if source.get("format") == "x-api":
        if source not in enabled_sources([source]):
            raise ValueError("x-api-disabled")
        import x_api
        return x_api.fetch_posts(source, tickers or list(ALIASES))
    if source["format"] == "html-index":
        from html_signals import collect
        return collect(source, validators, tickers or list(ALIASES), fetch)
    return fetch(source, validators)


def validators_for(db, source, tickers):
    row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    if not row or row["config_sha"] != fingerprint(source, tickers):
        return {}
    result = dict(row)
    state = db.execute("SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)).fetchone()
    if state:
        result["index_state"] = state["body"]
    return result


def match_companies(text, tickers):
    matches = {}
    for ticker in tickers:
        aliases = ALIASES[ticker]
        terms = [alias for alias in aliases if re.search(
            r"(?<!\w)" + re.escape(alias) + r"(?!\w)", text, re.I
        )]
        if re.search(r"(?:\$|NASDAQ:|NYSE:)" + re.escape(ticker) + r"(?!\w)", text, re.I):
            terms.append("$" + ticker)
        if terms:
            matches[ticker] = terms
    return matches


def local_name(element):
    return element.tag.rsplit("}", 1)[-1]


def child_text(element, name):
    return next((" ".join(child.itertext()) for child in element if local_name(child) == name), "")


def date_value(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (ValueError, TypeError, IndexError):
            return None
    return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None


def parse(source, body, tickers):
    if source["format"] == "document":
        text = monitor.extract_html_text(body)
        if len(text) < 120 or len(text) >= MAX_TEXT:
            raise ValueError("signal-document-body-limit")
        return [{"url": safe_url(source["url"], source), "title": source["name"],
                 "text": text, "publishedAt": None,
                 "matches": {t: ["configured-document"] for t in source["tickers"] if t in tickers},
                 "truncated": False}]
    # Do not accept XML entities/DTDs; no parser may fetch external entities.
    if re.search(br"<!\s*(DOCTYPE|ENTITY)\b", body, re.I):
        raise ValueError("unsafe-signal-xml")
    root = ET.fromstring(body)
    if local_name(root) not in {"rss", "feed", "RDF"}:
        raise ValueError("not-a-signal-feed")
    entries = [item for item in root.iter() if local_name(item) in {"item", "entry"}]
    if len(entries) > MAX_ITEMS:
        raise ValueError("signal-item-limit")
    items = {}
    for item in entries:
        title = child_text(item, "title")[:500]
        link = child_text(item, "link")
        if not link:
            link = next((c.get("href", "") for c in item if local_name(c) == "link"
                         and c.get("rel", "alternate") == "alternate"), "")
        # Feed URLs are untrusted, even when the publisher is approved.
        try:
            link = safe_url(link, source)
        except ValueError:
            continue
        bodies = [child_text(item, name) for name in ("encoded", "content", "description", "summary")]
        raw = max(bodies, key=len, default="")
        text = monitor.extract_html_text(raw.encode()) if raw else title
        matches = match_companies(title + "\n" + text, tickers)
        for ticker in source.get("tickers", []):
            if ticker in tickers:
                matches.setdefault(ticker, ["publisher-company"])
        if not matches:
            continue
        items[link] = {"url": link, "title": title, "text": text,
                       "publishedAt": date_value(child_text(item, "pubDate") or child_text(item, "published")),
                       "matches": matches, "truncated": len(text) >= MAX_TEXT}
    return list(items.values())


def schema(db):
    db.executescript("""
      CREATE TABLE IF NOT EXISTS signal_index_state (source_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signal_routes (
        id TEXT PRIMARY KEY, initialized INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT, succeeded_at TEXT, next_check_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0, error TEXT, etag TEXT, last_modified TEXT,
        config_sha TEXT, last_duration_ms INTEGER, matched_items INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS signal_documents (
        source_id TEXT NOT NULL, url TEXT NOT NULL, sha TEXT NOT NULL,
        title TEXT NOT NULL, text TEXT NOT NULL, first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, PRIMARY KEY(source_id,url)
      );
      CREATE TABLE IF NOT EXISTS signal_events (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
        sha TEXT NOT NULL, previous_sha TEXT, title TEXT NOT NULL,
        tickers_json TEXT NOT NULL, matches_json TEXT NOT NULL,
        event_kind TEXT NOT NULL, published_at TEXT, published_on TEXT,
        observed_at TEXT NOT NULL,
        excerpt TEXT NOT NULL, diff TEXT NOT NULL, truncated INTEGER NOT NULL,
        UNIQUE(source_id,url,sha,previous_sha)
      );
      CREATE INDEX IF NOT EXISTS signal_event_time ON signal_events(observed_at);
      CREATE TABLE IF NOT EXISTS signal_x_request_attempts (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, attempted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signal_x_request_time ON signal_x_request_attempts(attempted_at);
      CREATE TABLE IF NOT EXISTS signal_route_transitions (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
        outcome TEXT NOT NULL, previous_kind TEXT, current_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS signal_route_transition_time
        ON signal_route_transitions(occurred_at);
    """)
    if "published_on" not in {row[1] for row in db.execute("PRAGMA table_info(signal_events)")}:
        db.execute("ALTER TABLE signal_events ADD COLUMN published_on TEXT")


class XApiDailyLimit(ValueError):
    def __init__(self, retry_at):
        super().__init__("x-api-daily-limit")
        self.retry_at = retry_at


class XApiPacing(ValueError):
    def __init__(self, retry_at):
        super().__init__("x-api-paced")
        self.retry_at = retry_at


def x_api_daily_limit():
    raw = os.environ.get("X_API_DAILY_REQUEST_LIMIT", str(X_API_DAILY_REQUEST_LIMIT_DEFAULT)).strip()
    if not raw.isdigit() or not 1 <= int(raw) <= X_API_DAILY_REQUEST_LIMIT_MAX:
        raise ValueError("x-api-daily-limit-invalid")
    return int(raw)


def x_api_request_plan(sources=SOURCES):
    """Return a query-free upper bound from configured polling intervals."""
    x_sources = [source for source in sources if source.get("format") == "x-api"]
    configured_max = 0
    for source in x_sources:
        normal = max(30, int(source["intervalSeconds"]))
        configured_max += (86400 + normal - 1) // normal
        window = source.get("fastWindow")
        if window:
            start = datetime.fromisoformat(window["startAt"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(window["endAt"].replace("Z", "+00:00"))
            duration = max(0, min(86400, (end - start).total_seconds()))
            fast = max(30, int(window["intervalSeconds"]))
            if fast < normal and duration:
                # Include boundary polls so the estimate remains conservative.
                configured_max += max(0, -(-int(duration) // fast) - int(duration) // normal + 2)
    daily_limit = x_api_daily_limit()
    local_max = min(configured_max, daily_limit)
    budget_capped = configured_max > daily_limit
    minimum_spacing = (86400 + daily_limit - 1) // daily_limit if budget_capped else 0
    return {
        "sourceCount": len(x_sources),
        "scope": "analyst-price-target-or-earnings",
        "configuredMaxRequestsPerDay": configured_max,
        "localMaxRequestsPerDay": local_max,
        "budgetCapped": budget_capped,
        "pacingEnabled": budget_capped,
        "minimumSpacingSeconds": minimum_spacing,
        "minimumSourceSpacingSeconds": minimum_spacing * max(1, len(x_sources)),
    }


def source_interval_seconds(source, checked_at):
    normal = max(30, int(source["intervalSeconds"]))
    window = source.get("fastWindow")
    if window:
        start = datetime.fromisoformat(window["startAt"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(window["endAt"].replace("Z", "+00:00"))
        if start <= checked_at < end:
            return max(30, min(normal, int(window["intervalSeconds"])))
    return normal


def x_api_usage(db, now=None, sources=SOURCES, ensure_schema=True):
    if ensure_schema:
        schema(db)
    current = now or datetime.now(timezone.utc)
    cutoff = (current - timedelta(hours=24)).isoformat()
    attempted = db.execute("""SELECT count(*) FROM signal_x_request_attempts
      WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?)""",
      (cutoff, current.isoformat())).fetchone()[0]
    oldest = db.execute(
        """SELECT attempted_at FROM signal_x_request_attempts
          WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?)
          ORDER BY datetime(attempted_at) LIMIT 1""",
        (cutoff, current.isoformat()),
    ).fetchone()
    newest = db.execute(
        """SELECT attempted_at FROM signal_x_request_attempts
          WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?)
          ORDER BY datetime(attempted_at) DESC LIMIT 1""",
        (cutoff, current.isoformat()),
    ).fetchone()
    limit = x_api_daily_limit()
    retry_at = None
    if attempted >= limit and oldest:
        retry_at = (datetime.fromisoformat(oldest["attempted_at"]) + timedelta(hours=24)).isoformat()
    requested = os.environ.get("X_API_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    configured = bool(os.environ.get("X_BEARER_TOKEN", "").strip())
    plan = x_api_request_plan(sources)
    paced_until = None
    if newest and plan["pacingEnabled"]:
        candidate = datetime.fromisoformat(newest["attempted_at"]) + timedelta(
            seconds=plan["minimumSpacingSeconds"]
        )
        if candidate > current:
            paced_until = candidate.isoformat()
    return {
        "requested": requested, "configured": configured, "enabled": requested and configured,
        "attemptsLast24Hours": attempted, "dailyLimit": limit,
        "limitReached": attempted >= limit, "nextAvailableAt": retry_at,
        "pacedUntil": paced_until, **plan,
    }


def reserve_x_api_request(db, source, now=None, eligible_source_ids=None):
    """Persist one billable attempt before network I/O without storing query or token."""
    if source.get("format") != "x-api":
        return None
    current = now or datetime.now(timezone.utc)
    schema(db)
    attempted_at = current.isoformat()
    cutoff = (current - timedelta(days=8)).isoformat()
    with db:
        # Serialize the usage check, fair-source selection and reservation even
        # when more than one worker process shares the SQLite database.
        db.execute("BEGIN IMMEDIATE")
        usage = x_api_usage(db, current, ensure_schema=False)
        if usage["limitReached"]:
            raise XApiDailyLimit(usage["nextAvailableAt"])
        if usage["pacingEnabled"]:
            eligible = list(dict.fromkeys(eligible_source_ids or [source["id"]]))
            cutoff_24h = (current - timedelta(hours=24)).isoformat()
            rows = {row["source_id"]: row for row in db.execute(
                """SELECT source_id,count(*) AS attempts,max(attempted_at) AS latest
                  FROM signal_x_request_attempts
                  WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?)
                  GROUP BY source_id""",
                (cutoff_24h, current.isoformat()),
            )}
            order = {item: index for index, item in enumerate(eligible)}
            candidate = min(eligible, key=lambda item: (
                int(rows.get(item, {"attempts": 0})["attempts"]),
                rows.get(item, {"latest": ""})["latest"] or "",
                order[item],
            ))
            if source["id"] != candidate or usage["pacedUntil"]:
                retry_at = usage["pacedUntil"] or (
                    current + timedelta(seconds=usage["minimumSpacingSeconds"])
                ).isoformat()
                raise XApiPacing(retry_at)
        cursor = db.execute("""INSERT INTO signal_x_request_attempts(source_id,attempted_at)
          SELECT ?,? WHERE (SELECT count(*) FROM signal_x_request_attempts
            WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?))<?""",
          (source["id"], attempted_at, (current - timedelta(hours=24)).isoformat(),
           current.isoformat(), usage["dailyLimit"]))
        if cursor.rowcount != 1:
            refreshed = x_api_usage(db, current, ensure_schema=False)
            raise XApiDailyLimit(refreshed["nextAvailableAt"])
        db.execute("""DELETE FROM signal_x_request_attempts
          WHERE datetime(attempted_at) IS NULL OR datetime(attempted_at)<datetime(?)""", (cutoff,))
    return x_api_usage(db, current)


def fingerprint(source, tickers):
    identity = {key: value for key, value in source.items() if source.get("format") != "x-api"
                or key not in {"intervalSeconds", "maxResults", "fastWindow"}}
    return hashlib.sha256(json.dumps([identity, {t: ALIASES[t] for t in tickers}, 1], sort_keys=True).encode()).hexdigest()


def legacy_x_fingerprint(source, tickers):
    old = {**source, "intervalSeconds": 120, "maxResults": 10}
    return hashlib.sha256(json.dumps([old, {t: ALIASES[t] for t in tickers}, 1], sort_keys=True).encode()).hexdigest()


def evidence_excerpt(item):
    text = item["text"]
    chunks = []
    for terms in item["matches"].values():
        for term in terms:
            at = text.lower().find(term.lower())
            if at >= 0:
                part = text[max(0, at - 100):at + 600]
                if part not in chunks:
                    chunks.append(part)
                break
    return "\n…\n".join(chunks)[:2400] or text[:1000]


def record_route_transition(db, source_id, previous_route, current_error, occurred_at):
    """Persist only state changes; repeated identical failures do not inflate totals."""
    if previous_route is None:
        return
    previous_error = previous_route["error"]
    previous_kind = signal_error_kind(previous_error) if previous_error else None
    current_kind = signal_error_kind(current_error) if current_error else None
    if previous_kind and not current_kind:
        outcome = "recovered"
    elif not previous_kind and current_kind:
        outcome = "failed"
    elif previous_kind and current_kind and previous_kind != current_kind:
        outcome = "changed"
    else:
        return
    db.execute("""INSERT INTO signal_route_transitions(
      source_id,occurred_at,outcome,previous_kind,current_kind
      ) VALUES(?,?,?,?,?)""", (
        source_id, occurred_at, outcome, previous_kind, current_kind,
    ))
    cutoff = (datetime.fromisoformat(occurred_at) - timedelta(days=8)).isoformat()
    db.execute("""DELETE FROM signal_route_transitions
      WHERE datetime(occurred_at) IS NULL OR datetime(occurred_at)<datetime(?)""", (cutoff,))
    db.execute("""DELETE FROM signal_route_transitions WHERE id NOT IN
      (SELECT id FROM signal_route_transitions ORDER BY id DESC LIMIT 5000)""")


def save(db, source, items, response, checked, config_sha, duration):
    route = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    initial = not route or not route["initialized"] or (
        route["config_sha"] != config_sha and not (
            source.get("format") == "x-api" and
            route["config_sha"] == legacy_x_fingerprint(source, list(ALIASES))
        )
    )
    inserted = 0
    with db:
        for item in items:
            if not item["matches"] and not source.get("retainUnmatched"):
                continue
            digest = hashlib.sha256((item["title"] + "\n" + item["text"]).encode()).hexdigest()
            old = db.execute("SELECT * FROM signal_documents WHERE source_id=? AND url=?",
                             (source["id"], item["url"])).fetchone()
            if not old or old["sha"] != digest:
                kind = "baseline" if initial or item.get("baseline") else "changed" if old else "new"
                diff = ""
                if old and kind == "changed":
                    diff = "\n".join(difflib.unified_diff(
                        old["text"].splitlines(), item["text"].splitlines(),
                        fromfile="previous", tofile="current", n=2,
                    ))[:6000]
                cursor = db.execute("""INSERT OR IGNORE INTO signal_events(
                  source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
                  published_at,published_on,observed_at,excerpt,diff,truncated
                  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                    source["id"], item["url"], digest, old["sha"] if old else "",
                    item["title"], json.dumps(sorted(item["matches"])), json.dumps(item["matches"]),
                    kind, item["publishedAt"], item.get("publishedOn"), checked,
                    evidence_excerpt(item), diff, int(item["truncated"]),
                ))
                inserted += cursor.rowcount
            if item.get("publishedOn"):
                # Enrich an unchanged historical baseline after this column is
                # deployed, without creating a new event or rewriting evidence.
                db.execute("""UPDATE signal_events SET published_on=?
                  WHERE source_id=? AND url=? AND sha=?
                  AND (published_on IS NULL OR published_on='')""", (
                    item["publishedOn"], source["id"], item["url"], digest,
                ))
            # Retain document bodies privately for meaningful same-URL changes.
            db.execute("""INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(source_id,url) DO UPDATE SET sha=excluded.sha,title=excluded.title,
              text=excluded.text,last_seen_at=excluded.last_seen_at""", (
                source["id"], item["url"], digest, item["title"], item["text"], checked, checked,
            ))
        next_check = (datetime.fromisoformat(checked) + timedelta(
            seconds=source_interval_seconds(source, datetime.fromisoformat(checked)))).isoformat()
        db.execute("""INSERT INTO signal_routes(id,initialized,checked_at,succeeded_at,next_check_at,
          failures,error,etag,last_modified,config_sha,last_duration_ms,matched_items)
          VALUES(?,1,?,?,?,0,NULL,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          initialized=1,checked_at=excluded.checked_at,succeeded_at=excluded.succeeded_at,
          next_check_at=excluded.next_check_at,failures=0,error=NULL,etag=excluded.etag,
          last_modified=excluded.last_modified,config_sha=excluded.config_sha,
          last_duration_ms=excluded.last_duration_ms,matched_items=excluded.matched_items""", (
            source["id"], checked, checked, next_check, response.get("etag"),
            response.get("last_modified"), config_sha, duration, len(items),
        ))
        if "index_state" in response:
            db.execute("INSERT INTO signal_index_state VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET body=excluded.body",
                       (source["id"], response["index_state"]))
            if response.get("article_errors"):
                db.execute("UPDATE signal_routes SET error=? WHERE id=?",
                           (f"article-fetch-failed:{response['article_errors']}", source["id"]))
        current_error = (f"article-fetch-failed:{response['article_errors']}"
                         if response.get("article_errors") else None)
        record_route_transition(db, source["id"], route, current_error, checked)
        # Bound private retention per publisher; keep enough fingerprints for restarts.
        db.execute("""DELETE FROM signal_documents WHERE source_id=? AND url NOT IN
          (SELECT url FROM signal_documents WHERE source_id=? ORDER BY last_seen_at DESC LIMIT 1000)""",
                   (source["id"], source["id"]))
        db.execute("""DELETE FROM signal_events WHERE source_id=? AND id NOT IN
          (SELECT id FROM signal_events WHERE source_id=? ORDER BY id DESC LIMIT 1000)""",
                   (source["id"], source["id"]))
    return inserted


def check(db, source, tickers, transport=None):
    schema(db)
    row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    config_sha = fingerprint(source, tickers)
    validators = validators_for(db, source, tickers)
    started = time.monotonic()
    try:
        response = transport(source, validators) if transport else acquire(source, validators, tickers)
        checked = stamp()
        if response.get("not_modified"):
            if not validators.get("initialized"):
                raise ValueError("signal-304-without-baseline")
            with db:
                db.execute("""UPDATE signal_routes SET checked_at=?,succeeded_at=?,next_check_at=?,
                  failures=0,error=NULL,last_duration_ms=? WHERE id=?""", (
                    checked, checked, (datetime.fromisoformat(checked) + timedelta(
                        seconds=source_interval_seconds(source, datetime.fromisoformat(checked)))).isoformat(),
                    round((time.monotonic() - started) * 1000), source["id"],
                ))
                record_route_transition(db, source["id"], row, None, checked)
            return {"source": source["id"], "status": "unchanged", "events": 0}
        items = response["_items"] if "_items" in response else parse(source, response["body"], tickers)
        count = save(db, source, items, response, checked, config_sha,
                     round((time.monotonic() - started) * 1000))
        return {"source": source["id"], "status": "partial" if response.get("article_errors") else "ok",
                "matchedItems": len(items), "events": count, "pendingArticles": response.get("article_pending", 0)}
    except Exception as exc:
        checked = stamp()
        paced = isinstance(exc, XApiPacing)
        failures = (row["failures"] if row else 0) if paced else min(
            20, (row["failures"] if row else 0) + 1
        )
        error = monitor.source_error_code(exc)
        if isinstance(exc, ET.ParseError):
            error = "invalid-feed-xml"
        retry_hint = monitor.retry_after_seconds(exc, datetime.fromisoformat(checked))
        delay = max(
            min(3600, max(30, source["intervalSeconds"]) * 2 ** failures),
            monitor.source_retry_seconds(error, failures, retry_hint),
        )
        next_check = (datetime.fromisoformat(checked) + timedelta(seconds=delay)).isoformat()
        if isinstance(exc, (XApiDailyLimit, XApiPacing)) and exc.retry_at:
            next_check = exc.retry_at
        with db:
            db.execute("""INSERT INTO signal_routes(id,checked_at,next_check_at,failures,error)
              VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,
              next_check_at=excluded.next_check_at,failures=excluded.failures,error=excluded.error""",
                       (source["id"], checked, next_check, failures, error))
            record_route_transition(db, source["id"], row, error, checked)
        return {"source": source["id"], "status": "error", "error": error, "events": 0}


def queue(db, sources=SOURCES, limit=30, ticker=None, view="all"):
    schema(db)
    if view not in {"all", "new", "changed", "baseline", "targets"} or (
            ticker and ticker not in ALIASES and ticker not in X_EXTRA_TICKERS):
        raise ValueError("invalid-signal-filter")
    configured = {source["id"]: source for source in sources}
    items = []
    counts = {"all": 0, "new": 0, "changed": 0, "baseline": 0, "targets": 0}
    for row in db.execute("SELECT * FROM signal_events ORDER BY observed_at DESC,id DESC"):
        if row["source_id"] not in configured:
            continue
        tickers = json.loads(row["tickers_json"])
        if ticker and ticker not in tickers:
            continue
        counts["all"] += 1
        counts[row["event_kind"]] += 1
        is_target = (row["source_id"].startswith("x-") and
                     row["event_kind"] == "new" and x_api.TARGET_PATTERN.search(row["title"]))
        if is_target:
            counts["targets"] += 1
        if (view == "targets" and not is_target) or (view not in {"all", "targets"} and
            row["event_kind"] != view) or len(items) >= max(1, min(50, limit)):
            continue
        source = configured[row["source_id"]]
        items.append({"id": row["id"], "source": source["name"], "sourceKind": source["kind"],
                      "reuse": source["reuse"], "url": safe_url(row["url"], source),
                      "title": row["title"], "tickers": tickers,
                      "matches": json.loads(row["matches_json"]), "eventKind": row["event_kind"],
                      "publishedAt": row["published_at"], "publishedOn": row["published_on"],
                      "observedAt": row["observed_at"],
                      "excerpt": row["excerpt"], "diff": row["diff"], "truncated": bool(row["truncated"]),
                      "status": "unreviewed", "sha256": row["sha"]})
    routes = []
    for source in sources:
        row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
        state_row = db.execute("SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)).fetchone()
        children = json.loads(state_row["body"]).get("children", {}) if state_row else {}
        article_errors = []
        for url, child in children.items():
            if not child.get("error"):
                continue
            try:
                url = safe_url(url, source)
            except ValueError:
                continue
            article_errors.append({"url": url, "error": child["error"],
                                   "nextCheckAt": child.get("next_check"),
                                   "checkedAt": child.get("checked")})
        routes.append({"pendingArticles": sum(not c.get("succeeded") for c in children.values()),
                       "articleErrors": article_errors[:20],
                       "id": source["id"], "name": source["name"], "kind": source["kind"],
                       "intervalSeconds": source["intervalSeconds"],
                       "checkedAt": row["checked_at"] if row else None,
                       "succeededAt": row["succeeded_at"] if row else None,
                       "nextCheckAt": row["next_check_at"] if row else None,
                       "error": row["error"] if row else None,
                       "matchedItems": row["matched_items"] if row else 0})
    return {"items": items, "counts": counts, "routes": routes, "xApiUsage": x_api_usage(db, sources=sources), "view": view,
            "ticker": ticker, "generatedAt": stamp(), "publicationEnabled": False}


PRICE_TARGET_TEXT = re.compile(
    r"price target (?:raised|lowered|cut|hiked) to \$(\d+(?:\.\d+)?) from \$(\d+(?:\.\d+)?)",
    re.I,
)
PRICE_TARGET_FIRM = re.compile(
    r"(?:at|by) (BofA|BNP Paribas|Citi|Citizens|KeyBanc|Stifel|UBS|JPMorgan|Seaport Research)\b",
    re.I,
)


def public_price_targets(db, sources=SOURCES, now=None, limit=20):
    """Publish only recent structured observations, never the X post body."""
    schema(db)
    now = now or datetime.now(timezone.utc)
    approved = {s["id"]: s for s in sources if s.get("format") == "x-api"}
    items = []
    rows = db.execute("""SELECT id,source_id,url,title,tickers_json,published_at,observed_at
                         FROM signal_events WHERE event_kind='new' AND source_id LIKE 'x-%'
                         ORDER BY observed_at DESC,id DESC LIMIT 300""").fetchall()
    for row in rows:
        source = approved.get(row["source_id"])
        if not source:
            continue
        try:
            published = datetime.fromisoformat(row["published_at"].replace("Z", "+00:00"))
            observed = datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00"))
            tickers = json.loads(row["tickers_json"])
            match = PRICE_TARGET_TEXT.search(row["title"].replace(",", ""))
            firm = PRICE_TARGET_FIRM.search(row["title"])
            url = safe_url(row["url"], source)
            old, new = (float(match.group(2)), float(match.group(1))) if match else (0, 0)
            if (published.tzinfo is None or observed.tzinfo is None or
                    not timedelta(0) <= now - published <= timedelta(hours=24) or
                    not timedelta(0) <= observed - published <= timedelta(minutes=15) or
                    not match or not firm or not isinstance(tickers, list) or len(tickers) != 1 or
                    tickers[0] not in ALIASES and tickers[0] not in X_EXTRA_TICKERS or
                    not 0 < old <= 100000 or not 0 < new <= 100000 or old == new):
                continue
        except (ValueError, TypeError, AttributeError, OverflowError):
            continue
        items.append({"id": row["id"], "ticker": tickers[0], "firm": firm.group(1),
                      "previous": old, "latest": new, "source": source["name"], "url": url,
                      "publishedAt": published.isoformat(), "observedAt": observed.isoformat()})
        if len(items) >= max(1, min(limit, 30)):
            break
    return {"ok": True, "items": items, "generatedAt": stamp()}


def signal_error_kind(error):
    """Collapse a private route error into one stable aggregate category."""
    value = str(error or "")
    if value in {"http-401", "http-403", "http-451", "verification-page"}:
        return "accessRestricted"
    if value == "http-429":
        return "rateLimited"
    if value == "timeout":
        return "timeout"
    if re.fullmatch(r"http-5\d\d", value):
        return "server"
    if value.startswith("article-fetch-failed:"):
        return "articlePartial"
    if value.startswith("signal-") or value in {
        "invalid-source-response", "unsupported-content-type",
        "empty-or-oversized-source", "no-extractable-text",
    }:
        return "invalidResponse"
    return "other"


def operational_summary(db, sources=SOURCES, reference=None):
    """Return URL-free health and publication-evidence totals for official routes."""
    schema(db)
    current = reference or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("signal-summary-reference-timezone")
    current = current.astimezone(timezone.utc)
    official = [source for source in sources
                if source.get("kind") != "external-research" and source.get("format") != "x-api"]
    configured = {source["id"]: source for source in official}

    def timestamp_value(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            parsed = parsed.astimezone(timezone.utc)
            return parsed if parsed <= current + timedelta(minutes=5) else None
        except (TypeError, ValueError):
            return None

    def retry_value(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            parsed = parsed.astimezone(timezone.utc)
            return parsed if parsed <= current + timedelta(days=7) else None
        except (TypeError, ValueError):
            return None

    error_kinds = {kind: 0 for kind in (
        "accessRestricted", "rateLimited", "timeout", "server",
        "invalidResponse", "articlePartial", "other",
    )}

    def retry_summary():
        return {
            "due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None,
            "byErrorKind": {
                kind: {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None}
                for kind in error_kinds
            },
        }

    def record_retry(summary, error_kind, value):
        kind_retry = summary["byErrorKind"][error_kind]
        next_check = retry_value(value)
        if next_check is None:
            summary["unscheduled"] += 1
            kind_retry["unscheduled"] += 1
        elif next_check <= current:
            summary["due"] += 1
            kind_retry["due"] += 1
        else:
            summary["deferred"] += 1
            kind_retry["deferred"] += 1
            next_at = summary["nextAt"]
            if next_at is None or next_check.isoformat() < next_at:
                summary["nextAt"] = next_check.isoformat()
            kind_next_at = kind_retry["nextAt"]
            if kind_next_at is None or next_check.isoformat() < kind_next_at:
                kind_retry["nextAt"] = next_check.isoformat()

    retry = retry_summary()
    route_counts = {"configured": len(official), "checked": 0, "fresh": 0,
                    "stale": 0, "error": 0, "pending": 0,
                    "errorKinds": error_kinds, "retry": retry}
    for source_id, source in configured.items():
        row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source_id,)).fetchone()
        if not row:
            route_counts["pending"] += 1
            continue
        if timestamp_value(row["checked_at"]):
            route_counts["checked"] += 1
        if row["error"]:
            route_counts["error"] += 1
            error_kind = signal_error_kind(row["error"])
            error_kinds[error_kind] += 1
            record_retry(retry, error_kind, row["next_check_at"])
            continue
        succeeded = timestamp_value(row["succeeded_at"])
        if not succeeded:
            route_counts["pending"] += 1
            continue
        freshness = max(300, int(source["intervalSeconds"]) * 3)
        if current - succeeded <= timedelta(seconds=freshness):
            route_counts["fresh"] += 1
        else:
            route_counts["stale"] += 1

    article_error_kinds = {kind: 0 for kind in error_kinds}
    article_retrieval = {
        "error": 0,
        "errorKinds": article_error_kinds,
        "retry": retry_summary(),
    }
    evidence = {"total": 0, "timestamp": 0, "dateOnly": 0, "missing": 0}
    transitions = {
        "recoveries": 0, "failures": 0, "changes": 0,
        "lastOutcome": None, "lastOccurredAt": None,
    }
    if configured:
        placeholders = ",".join("?" for _ in configured)
        for row in db.execute(f"""SELECT body FROM signal_index_state
          WHERE source_id IN ({placeholders})""", tuple(configured)):
            try:
                if len(row["body"]) > 2_000_000:
                    continue
                state = json.loads(row["body"])
                if not isinstance(state, dict):
                    continue
                children = state.get("children", {})
            except (TypeError, ValueError):
                continue
            if not isinstance(children, dict):
                continue
            for index, child in enumerate(children.values()):
                if index >= 1000:
                    break
                if not isinstance(child, dict) or not child.get("error"):
                    continue
                error_kind = signal_error_kind(child["error"])
                article_retrieval["error"] += 1
                article_error_kinds[error_kind] += 1
                record_retry(article_retrieval["retry"], error_kind, child.get("next_check"))
        rows = db.execute(f"""SELECT published_at,published_on FROM signal_events
          WHERE source_id IN ({placeholders})""", tuple(configured)).fetchall()
        for row in rows:
            evidence["total"] += 1
            if timestamp_value(row["published_at"]):
                evidence["timestamp"] += 1
                continue
            try:
                published_on = datetime.strptime(str(row["published_on"]), "%Y-%m-%d").date()
            except (TypeError, ValueError):
                published_on = None
            if published_on and published_on <= current.date():
                evidence["dateOnly"] += 1
            else:
                evidence["missing"] += 1
        cutoff = current - timedelta(hours=24)
        latest = None
        for row in db.execute(f"""SELECT occurred_at,outcome FROM signal_route_transitions
          WHERE source_id IN ({placeholders}) ORDER BY id""", tuple(configured)):
            occurred = timestamp_value(row["occurred_at"])
            outcome = row["outcome"]
            if not occurred or occurred < cutoff or occurred > current or outcome not in {
                    "recovered", "failed", "changed"}:
                continue
            key = {"recovered": "recoveries", "failed": "failures", "changed": "changes"}[outcome]
            transitions[key] += 1
            if latest is None or occurred >= latest[0]:
                latest = (occurred, outcome)
        if latest:
            transitions["lastOutcome"] = latest[1]
            transitions["lastOccurredAt"] = latest[0].isoformat()
    return {"routes": route_counts, "articleRetrieval": article_retrieval,
            "publicationEvidence": evidence,
            "routeTransitions24Hours": transitions}


def due(db, sources=None):
    schema(db)
    current = stamp()
    rows = {row["id"]: row for row in db.execute("SELECT * FROM signal_routes")}
    candidates = enabled_sources(SOURCES if sources is None else sources)
    return [s for s in candidates if s["id"] not in rows or not rows[s["id"]]["next_check_at"]
            or rows[s["id"]]["next_check_at"] <= current]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--source", choices=[s["id"] for s in SOURCES])
    args = parser.parse_args()
    sources = [s for s in SOURCES if not args.source or s["id"] == args.source]
    with monitor.connect(args.db) as db:
        while True:
            for source in due(db, sources) if args.watch else sources:
                print(json.dumps(check(db, source, list(ALIASES))), flush=True)
            if not args.watch:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
