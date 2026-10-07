"""Private, multi-company discovery. No publishing, AI calls, or notifications.

Feeds are fetched once per publisher. Company association uses accessible item
bodies, not just titles. Documents produce revisions at the same URL. The first
successful fetch is a baseline, including after errors but not after restarts.
"""
import argparse
from copy import deepcopy
import factual_validation
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import difflib
import hashlib
import gzip
import io
import json
import unicodedata
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
X_AUTHOR_INTAKE_SOURCE_IDS = frozenset({"x-tipranks", "x-wallstengine"})
X_RETENTION_TARGET = 1000
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
    headers = {"User-Agent": source.get("userAgent", "TechPhaseResearch/0.1 (+source-monitor)"), "Accept-Encoding": "identity"}
    for key, header in (("etag", "If-None-Match"), ("last_modified", "If-Modified-Since")):
        value = monitor.http_validator(validators.get(key)) if source.get("conditionalRequests", True) else None
        if value:
            headers[header] = value
    # This private record is derived from the actual outgoing HTTP headers.
    # A response cannot manufacture conditional category-baseline evidence.
    request_proof = {'url': url, 'validators': {key: headers[header] for key, header in
        (('etag', 'If-None-Match'), ('last_modified', 'If-Modified-Since')) if header in headers}}
    try:
        with build_opener(Redirects(source)).open(Request(url, headers=headers), timeout=20) as response:
            content_type = response.headers.get_content_type()
            allowed = ({"application/json"} if source["format"] == "json" else {"text/html"} if source["format"] == "document" else {
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
            # Some official sites send gzip even when identity was requested.
            # Bound the expanded bytes as well as the downloaded representation.
            encoding = (response.headers.get("Content-Encoding") or "identity").lower().strip()
            if encoding == "gzip":
                with gzip.GzipFile(fileobj=io.BytesIO(body)) as compressed:
                    body = compressed.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise ValueError("signal-response-limit")
                if not body:
                    raise ValueError("empty-signal-response")
            elif encoding != "identity":
                raise ValueError("unexpected-signal-content-type")
            return {"body": bytes(body), "etag": monitor.http_validator(response.headers.get("ETag")),
                    "last_modified": monitor.http_validator(response.headers.get("Last-Modified")),
                    "_effective_url": safe_url(response.geturl() if hasattr(response, "geturl") else url, source)}
    except HTTPError as exc:
        if exc.code == 304:
            return {"not_modified": True, "_http_status": 304, "_feed_request": request_proof,
                    "_effective_url": safe_url(exc.geturl(), source)}
        raise


def enabled_sources(sources=SOURCES):
    """Keep billable X reads opt-in even when a bearer token is present."""
    # The reviewed stream supervisor exclusively owns ALL X reads/writes in
    # its mode, including fallback. An invalid preflight must not fall through
    # into the old unmetered polling path or touch credentials here.
    if os.environ.get("X_FILTERED_STREAM_ENABLED", "").strip().lower() in {"1", "true", "yes"}:
        return [source for source in sources if source.get("enabled", True) and source.get("format") != "x-api" and not source.get("enabledBy")]
    enabled = os.environ.get("X_API_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    return [source for source in sources
            if source.get("enabled", True) and (not source.get("enabledBy") or (enabled and bool(token)))]


def acquire(source, validators, tickers=None):
    if source.get("format") == "x-api":
        if source not in enabled_sources([source]):
            raise ValueError("x-api-disabled")
        import x_api
        return x_api.fetch_posts(source, tickers or list(ALIASES), validators=validators)
    if source["format"] == "html-index":
        from html_signals import collect
        return collect(source, validators, tickers or list(ALIASES), fetch, stamp)
    return fetch(source, validators)


def prepare_x_query_window(db, source, now=None):
    """Pin the approved first window before reservation or network, not coverage.

    This commits only acquisition intent. Existing source evidence, route
    freshness, completed watermarks and saved-page counts are never invented.
    """
    if (source.get('format') != 'x-api' or source['id'] not in X_AUTHOR_INTAKE_SOURCE_IDS
            or os.environ.get('X_FILTERED_STREAM_ENABLED', '').strip().lower() in {'1', 'true', 'yes'}):
        return
    current = now or datetime.now(timezone.utc)
    generation = x_api.query_generation(source)
    with db:
        db.execute('BEGIN IMMEDIATE')
        stored = db.execute('SELECT body FROM signal_index_state WHERE source_id=?', (source['id'],)).fetchone()
        try:
            cursor = json.loads(stored['body']) if stored else {}
        except (ValueError, TypeError):
            cursor = {}
        if not isinstance(cursor, dict) or cursor.get('queryGeneration') != generation:
            start = (current-timedelta(hours=12)).isoformat(timespec='seconds').replace('+00:00', 'Z')
            cursor = {'queryGeneration': generation, 'generationStartedAt': current.isoformat(),
                      'startTime': start, 'coverageStartedAt': start, 'sinceId': None,
                      'pagesSaved': 0, 'postsSaved': 0, 'excludedAuthorRows': 0, 'truncatedRows': 0}
            db.execute('INSERT INTO signal_index_state VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET body=excluded.body',
                       (source['id'], json.dumps(cursor)))
    if x_api.window_expired(cursor, current):
        # Fail before a request-budget reservation; recovery needs an explicit
        # scoped decision, not a newly fabricated recent-history lower bound.
        raise ValueError('x-api-window-expired')


def require_x_polling_storage(db, source):
    """Backpressure before author-intake request admission; never prune to fit.

    Reuse the existing 8 MiB metadata floor on the database's actual filesystem.
    It is an admission floor, not a guarantee against other writers or WAL growth.
    In-memory databases have no disk-backed evidence volume to measure.
    """
    if (source.get('format') != 'x-api' or source['id'] not in X_AUTHOR_INTAKE_SOURCE_IDS
            or os.environ.get('X_FILTERED_STREAM_ENABLED', '').strip().lower() in {'1', 'true', 'yes'}):
        return
    try:
        path = next(row[2] for row in db.execute('PRAGMA database_list') if row[1] == 'main')
        if not path:
            return
        from x_preflight import MIN_FREE_BYTES
        stat = os.statvfs(path)
        if (type(stat.f_frsize) is not int or stat.f_frsize <= 0
                or type(stat.f_bavail) is not int or stat.f_bavail < 0
                or stat.f_frsize * stat.f_bavail < MIN_FREE_BYTES):
            raise ValueError
    except Exception as exc:
        raise ValueError('x-api-storage-low-or-unavailable') from exc


def validators_for(db, source, tickers):
    row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    state = db.execute("SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)).fetchone()
    if source.get('format') == 'x-api':
        try:
            cursor = json.loads(state['body']) if state else {}
        except (ValueError, TypeError):
            cursor = {}
        # Pagination belongs to the query, not mutable route/parser settings.
        # A budget pause or parser deployment cannot reset a durable page chain;
        # a widened query must never borrow the old chain or its watermark.
        if isinstance(cursor, dict) and cursor.get('queryGeneration') == x_api.query_generation(source):
            return {**(dict(row) if row else {}), 'index_state': state['body']}
        return {}
    if not row or row["config_sha"] != fingerprint(source, tickers):
        return {}
    result = dict(row)
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
      CREATE TABLE IF NOT EXISTS signal_x_acquisition (
        source_id TEXT NOT NULL, url TEXT NOT NULL, sha TEXT NOT NULL,
        title TEXT NOT NULL, text TEXT NOT NULL, published_at TEXT,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        truncated INTEGER NOT NULL, selected_for_processing INTEGER NOT NULL,
        PRIMARY KEY(source_id,url,sha)
      );
      CREATE TABLE IF NOT EXISTS signal_x_retention (
        source_id TEXT PRIMARY KEY, tracking_started_at TEXT NOT NULL,
        acquisition_rows_omitted INTEGER NOT NULL DEFAULT 0,
        document_rows_omitted INTEGER NOT NULL DEFAULT 0,
        event_rows_omitted INTEGER NOT NULL DEFAULT 0, last_omitted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS signal_routes (
        id TEXT PRIMARY KEY, initialized INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT, succeeded_at TEXT, next_check_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0, error TEXT, etag TEXT, last_modified TEXT,
        config_sha TEXT, last_duration_ms INTEGER, matched_items INTEGER NOT NULL DEFAULT 0,
        failure_started_at TEXT, failure_attempts INTEGER NOT NULL DEFAULT 0
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
      CREATE INDEX IF NOT EXISTS signal_target_publication_window
        ON signal_events(source_id,julianday(published_at));
      CREATE INDEX IF NOT EXISTS signal_source_observation_window
        ON signal_events(source_id,julianday(observed_at));
      CREATE TABLE IF NOT EXISTS signal_headline_translations (
        source_id TEXT NOT NULL, url TEXT NOT NULL, sha TEXT NOT NULL,
        headline_ja TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(source_id,url,sha)
      );
      CREATE TABLE IF NOT EXISTS signal_compact_headlines (
        source_id TEXT NOT NULL, url TEXT NOT NULL, sha TEXT NOT NULL,
        source_title TEXT NOT NULL, title_ja TEXT NOT NULL, title_en TEXT NOT NULL,
        PRIMARY KEY(source_id,url,sha)
      );
      CREATE TABLE IF NOT EXISTS signal_x_request_attempts (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, attempted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signal_x_request_time ON signal_x_request_attempts(attempted_at);
      CREATE TABLE IF NOT EXISTS signal_route_deferrals (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, deferred_at TEXT NOT NULL,
        retry_at TEXT NOT NULL, reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signal_route_deferral_time
        ON signal_route_deferrals(deferred_at);
      CREATE TABLE IF NOT EXISTS signal_route_transitions (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
        outcome TEXT NOT NULL, previous_kind TEXT, current_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS signal_route_transition_time
        ON signal_route_transitions(occurred_at);
      CREATE TABLE IF NOT EXISTS signal_route_recoveries (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL,
        failed_at TEXT NOT NULL, recovered_at TEXT NOT NULL,
        attempts INTEGER NOT NULL, error_kind TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signal_route_recovery_time
        ON signal_route_recoveries(recovered_at);
      CREATE TABLE IF NOT EXISTS signal_route_retry_attempts (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL,
        eligible_at TEXT NOT NULL, attempted_at TEXT NOT NULL,
        error_kind TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signal_route_retry_attempt_time
        ON signal_route_retry_attempts(attempted_at);
    """)
    import feed_category_admission
    feed_category_admission.schema(db)
    event_columns = {row[1] for row in db.execute("PRAGMA table_info(signal_events)")}
    if "published_on" not in event_columns:
        db.execute("ALTER TABLE signal_events ADD COLUMN published_on TEXT")
    route_columns = {row[1] for row in db.execute("PRAGMA table_info(signal_routes)")}
    if "failure_started_at" not in route_columns:
        db.execute("ALTER TABLE signal_routes ADD COLUMN failure_started_at TEXT")
    if "failure_attempts" not in route_columns:
        db.execute("ALTER TABLE signal_routes ADD COLUMN failure_attempts INTEGER NOT NULL DEFAULT 0")


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
    x_sources = [source for source in sources if source.get("format") == "x-api" and source.get("enabled", True)]
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
        "scope": "configured-approved-queries",
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


def x_api_usage(db, now=None, sources=SOURCES, ensure_schema=True, include_configuration=True):
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
    include_configuration = include_configuration and os.environ.get("X_FILTERED_STREAM_ENABLED", "").strip().lower() not in {"1", "true", "yes"}
    requested = include_configuration and os.environ.get("X_API_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    configured = include_configuration and bool(os.environ.get("X_BEARER_TOKEN", "").strip())
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


def reserve_x_api_request(db, source, now=None, eligible_source_ids=None, include_configuration=True):
    """Persist one billable attempt before network I/O without storing query or token."""
    if source.get("format") != "x-api":
        return None
    current = now or datetime.now(timezone.utc)
    schema(db)
    if include_configuration and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_stream_runtime'").fetchone():
        if db.execute('SELECT 1 FROM x_stream_runtime').fetchone():
            # After first activation, disabling the flag is a stop, not an
            # unmetered legacy fallback. Rollback requires an explicit review.
            raise ValueError('x-api-stream-supervisor-required')
    attempted_at = current.isoformat()
    cutoff = (current - timedelta(days=8)).isoformat()
    with db:
        # Serialize the usage check, fair-source selection and reservation even
        # when more than one worker process shares the SQLite database.
        db.execute("BEGIN IMMEDIATE")
        usage = x_api_usage(db, current, ensure_schema=False, include_configuration=include_configuration)
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
            refreshed = x_api_usage(db, current, ensure_schema=False, include_configuration=include_configuration)
            raise XApiDailyLimit(refreshed["nextAvailableAt"])
        db.execute("""DELETE FROM signal_x_request_attempts
          WHERE datetime(attempted_at) IS NULL OR datetime(attempted_at)<datetime(?)""", (cutoff,))
    return x_api_usage(db, current, include_configuration=include_configuration)


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


def prior_route_failure_measurement(previous_route, occurred_at):
    """Return only a bounded, timezone-aware active outage measurement."""
    if not previous_route or not previous_route["error"]:
        return None
    try:
        current = datetime.fromisoformat(str(occurred_at).replace("Z", "+00:00"))
        if current.tzinfo is None:
            return None
        current = current.astimezone(timezone.utc)
        started_value = previous_route["failure_started_at"]
        attempts = previous_route["failure_attempts"]
        if started_value:
            started = datetime.fromisoformat(str(started_value).replace("Z", "+00:00"))
        elif not attempts:
            # A pre-migration failure has only checked_at and failures available.
            started = datetime.fromisoformat(
                str(previous_route["checked_at"]).replace("Z", "+00:00")
            )
            attempts = previous_route["failures"]
        else:
            return None
        if started.tzinfo is None:
            return None
        started = started.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None
    if (isinstance(attempts, bool) or not isinstance(attempts, int)
            or not 1 <= attempts <= 100 or started > current
            or current - started > timedelta(days=7)):
        return None
    return started.isoformat(), attempts


def route_failure_measurement(db, source_id, previous_route, current_error, occurred_at):
    """Track a bounded outage measurement without exposing route identity publicly."""
    previous_measurement = prior_route_failure_measurement(previous_route, occurred_at)
    if current_error:
        if previous_measurement:
            started_at, prior_attempts = previous_measurement
            return started_at, min(100, prior_attempts + 1)
        return occurred_at, 1
    if not previous_route or not previous_route["error"] or not previous_measurement:
        return None, 0
    failed_at, prior_attempts = previous_measurement
    attempts = min(101, prior_attempts + 1)
    db.execute("""INSERT INTO signal_route_recoveries(
      source_id,failed_at,recovered_at,attempts,error_kind
      ) VALUES(?,?,?,?,?)""", (
        source_id, failed_at, occurred_at, attempts,
        signal_error_kind(monitor.persisted_route_error_code(previous_route["error"])),
    ))
    cutoff = (datetime.fromisoformat(occurred_at) - timedelta(days=8)).isoformat()
    db.execute("""DELETE FROM signal_route_recoveries
      WHERE datetime(recovered_at) IS NULL OR datetime(recovered_at)<datetime(?)""", (cutoff,))
    db.execute("""DELETE FROM signal_route_recoveries WHERE id NOT IN
      (SELECT id FROM signal_route_recoveries ORDER BY id DESC LIMIT 5000)""")
    return None, 0


def record_route_retry_attempt(db, source_id, previous_route, attempted_at):
    """Persist bounded retry scheduling evidence without a public route identity."""
    if not previous_route or not previous_route["error"] or not previous_route["next_check_at"]:
        return False
    try:
        eligible = datetime.fromisoformat(
            str(previous_route["next_check_at"]).replace("Z", "+00:00")
        )
        attempted = datetime.fromisoformat(str(attempted_at).replace("Z", "+00:00"))
        if eligible.tzinfo is None or attempted.tzinfo is None:
            return False
        eligible = eligible.astimezone(timezone.utc)
        attempted = attempted.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return False
    if not eligible <= attempted <= eligible + timedelta(days=7):
        return False
    db.execute("""INSERT INTO signal_route_retry_attempts(
      source_id,eligible_at,attempted_at,error_kind) VALUES(?,?,?,?)""", (
        source_id, eligible.isoformat(), attempted.isoformat(),
        signal_error_kind(previous_route["error"]),
    ))
    cutoff = (attempted - timedelta(days=8)).isoformat()
    db.execute("""DELETE FROM signal_route_retry_attempts
      WHERE datetime(attempted_at) IS NULL OR datetime(attempted_at)<datetime(?)""", (cutoff,))
    db.execute("""DELETE FROM signal_route_retry_attempts WHERE id NOT IN
      (SELECT id FROM signal_route_retry_attempts ORDER BY id DESC LIMIT 5000)""")
    return True


def _x_durable_event_ids(db):
    """Existing jobs/publications keep their source evidence, including failures."""
    tables = ('official_research_jobs', 'official_research_publications',
              'official_research_attempt_failures', 'analyst_news_publications')
    present = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    return ' UNION '.join('SELECT event_id FROM ' + table for table in tables if table in present) or 'SELECT NULL WHERE 0'


def _prune_x_evidence(db, source, checked, kind):
    """1,000 is a soft target for the two approved author-intake routes.

    Keep every recent row (including unclassified/review-required raw copy) and
    all existing job evidence. Historical omissions are measured atomically;
    these counters cannot reconstruct rows lost before this tracking existed.
    """
    table, column, order, clock = {
        'acquisition': ('signal_x_acquisition', 'acquisition_rows_omitted',
                        'julianday(last_seen_at) DESC,rowid DESC', 'last_seen_at'),
        'document': ('signal_documents', 'document_rows_omitted',
                     'julianday(last_seen_at) DESC,url', 'last_seen_at'),
        'event': ('signal_events', 'event_rows_omitted', 'id DESC', 'observed_at'),
    }[kind]
    db.execute('INSERT OR IGNORE INTO signal_x_retention(source_id,tracking_started_at) VALUES(?,?)',
               (source['id'], checked))
    predicate, params = '', [source['id'], source['id'], X_RETENTION_TARGET]
    if source['id'] in X_AUTHOR_INTAKE_SOURCE_IDS:
        cutoff = (datetime.fromisoformat(checked.replace('Z', '+00:00')) - timedelta(days=7)).isoformat()
        durable = _x_durable_event_ids(db)
        linked = (f'rowid IN ({durable})' if kind == 'event' else
                  f'EXISTS(SELECT 1 FROM signal_events e WHERE e.source_id={table}.source_id '
                  f'AND e.url={table}.url AND e.id IN ({durable}))')
        # Invalid clocks cannot justify eviction of an unassessed row either.
        predicate = f' AND julianday({clock}) IS NOT NULL AND julianday({clock})<julianday(?)'
        params.append(cutoff)
        if kind != 'document':
            predicate += ' AND (published_at IS NULL OR (julianday(published_at) IS NOT NULL AND julianday(published_at)<julianday(?)))'
            params.append(cutoff)
        predicate += ' AND NOT (' + linked + ')'
    removed = db.execute(f'DELETE FROM {table} WHERE source_id=? AND rowid NOT IN '
                         f'(SELECT rowid FROM {table} WHERE source_id=? ORDER BY {order} LIMIT ?)' + predicate,
                         params).rowcount
    if removed:
        db.execute(f'UPDATE signal_x_retention SET {column}={column}+?,last_omitted_at=? WHERE source_id=?',
                   (removed, checked, source['id']))


def x_intake_coverage(db, source, reference=None):
    """Read-only measured acquisition coverage, never downstream completion."""
    state = db.execute('SELECT body FROM signal_index_state WHERE source_id=?', (source['id'],)).fetchone()
    try:
        cursor = json.loads(state['body']) if state else {}
    except (TypeError, ValueError):
        cursor = {}
    tracked = isinstance(cursor, dict) and cursor.get('queryGeneration') == x_api.query_generation(source)
    cursor = cursor if tracked else {}
    def count(key):
        value = cursor.get(key, 0)
        return value if type(value) is int and value >= 0 else 0
    retained = db.execute('SELECT COUNT(*) FROM signal_x_acquisition WHERE source_id=?', (source['id'],)).fetchone()[0]
    metrics = None
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='signal_x_retention'").fetchone():
        metrics = db.execute('SELECT * FROM signal_x_retention WHERE source_id=?', (source['id'],)).fetchone()
    pending = bool(cursor.get('nextToken'))
    try:
        expired = x_api.window_expired(cursor, reference)
    except ValueError:
        expired = False
    awaiting = tracked and not count('pagesSaved')
    return {'retainedOnly': True, 'completeUpstreamCoverage': False,
            'assessmentCoverage': 'not-measured-by-acquisition',
            'retentionTargetRows': X_RETENTION_TARGET,
            'retentionTargetIsSoft': source['id'] in X_AUTHOR_INTAKE_SOURCE_IDS,
            'retainedAcquisitionRows': retained,
            'rowsAboveRetentionTarget': max(0, retained-X_RETENTION_TARGET),
            'trackingStartedAt': metrics['tracking_started_at'] if metrics else None,
            'historicalOmissionsBeforeTrackingUnknown': True,
            'knownOmittedAcquisitionRows': metrics['acquisition_rows_omitted'] if metrics else 0,
            'knownOmittedDocumentRows': metrics['document_rows_omitted'] if metrics else 0,
            'knownOmittedEventRows': metrics['event_rows_omitted'] if metrics else 0,
            'currentQueryTracked': tracked, 'paginationPending': pending,
            'awaitingFirstPage': awaiting, 'initialWindowExpired': expired,
            'acquisitionState': ('initial-window-expired' if expired else 'awaiting-first-page' if awaiting else
                                 'pagination-pending' if pending else 'retrieved-pages-saved') if tracked else 'not-tracked-for-current-query',
            'generationStartedAt': cursor.get('generationStartedAt'),
            'coverageStartedAt': cursor.get('coverageStartedAt'),
            'pagesSaved': count('pagesSaved'), 'postObservationsSaved': count('postsSaved'),
            'excludedAuthorRows': count('excludedAuthorRows'),
            'truncatedPostObservations': count('truncatedRows')}


def save_evidence(db, source, items, response, checked, initial=False):
    """Persist revisions inside the caller transaction without transport state.

    Behavior-preserving extraction shared by polling and the prepared stream
    adapter. Does not commit, change cursors/routes, or wake publication workers.
    """
    inserted = 0
    if source.get('format') == 'x-api':
        selected = {item['url'] for item in items}
        for post in response.get('_acquired_posts', []):
            digest = hashlib.sha256((post['title'] + '\n' + post['text']).encode()).hexdigest()
            db.execute('''INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(source_id,url,sha) DO UPDATE SET
              last_seen_at=excluded.last_seen_at,
              selected_for_processing=excluded.selected_for_processing''', (
                source['id'], post['url'], digest, post['title'], post['text'],
                post['publishedAt'], checked, checked, int(post['truncated']),
                int(post['url'] in selected),
            ))
            if post['url'] not in selected:
                # A correction/retraction need not match any news grammar.
                # Its newer source revision still invalidates previously
                # published facts at this exact source+URL. Keep the copy
                # private and do not synthesize a publication event for it.
                db.execute('''UPDATE signal_documents
                  SET sha=?,title=?,text=?,last_seen_at=?
                  WHERE source_id=? AND url=? AND sha<>?''',
                  (digest, post['title'], post['text'], checked,
                   source['id'], post['url'], digest))
        # Private evidence is committed atomically with the cursor below.
        # Never interpret selection as successful bilingual publication.
        _prune_x_evidence(db, source, checked, 'acquisition')
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
    return inserted


def _category_source_current(source, config_sha, tickers, configured_request):
    configured = next((item for item in SOURCES if item['id'] == source['id']), None)
    if (fingerprint(source, tickers) != config_sha or (configured_request and (
            configured is None or fingerprint(configured, tickers) != config_sha))):
        raise ValueError('source-identity-changed')


def save(db, source, items, response, checked, config_sha, duration, *, category=None, tickers=None):
    route = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    initial = not route or not route["initialized"] or (
        route["config_sha"] != config_sha and not (
            source.get("format") == "x-api" and
            route["config_sha"] == legacy_x_fingerprint(source, list(ALIASES))
        )
    )
    inserted = 0
    current_error = ('article-queue-overflow' if response.get('article_queue_overflow') else
                     f"article-fetch-failed:{response['article_errors']}"
                     if response.get("article_errors") else None)
    with db:
        if category is not None:
            import feed_category_admission
            db.execute('BEGIN IMMEDIATE')
            _category_source_current(category['live_source'], config_sha, tickers, category['configured_request'])
            feed_category_admission.check_request(db, source, tickers, category['request'])
        inserted = save_evidence(db, source, items, response, checked, initial)
        if category is not None:
            feed_category_admission.persist_200(db, source, tickers, category['prepared'])
        if source.get('format') == 'x-api' and response.get('cursor_update'):
            cursor = json.loads(response['cursor_update'])
            if not isinstance(cursor, dict) or cursor.get('queryGeneration') != x_api.query_generation(source):
                raise ValueError('x-api-invalid-cursor')
            for post in response.get('_acquired_posts', []):
                digest = hashlib.sha256((post['title']+'\n'+post['text']).encode()).hexdigest()
                if not db.execute('SELECT 1 FROM signal_x_acquisition WHERE source_id=? AND url=? AND sha=?',
                                  (source['id'], post['url'], digest)).fetchone():
                    raise ValueError('x-api-incomplete-evidence')
            db.execute('INSERT INTO signal_index_state VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET body=excluded.body',
                       (source['id'],response['cursor_update']))
        next_check = (datetime.fromisoformat(checked) + timedelta(
            seconds=source_interval_seconds(source, datetime.fromisoformat(checked)))).isoformat()
        failure_started_at, failure_attempts = route_failure_measurement(
            db, source["id"], route, current_error, checked,
        )
        db.execute("""INSERT INTO signal_routes(id,initialized,checked_at,succeeded_at,next_check_at,
          failures,error,etag,last_modified,config_sha,last_duration_ms,matched_items,
          failure_started_at,failure_attempts)
          VALUES(?,1,?,?,?,0,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          initialized=1,checked_at=excluded.checked_at,succeeded_at=excluded.succeeded_at,
          next_check_at=excluded.next_check_at,failures=0,error=excluded.error,etag=excluded.etag,
          last_modified=excluded.last_modified,config_sha=excluded.config_sha,
          last_duration_ms=excluded.last_duration_ms,matched_items=excluded.matched_items,
          failure_started_at=excluded.failure_started_at,
          failure_attempts=excluded.failure_attempts""", (
            source["id"], checked, checked, next_check, current_error, response.get("etag"),
            response.get("last_modified"), config_sha, duration, len(items),
            failure_started_at, failure_attempts,
        ))
        if "index_state" in response:
            db.execute("INSERT INTO signal_index_state VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET body=excluded.body",
                       (source["id"], response["index_state"]))
        record_route_transition(db, source["id"], route, current_error, checked)
        # Active author-intake and job evidence must survive queue backlogs.
        if source.get('format') == 'x-api':
            _prune_x_evidence(db, source, checked, 'document')
            _prune_x_evidence(db, source, checked, 'event')
        else:
            db.execute("""DELETE FROM signal_documents WHERE source_id=? AND url NOT IN
              (SELECT url FROM signal_documents WHERE source_id=?
               ORDER BY julianday(last_seen_at) DESC,url LIMIT 1000)""",
                       (source["id"], source["id"]))
            db.execute("""DELETE FROM signal_events WHERE source_id=? AND id NOT IN
              (SELECT id FROM signal_events WHERE source_id=? ORDER BY id DESC LIMIT 1000)""",
                       (source["id"], source["id"]))
    return inserted


def category_request_context(db, source, tickers):
    """Capture a service category attempt before its unlocked HTTP request.

    Ordinary feeds and X keep their existing acquisition/reservation path. The
    service owns this context, never the HTTP response or publisher metadata.
    """
    import feed_category_admission
    if source.get('format') != 'feed' or not feed_category_admission.required(source):
        return None
    schema(db)
    request_source, request_tickers = deepcopy(source), tuple(tickers)
    validators = feed_category_admission.conditional_validators(db, request_source, request_tickers,
        validators_for(db, request_source, request_tickers))
    request = feed_category_admission.capture_request(db, request_source, request_tickers, validators)
    return {'source': request_source, 'tickers': request_tickers,
            'config_sha': fingerprint(request_source, request_tickers),
            'configured_request': any(configured is source for configured in SOURCES),
            'validators': validators, 'request': request,
            'attempted_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
            'started': time.monotonic()}


def prepare_category_response(attempt, response):
    """Parse the retained raw response outside the service's shared DB lock."""
    import feed_category_admission
    checked = stamp()
    source = attempt['source']
    prepared = None if response.get('not_modified') else feed_category_admission.prepare(
        source, response['body'], attempt['tickers'], attempt['request']['head'], checked,
        effective_url=response.get('_effective_url', source['url']))
    return {'checked_at': checked, 'prepared': prepared}


def check(db, source, tickers, transport=None, *, category_attempt=None, category_completion=None):
    schema(db)
    row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
    attempted_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    deferred = False
    config_sha = fingerprint(source, tickers)
    # Own one immutable request configuration while transport runs unlocked.
    # Recheck the caller and configured route before any evidence is committed.
    request_source = deepcopy(source)
    configured_request = any(configured is source for configured in SOURCES)
    import feed_category_admission
    category_required = (source.get('format') == 'feed' and feed_category_admission.required(source))
    started = time.monotonic()
    category_request = None
    if category_attempt is not None:
        # The automatic service already acquired this exact request outside its
        # writer lock. Never replace its original route/head with post-fetch state.
        request_source = category_attempt['source']
        config_sha = category_attempt['config_sha']
        configured_request = category_attempt['configured_request']
        category_request = category_attempt['request']
        row = category_request['route']
        attempted_at, started = category_attempt['attempted_at'], category_attempt['started']
        category_required = True
    try:
        if category_attempt is not None:
            if tuple(tickers) != category_attempt['tickers']:
                raise ValueError('source-identity-changed')
            tickers = category_attempt['tickers']
            _category_source_current(source, config_sha, tickers, configured_request)
            validators = category_attempt['validators']
        else:
            prepare_x_query_window(db, source)
            require_x_polling_storage(db, source)
            validators = validators_for(db, request_source, tickers)
            if category_required:
                validators = feed_category_admission.conditional_validators(db, request_source, tickers, validators)
                category_request = feed_category_admission.capture_request(db, request_source, tickers, validators)
        response = transport(request_source, validators) if transport else acquire(request_source, validators, tickers)
        checked = category_completion['checked_at'] if category_completion is not None else stamp()
        if category_required:
            _category_source_current(source, config_sha, tickers, configured_request)
        if response.get("not_modified"):
            if not validators.get("initialized"):
                raise ValueError("signal-304-without-baseline")
            with db:
                if category_required:
                    db.execute('BEGIN IMMEDIATE')
                    _category_source_current(source, config_sha, tickers, configured_request)
                    feed_category_admission.persist_304(db, request_source, tickers, category_request, response, checked)
                failure_started_at, failure_attempts = route_failure_measurement(
                    db, source["id"], row, None, checked,
                )
                db.execute("""UPDATE signal_routes SET checked_at=?,succeeded_at=?,next_check_at=?,
                  failures=0,error=NULL,last_duration_ms=?,failure_started_at=?,
                  failure_attempts=? WHERE id=?""", (
                    checked, checked, (datetime.fromisoformat(checked) + timedelta(
                        seconds=source_interval_seconds(source, datetime.fromisoformat(checked)))).isoformat(),
                    round((time.monotonic() - started) * 1000), failure_started_at,
                    failure_attempts, source["id"],
                ))
                record_route_transition(db, source["id"], row, None, checked)
            return {"source": source["id"], "status": "unchanged", "events": 0}
        category = None
        if category_required:
            prepared = (category_completion['prepared'] if category_completion is not None else
                        feed_category_admission.prepare(request_source, response['body'], tickers,
                            category_request['head'], checked,
                            effective_url=response.get('_effective_url', request_source['url'])))
            items = prepared['items']
            category = {'request': category_request, 'prepared': prepared,
                        'live_source': source, 'configured_request': configured_request}
        else:
            items = response["_items"] if "_items" in response else parse(source, response["body"], tickers)
        count = save(db, request_source, items, response, checked, config_sha,
                     round((time.monotonic() - started) * 1000), category=category, tickers=tickers)
        return {"source": source["id"], "status": "partial" if response.get("article_errors") or response.get('article_queue_overflow') else "ok",
                "matchedItems": len(items), "events": count, "pendingArticles": response.get("article_pending", 0),
                "unadmittedArticles": response.get('article_queue_overflow', 0),
                **({"acquiredPosts": len(response['_acquired_posts']),
                    "unselectedPosts": sum(post['url'] not in {item['url'] for item in items}
                                           for post in response['_acquired_posts'])}
                   if '_acquired_posts' in response else {})}
    except XApiPacing as exc:
        # No network request was made. Preserve freshness, existing failures and
        # outage measurements; only a real fetch can establish recovery.
        deferred = True
        checked = stamp()
        retry_at = exc.retry_at or (datetime.fromisoformat(checked) + timedelta(seconds=30)).isoformat()
        with db:
            db.execute("""INSERT INTO signal_routes(id,next_check_at) VALUES(?,?)
              ON CONFLICT(id) DO UPDATE SET next_check_at=excluded.next_check_at""",
              (source["id"], retry_at))
            db.execute("""INSERT INTO signal_route_deferrals(source_id,deferred_at,retry_at,reason)
              VALUES(?,?,?,?)""", (source["id"], checked, retry_at, "x-api-paced"))
            cutoff = (datetime.fromisoformat(checked) - timedelta(days=8)).isoformat()
            db.execute("DELETE FROM signal_route_deferrals WHERE deferred_at<?", (cutoff,))
            db.execute("""DELETE FROM signal_route_deferrals WHERE id NOT IN
              (SELECT id FROM signal_route_deferrals ORDER BY id DESC LIMIT 100000)""")
        return {"source": source["id"], "status": "deferred", "reason": "x-api-paced",
                "nextCheckAt": retry_at, "events": 0}
    except Exception as exc:
        if category_required and str(exc) in {'source-identity-changed', 'superseded-feed-response', 'older-feed-response'}:
            # A slower response cannot replace a newer route's success/error,
            # validators or category decision. Retry only on its normal schedule.
            deferred = True
            return {'source': source['id'], 'status': 'deferred', 'reason': str(exc), 'events': 0}
        checked = stamp()
        failures = min(20, (row["failures"] if row else 0) + 1)
        error = monitor.source_error_code(exc)
        if isinstance(exc, ET.ParseError):
            error = "invalid-feed-xml"
        retry_hint = monitor.retry_after_seconds(exc, datetime.fromisoformat(checked))
        delay = max(
            min(3600, max(30, source["intervalSeconds"]) * 2 ** failures),
            monitor.source_retry_seconds(error, failures, retry_hint),
        )
        next_check = (datetime.fromisoformat(checked) + timedelta(seconds=delay)).isoformat()
        if isinstance(exc, XApiDailyLimit) and exc.retry_at:
            next_check = exc.retry_at
        with db:
            if category_required and category_request is not None:
                db.execute('BEGIN IMMEDIATE')
                try:
                    _category_source_current(source, config_sha, tickers, configured_request)
                    feed_category_admission.check_request(db, request_source, tickers, category_request)
                except ValueError as stale:
                    deferred = True
                    return {'source': source['id'], 'status': 'deferred', 'reason': str(stale), 'events': 0}
            failure_started_at, failure_attempts = route_failure_measurement(
                db, source["id"], row, error, checked,
            )
            db.execute("""INSERT INTO signal_routes(
              id,checked_at,next_check_at,failures,error,failure_started_at,failure_attempts)
              VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,
              next_check_at=excluded.next_check_at,failures=excluded.failures,error=excluded.error,
              failure_started_at=excluded.failure_started_at,
              failure_attempts=excluded.failure_attempts""", (
                source["id"], checked, next_check, failures, error,
                failure_started_at, failure_attempts,
            ))
            record_route_transition(db, source["id"], row, error, checked)
        return {"source": source["id"], "status": "error", "error": error, "events": 0}
    finally:
        if not deferred:
            with db:
                record_route_retry_attempt(db, source["id"], row, attempted_at)


def x_content_kind(source, title):
    """Classify an X item without changing its review/publication status."""
    if source.get("format") != "x-api":
        return None
    if source.get("officialUpdates") is True:
        return "official-update"
    if source.get('buybackUpdates') is True and x_api.buyback_news.CUE.search(title):
        return 'share-buyback'
    if x_api.RATING_PATTERN.search(title):
        return "analyst-rating"
    if x_api.TARGET_PATTERN.search(title):
        return "price-target"
    if (x_api.EARNINGS_PATTERN.search(title) and
            not x_api.EARNINGS_PREVIEW_PATTERN.search(title)):
        return "earnings"
    if source.get('financingUpdates') is True and x_api.FINANCING_PATTERN.search(title):
        return "corporate-financing"
    return "publisher-update"


def queue(db, sources=SOURCES, limit=30, ticker=None, view="all"):
    schema(db)
    if view not in {"all", "new", "changed", "baseline", "targets", "ratings"} or (
            ticker and ticker not in ALIASES and ticker not in X_EXTRA_TICKERS):
        raise ValueError("invalid-signal-filter")
    configured = {source["id"]: source for source in sources}
    items = []
    counts = {"all": 0, "new": 0, "changed": 0, "baseline": 0, "targets": 0, "ratings": 0}
    for row in db.execute("SELECT * FROM signal_events ORDER BY observed_at DESC,id DESC"):
        if row["source_id"] not in configured:
            continue
        tickers = json.loads(row["tickers_json"])
        if ticker and ticker not in tickers:
            continue
        counts["all"] += 1
        counts[row["event_kind"]] += 1
        source = configured[row["source_id"]]
        content_kind = x_content_kind(source, row["title"])
        is_target = (row["source_id"].startswith("x-") and
                     row["event_kind"] == "new" and x_api.TARGET_PATTERN.search(row["title"]))
        if is_target:
            counts["targets"] += 1
        is_rating = bool(row["source_id"].startswith("x-") and
                         x_api.RATING_PATTERN.search(row["title"]))
        if is_rating:
            counts["ratings"] += 1
        if (view == "targets" and not is_target) or (view == "ratings" and not is_rating) or (view not in {"all", "targets", "ratings"} and
            row["event_kind"] != view) or len(items) >= max(1, min(50, limit)):
            continue
        items.append({"id": row["id"], "source": source["name"], "sourceKind": source["kind"],
                      "reuse": source["reuse"], "url": safe_url(row["url"], source),
                      "title": row["title"], "tickers": tickers,
                      "matches": json.loads(row["matches_json"]), "eventKind": row["event_kind"],
                      "contentKind": content_kind,
                      "publishedAt": row["published_at"], "publishedOn": row["published_on"],
                      "observedAt": row["observed_at"],
                      "excerpt": row["excerpt"], "diff": row["diff"], "truncated": bool(row["truncated"]),
                      "status": "unreviewed", "sha256": row["sha"]})
    routes = []
    for source in sources:
        row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
        state_row = db.execute("SELECT body FROM signal_index_state WHERE source_id=?", (source["id"],)).fetchone()
        children = {}
        if state_row and len(state_row["body"]) <= 2_000_000:
            try:
                state = json.loads(state_row["body"])
                raw_children = state.get("children", {}) if isinstance(state, dict) else {}
            except (TypeError, ValueError):
                raw_children = {}
            if isinstance(raw_children, dict):
                for index, (url, child) in enumerate(raw_children.items()):
                    if index >= 1000:
                        break
                    if not isinstance(url, str) or not isinstance(child, dict):
                        continue
                    try:
                        url = safe_url(url, source)
                    except ValueError:
                        continue
                    children[url] = child
        article_errors = []
        for url, child in children.items():
            error = monitor.persisted_source_error_code(child.get("error"))
            if not error:
                continue
            try:
                url = safe_url(url, source)
            except ValueError:
                continue
            article_errors.append({"url": url, "error": error,
                                   "nextCheckAt": child.get("next_check"),
                                   "checkedAt": child.get("checked")})
        routes.append({"pendingArticles": sum(not c.get("succeeded") for c in children.values()),
                       "articleErrors": article_errors[:20],
                       "id": source["id"], "name": source["name"], "kind": source["kind"],
                       "intervalSeconds": source["intervalSeconds"],
                       "checkedAt": row["checked_at"] if row else None,
                       "succeededAt": row["succeeded_at"] if row else None,
                       "nextCheckAt": row["next_check_at"] if row else None,
                       "error": monitor.persisted_route_error_code(row["error"]) if row else None,
                       "matchedItems": row["matched_items"] if row else 0,
                       **({'acquisitionCoverage': x_intake_coverage(db, source)}
                          if source.get('format') == 'x-api' else {})})
    return {"items": items, "counts": counts, "routes": routes, "xApiUsage": x_api_usage(db, sources=sources), "view": view,
            "ticker": ticker, "generatedAt": stamp(), "publicationEnabled": False}


PRICE_TARGET_TEXT = re.compile(
    r"(?:price target|target price|PT)\s+(?:(?:raised|lowered|cut|hiked|increased|reduced)\s+)?to\s*\$(\d+(?:\.\d+)?)\s+from\s*\$(\d+(?:\.\d+)?)", re.I,
)
PRICE_TARGET_REVERSED = re.compile(
    r"(?:price target|target price|PT)\s+(?:(?:raised|lowered|cut|hiked|increased|reduced)\s+)?from\s*\$(\d+(?:\.\d+)?)\s+to\s*\$(\d+(?:\.\d+)?)", re.I,
)
PRICE_TARGET_DIRECTIONAL = re.compile(
    r"(?:price target|target price|PT)\s+(?:of|at)\s*\$(\d+(?:\.\d+)?)\s*,?\s*(down|up)\s+from\s*\$(\d+(?:\.\d+)?)", re.I,
)
PRICE_TARGET_NAMED_SUBJECT = re.compile(
    r"\b(?:raised|lowered|cut|hiked|increased|reduced)\s+"
    r"(?:(?:the\s+firm['’]s|its)\s+)?(?:price target|target price|PT)\s+on\s+"
    r"(?P<subject>[A-Za-z][A-Za-z0-9 .&'’()-]{0,79}?)\s+"
    r"(?:\$(?P<cashtag>[A-Z]{1,5}(?:[.-][A-Z])?)\s+)?to\s*"
    r"\$(?P<new>\d+(?:\.\d+)?)\s+from\s*\$(?P<old>\d+(?:\.\d+)?)", re.I,
)
PRICE_TARGET_SUBJECT = re.compile(
    r"^[^$\n]{0,100}\$([A-Z]{1,5}(?:[.-][A-Z])?)\s+"
    r"(?:downgraded|upgraded|initiated|reiterated|price target|PT)\b", re.I,
)
PRICE_TARGET_FIRM = re.compile(
    r"(?:at|by) (BofA|Bank of America|BNP Paribas|Citi(?:group)?|Citizens|KeyBanc|Stifel|UBS|J\.?P\.?\s?Morgan|Seaport Research|Morgan Stanley|Goldman Sachs|Barclays|Wells Fargo|Deutsche Bank|Jefferies|Mizuho|Baird|Piper Sandler|RBC Capital|RBC|Oppenheimer|Needham|Cantor Fitzgerald|Cantor|Wedbush|Truist|TD Cowen|Raymond James|Rosenblatt|Evercore ISI|Evercore|Bernstein|B. Riley|DA Davidson|Loop Capital|Susquehanna|BMO Capital|BMO|BTIG|Monness Crespi|HSBC|Nomura|Macquarie|Guggenheim|Northland|Craig-Hallum|William Blair|Wolfe Research|Wolfe|Canaccord Genuity|Canaccord|Rothschild & Co Redburn|Rothschild Redburn|Redburn|Melius Research|Melius|Arete Research|Arete|New Street Research|New Street|Roth Capital|Roth MKM|Roth|H\.?\s?C\.? Wainwright|Benchmark|Scotiabank|Lake Street|Ladenburg Thalmann|Maxim Group|Daiwa|KGI Securities|Erste Group|Morningstar|Argus Research|Argus|CFRA|Stephens|Telsey Advisory|Telsey|Tigress Financial|Seaport|Goldman|Itau BBA|Westpark Capital)\b", re.I,
)


PRICE_TARGET_EXPLICIT_PREFIX = re.compile(
    r"^\s*(B\. Riley)\s+Downgrades\s+\$(?P<subject>[A-Z]{1,5}(?:[.-][A-Z])?)"
    r"\s+to\s+Neutral\s+from\s+Buy\s*,?\s+Cuts\s+"
    r"(?P<target>PT\s+to\s*\$\d+(?:\.\d+)?\s+from\s*\$\d+(?:\.\d+)?)", re.I,
)


# These opening brokers must be the explicit grammatical actor of the target,
# never merely a name somewhere in the post. The rating form is deliberately
# limited to the observed upgrade construction; the separately stated target
# verb still determines price-target direction.
PRICE_TARGET_NAMED_PREFIX = re.compile(
    r"^\s*" + PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ") +
    r"\s+(?P<target>" + PRICE_TARGET_NAMED_SUBJECT.pattern + r")", re.I,
)
PRICE_TARGET_UPGRADE_PREFIX = re.compile(
    r"^\s*" + PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ") +
    r"\s+upgraded\s+(?P<subject>[A-Za-z][A-Za-z0-9 .&'’()-]{0,79}?)"
    r"\s+to\s+Buy\s+from\s+Neutral\s+and\s+"
    r"(?P<direction>raised|lowered|cut|hiked|increased|reduced)\s+its\s+"
    r"(?P<target>(?:price target|target price|PT)\s+to\s*"
    r"\$\d+(?:\.\d+)?\s+from\s*\$\d+(?:\.\d+)?)", re.I,
)



# Opening-actor form, e.g. "Morgan Stanley raises $NVDA price target to $210
# from $200" or "$MSTR: TD Cowen cuts PT to $500 from $600". It is rewritten
# into the existing "by <firm>: $T PT raised to ... from ..." grammar so every
# later gate (firm count, subject, direction, values) still applies unchanged.
_TARGET_NUMBER = r"\$(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
_TARGET_VERBS = {"raises": "raised", "lifts": "raised", "boosts": "raised", "hikes": "raised",
                 "increases": "raised", "lowers": "lowered", "cuts": "lowered", "trims": "lowered",
                 "reduces": "lowered"}
_TARGET_LABEL = r"(?:price target|target price|PT)"
_TARGET_ACTOR = (r"(?P<firm>" + PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ")[1:-3] + r")\b"
                 r"(?:\s+analyst(?:\s+[A-Z][A-Za-z.'’-]*){1,3})?\s+"
                 r"(?P<verb>" + "|".join(_TARGET_VERBS) + r")\s+")
_TARGET_ACTOR_NAMES = r"\b" + PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ")
PRICE_TARGET_ACTOR_FIRST = re.compile(
    r"^\s*" + _TARGET_ACTOR + r"(?:(?:its|the)\s+)?"
    r"(?:(?P<pre>" + _TARGET_LABEL + r")\s+on\s+)?(?:[A-Za-z][A-Za-z0-9 .&'’()-]{0,60}?\s+)?"
    r"\$(?P<ticker>[A-Z]{1,5}(?:[.-][A-Z])?)(?:['’]s)?\s+"
    r"(?:(?P<post>" + _TARGET_LABEL + r")\s+)?to\s*" + _TARGET_NUMBER + r"\s+from\s*" + _TARGET_NUMBER,
    re.I,
)
PRICE_TARGET_TICKER_ACTOR = re.compile(
    r"^\s*\$(?P<ticker>[A-Z]{1,5}(?:[.-][A-Z])?)\s*[:|–—-]?\s*" + _TARGET_ACTOR +
    r"(?:(?:its|the)\s+)?(?P<post>" + _TARGET_LABEL + r")\s+to\s*" + _TARGET_NUMBER +
    r"\s+from\s*" + _TARGET_NUMBER, re.I,
)

# Rating line followed by the target, e.g. "$MELI | Susquehanna maintains
# Positive on MercadoLibre, cuts PT to $2400 from $2500".
PRICE_TARGET_TICKER_RATING = re.compile(
    r"^\s*\$(?P<ticker>[A-Z]{1,5}(?:[.-][A-Z])?)\s*[:|–—-]?\s*"
    r"(?P<firm>" + PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ")[1:-3] + r")\b"
    r"(?:\s+analyst(?:\s+[A-Z][A-Za-z.'’-]*){1,3})?\s+"
    r"(?:maintains|reiterates|keeps|upgrades|downgrades|initiates|resumes)\s+[^,;$\n]{1,80}?,\s*(?:and\s+)?"
    r"(?P<verb>" + "|".join(_TARGET_VERBS) + r")\s+(?:(?:its|the)\s+)?(?P<post>" + _TARGET_LABEL + r")\s+to\s*" +
    _TARGET_NUMBER + r"\s+from\s*" + _TARGET_NUMBER, re.I,
)
# General cashtag-led form, e.g. "$BE | UBS raises Bloom Energy Corporation
# price target, raised to $350 from $325" or "... raises PT on <company> from
# $325 to $350". The span between verb and figures must name the target and
# may not hold another figure or cashtag; a second verb must agree.
PRICE_TARGET_TICKER_GENERIC = re.compile(
    r"^\s*\$(?P<ticker>[A-Z]{1,5}(?:[.-][A-Z])?)\s*[:|–—-]?\s*" + _TARGET_ACTOR +
    r"(?P<mid>[^$\n;]{0,120}?)\s*,?\s*"
    r"(?:(?:and\s+)?(?P<verb2>raised|lifted|boosted|hiked|increased|lowered|cut|trimmed|reduced|raises|lifts|boosts|hikes|increases|lowers|cuts|trims|reduces)\s+(?:it\s+|(?:its|the)\s+)?(?P<label2>" + _TARGET_LABEL + r"\s+)?)?"
    r"(?:to\s*" + _TARGET_NUMBER.replace("(", "(?P<new>", 1) + r"\s+from\s*" + _TARGET_NUMBER.replace("(", "(?P<old>", 1) +
    r"|from\s*" + _TARGET_NUMBER.replace("(", "(?P<old2>", 1) + r"\s+to\s*" + _TARGET_NUMBER.replace("(", "(?P<new2>", 1) + r")",
    re.I,
)
PRICE_TARGET_UNIVERSES = {"large-cap": frozenset(json.loads(
    (Path(__file__).with_name("price_target_universe.json")).read_text())["tickers"])}


def actor_first_target(text):
    """Rewrite one opening broker-actor target sentence; otherwise unchanged."""
    if not isinstance(text, str):
        return text
    stripped = re.sub(r"^[^A-Za-z0-9$]+", "", text)
    for pattern in (PRICE_TARGET_ACTOR_FIRST, PRICE_TARGET_TICKER_ACTOR, PRICE_TARGET_TICKER_RATING,
                    PRICE_TARGET_TICKER_GENERIC):
        match = pattern.match(stripped)
        if not match:
            continue
        groups = match.groupdict()
        if pattern is PRICE_TARGET_ACTOR_FIRST and bool(groups["pre"]) == bool(groups["post"]):
            return text
        # A second named broker anywhere else leaves the actor ambiguous.
        if re.search(_TARGET_ACTOR_NAMES, stripped[match.end():], re.I):
            return text
        if pattern is PRICE_TARGET_TICKER_GENERIC:
            mid = groups["mid"] or ""
            if (not (re.search(_TARGET_LABEL, mid, re.I) or groups["label2"]) or re.search(r"\d", mid)
                    or re.search(_TARGET_ACTOR_NAMES, mid, re.I)):
                return text
            verb = _TARGET_VERBS[groups["verb"].casefold()]
            second = (groups["verb2"] or "").casefold()
            if second and (verb == "raised") != bool(re.match(r"rais|lift|boost|hik|increas", second)):
                return text
            new, old = ((groups["new"] or groups["new2"]).replace(",", ""),
                        (groups["old"] or groups["old2"]).replace(",", ""))
            return (f"By {groups['firm']}: ${groups['ticker'].upper()} PT {verb} to ${new} from ${old}"
                    + stripped[match.end():])
        new, old = (value.replace(",", "") for value in match.groups()[-2:])
        verb = _TARGET_VERBS[groups["verb"].casefold()]
        ticker = groups["ticker"].upper()
        return (f"By {groups['firm']}: ${ticker} PT {verb} to ${new} from ${old}"
                + stripped[match.end():])
    return text

# Target-only identity evidence; this does not expand the research-company
# roster, acquisition queries or request budgets.
PRICE_TARGET_COMPANY_ALIASES = {"AMZN": ("Amazon",)}
PRICE_TARGET_EXPLICIT_COMPANY_ALIASES = {
    "OXY": ("Occidental",), "HOOD": ("Robinhood",), "META": ("Meta Platforms",),
}
PRICE_TARGET_ECHO_FIRM = re.compile(
    PRICE_TARGET_FIRM.pattern.removeprefix(r"(?:at|by) ") +
    r"(?:\s+analyst(?:\s+[A-Za-z][A-Za-z.'’-]*){1,6})?\s*$", re.I,
)


def target_company_names(ticker, *, explicit_actor=False):
    names = [ticker, *ALIASES.get(ticker, []), *PRICE_TARGET_COMPANY_ALIASES.get(ticker, ())]
    # New company aliases are identity evidence only where the grammatical
    # broker actor is explicitly verified, never in legacy at/by fallback.
    if explicit_actor:
        names.extend(PRICE_TARGET_EXPLICIT_COMPANY_ALIASES.get(ticker, ()))
    return {" ".join(name.split()).casefold() for name in names}


def price_target_echo_subject(matches, text, tickers, firm):
    """Recognize a strict target headline echoed by its named-company body.

    Equal numbers alone are insufficient: every body echo must identify the
    same company and broker, and no competing cashtag may precede its end.
    """
    heading = matches[0][0]
    if (heading.re is PRICE_TARGET_NAMED_SUBJECT or
            any(match.re is not PRICE_TARGET_NAMED_SUBJECT for match, _, _ in matches[1:])):
        return None, "ambiguous-target-actions"
    subject = PRICE_TARGET_SUBJECT.search(text)
    if not subject or subject[1].upper() not in tickers:
        return None, "ambiguous-subject"
    ticker = subject[1].upper()
    before_actions = set(re.findall(r'\$([A-Z]{1,5}(?:[.-][A-Z])?)\b', text[:matches[-1][0].end()]))
    if before_actions != {ticker}:
        return None, "ambiguous-subject"
    heading_firm = PRICE_TARGET_FIRM.search(text)
    if not heading_firm or not heading.end() <= heading_firm.start() < matches[1][0].start():
        return None, "ambiguous-firms"
    for match, _, _ in matches[1:]:
        name = " ".join(match.group("subject").split()).casefold()
        if (name not in target_company_names(ticker, explicit_actor=True) or
                (match.group("cashtag") and match.group("cashtag").upper() != ticker)):
            return None, "ambiguous-subject"
        actor = PRICE_TARGET_ECHO_FIRM.search(text[max(heading.end(), match.start() - 200):match.start()])
        if not actor or canonical_target_firm(actor[1]).casefold() != canonical_target_firm(firm[1]).casefold():
            return None, "ambiguous-firms"
    return ticker, None


PRICE_TARGET_SOURCE_IDS = ("x-tipranks", "x-thefly", "x-wallstengine", "x-aistocksavvy")
PRICE_TARGET_SOURCE_MARKS = ",".join("?" for _ in PRICE_TARGET_SOURCE_IDS)
PRICE_TARGET_LABEL = re.compile(r"\b(?:price[ -]?target|target price|PT)\b", re.I)
PRICE_TARGET_EXTRA_ACTION = re.compile(
    r"\btargets?\b[^.!?\n]{0,100}\$\s*\d"
    r"|\b(?:raised|lowered|cut|hiked|increased|reduced)\b[^.!?\n]{0,60}\btargets?\b", re.I,
)
PRICE_TARGET_REVOCATION = re.compile(
    r"\b(?:correction|retraction)\s*:"
    r"|\b(?:report|claim|post|tweet|headline|(?:price\s+)?target)\b"
    r"[^.!?\n]{0,80}\b(?:retracted|withdrawn|rescinded|cancelled|canceled|corrected|incorrect|erroneous|false)\b"
    r"|\b(?:retracted|withdrew|withdrawn|rescinded|cancelled|canceled|corrected)\b"
    r"[^.!?\n]{0,80}\b(?:report|claim|post|tweet|headline|(?:price\s+)?target)\b", re.I,
)


def price_target_rows(db, since, now, time_column="published_at"):
    """Read the whole relevant time window, not the newest mixed-event page.

    This reader does not initialize schema, so private comparison reports can
    use it on a read-only database. Values, including absolute-time bounds,
    remain parameters; the only selectable columns are fixed here.
    """
    if time_column not in {"published_at", "observed_at"}:
        raise ValueError("invalid-target-window")
    return db.execute(f"""SELECT e.id,e.source_id,e.url,e.sha,e.title,e.tickers_json,
                         e.event_kind,e.published_at,e.observed_at,e.truncated,
                         d.sha AS current_document_sha,
                         CASE WHEN d.sha=e.sha THEN d.text END AS document_text
                         FROM signal_events e LEFT JOIN signal_documents d
                         ON d.source_id=e.source_id AND d.url=e.url
                         WHERE e.source_id IN ({PRICE_TARGET_SOURCE_MARKS})
                         AND julianday(e.{time_column}) BETWEEN julianday(?) AND julianday(?)
                         ORDER BY julianday(e.observed_at) DESC,e.id DESC""",
                      (*PRICE_TARGET_SOURCE_IDS, since.isoformat(), now.isoformat()))


def price_target_observation(row, source, now):
    """Apply publication gates once and return a fixed, body-free reason code.

    The same assessment powers the public feed and private gap diagnostics;
    mentioning a price target is never reported as successful publication.
    """
    if not source:
        return None, "source-not-approved"
    if row["event_kind"] not in {"new", "baseline", "changed"}:
        return None, "event-kind-not-published"
    if row["current_document_sha"] and row["current_document_sha"] != row["sha"]:
        return None, "superseded-revision"
    if row["event_kind"] == "changed" and not row["document_text"]:
        return None, "revision-evidence-missing"
    text = row["document_text"] or row["title"]
    # Some publishers style words and figures with Unicode bold letters
    # ("𝗺𝗮𝗶𝗻𝘁𝗮𝗶𝗻𝘀", "$𝟮𝟰𝟬𝟬"); compare their plain forms.
    text = actor_first_target(unicodedata.normalize("NFKC", text) if isinstance(text, str) else text)
    if not isinstance(text, str) or not PRICE_TARGET_LABEL.search(text):
        return None, "not-target"
    if row["truncated"]:
        return None, "truncated-evidence"
    try:
        published = datetime.fromisoformat(row["published_at"].replace("Z", "+00:00"))
        observed = datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError, OverflowError):
        return None, "invalid-timestamp"
    if published.tzinfo is None or observed.tzinfo is None:
        return None, "invalid-timestamp"
    if observed > now:
        return None, "future-observation"
    if not timedelta(0) <= now - published <= timedelta(days=7):
        return None, "outside-publication-window"
    if observed < published:
        return None, "observation-before-publication"
    try:
        url = safe_url(row["url"], source)
    except (ValueError, TypeError, AttributeError):
        return None, "source-url-not-approved"
    if re.match(r'^/theflynews/status/', urlsplit(url).path, re.I):
        return None, "source-url-not-approved"
    try:
        tickers = json.loads(row["tickers_json"])
    except (ValueError, TypeError):
        return None, "invalid-tickers"
    if (not isinstance(tickers, list) or not tickers or
            any(not isinstance(ticker, str) or not re.fullmatch(r"[A-Z]{1,5}(?:[.-][A-Z])?", ticker)
                for ticker in tickers)):
        return None, "invalid-tickers"

    normalized = text.replace(",", "")
    matches = ([(match, float(match.group(2)), float(match.group(1)))
                for match in PRICE_TARGET_TEXT.finditer(normalized)] +
               [(match, float(match.group(1)), float(match.group(2)))
                for match in PRICE_TARGET_REVERSED.finditer(normalized)] +
               [(match, float(match.group(3)), float(match.group(1)))
                for match in PRICE_TARGET_DIRECTIONAL.finditer(normalized)] +
               [(match, float(match.group("old")), float(match.group("new")))
                for match in PRICE_TARGET_NAMED_SUBJECT.finditer(normalized)])
    if not matches:
        return None, "unsupported-target-syntax"
    matches.sort(key=lambda record: record[0].start())
    if len({(old, new) for _, old, new in matches}) != 1:
        return None, "ambiguous-target-actions"
    match, old, new = matches[0]
    prefix = PRICE_TARGET_EXPLICIT_PREFIX.search(normalized)
    named_prefix = (PRICE_TARGET_NAMED_PREFIX.search(normalized) or
                    PRICE_TARGET_UPGRADE_PREFIX.search(normalized))
    # Matching the current document hash is necessary, but a current revision
    # may quote its old target and then retract it. Fail closed for explicit
    # report/target revocations in these newly supported opening grammars.
    if named_prefix and PRICE_TARGET_REVOCATION.search(text):
        return None, "retracted-target-evidence"
    firms = list(PRICE_TARGET_FIRM.finditer(text))
    if prefix:
        # Only the observed, fully explicit broker/action/cashtag construction
        # supplies an opening firm. Do not infer a firm from a free noun mention.
        firms.insert(0, prefix)
    elif named_prefix:
        firms.insert(0, named_prefix)
    if not firms:
        return None, "firm-not-recognized"
    if len(firms) != 1:
        return None, "ambiguous-firms"
    firm = firms[0]
    # An inline cashtag is a newly supported grammar, not permission to fall
    # back to an unrelated "at/by" firm elsewhere. Require its anchored actor
    # or the separately verified headline/body echo association below.
    if (len(matches) == 1 and match.re is PRICE_TARGET_NAMED_SUBJECT and
            match.group("cashtag") and not named_prefix):
        return None, "ambiguous-firms"
    for action_match, _, _ in matches:
        action = action_match.group(0)
        if ((re.search(r'raised|hiked|increased|\bup\b', action, re.I) and new <= old)
                or (re.search(r'lowered|cut|reduced|\bdown\b', action, re.I) and new >= old)):
            return None, "inconsistent-direction"
    if prefix and new >= old:  # This exact prefix explicitly says "Cuts PT".
        return None, "inconsistent-direction"
    if named_prefix and named_prefix.re is PRICE_TARGET_UPGRADE_PREFIX:
        direction = named_prefix.group("direction").casefold()
        if ((direction in {"raised", "hiked", "increased"} and new <= old) or
                (direction in {"lowered", "cut", "reduced"} and new >= old)):
            return None, "inconsistent-direction"
    if not 0 < old <= 100000 or not 0 < new <= 100000 or old == new:
        return None, "invalid-target-values"
    if prefix:
        if len(matches) != 1 or match.span() != prefix.span("target"):
            return None, "ambiguous-target-actions"
        ticker = prefix.group("subject").upper()
        before_target = set(re.findall(r'\$([A-Z]{1,5}(?:[.-][A-Z])?)\b', normalized[:match.end()]))
        if ticker not in tickers or before_target != {ticker}:
            return None, "ambiguous-subject"
        tickers = [ticker]
    elif named_prefix:
        # A new opening-firm grammar publishes a single complete action only.
        # Also reject unsupported extra target clauses instead of silently
        # discarding them just because the ordinary parsers cannot read them.
        if (len(matches) != 1 or match.span() != named_prefix.span("target") or
                len(PRICE_TARGET_LABEL.findall(normalized)) != 1 or
                PRICE_TARGET_EXTRA_ACTION.search(normalized[named_prefix.end():])):
            return None, "ambiguous-target-actions"
        name = " ".join(named_prefix.group("subject").split()).casefold()
        subjects = {ticker for ticker in tickers
                    if name in target_company_names(ticker, explicit_actor=True)}
        if len(subjects) != 1:
            return None, "ambiguous-subject"
        ticker = subjects.pop()
        cashtag = (named_prefix.group("cashtag")
                   if named_prefix.re is PRICE_TARGET_NAMED_PREFIX else None)
        before_target = set(re.findall(r'\$([A-Z]{1,5}(?:[.-][A-Z])?)\b',
                                       normalized[:match.end()]))
        if (cashtag and cashtag.upper() != ticker) or before_target - {ticker}:
            return None, "ambiguous-subject"
        # With no inline cashtag (e.g. Occidental followed by $OXY in the
        # next paragraph), require one unambiguous retained ticker identity.
        if not cashtag and set(tickers) != {ticker}:
            return None, "ambiguous-subject"
        tickers = [ticker]
    elif len(matches) > 1:
        ticker, reason = price_target_echo_subject(matches, normalized, tickers, firm)
        if reason:
            return None, reason
        tickers = [ticker]
    elif len(tickers) > 1:
        # The opening analyst-action headline identifies the subject. Other
        # cashtags may occur only after the complete, firmly attributed target.
        subject = PRICE_TARGET_SUBJECT.search(normalized)
        before_target = set(re.findall(r'\$([A-Z]{1,5}(?:[.-][A-Z])?)\b', normalized[:match.end()]))
        if (not subject or subject.group(1).upper() not in tickers or
                before_target != {subject.group(1).upper()} or
                not PRICE_TARGET_FIRM.search(normalized[:match.start()])):
            return None, "ambiguous-subject"
        tickers = [subject.group(1).upper()]
    if match.re is PRICE_TARGET_NAMED_SUBJECT:
        # The company between "on" and "to" is an explicit attribution, not
        # filler to skip. Bind it to the resolved subject using only existing
        # exact aliases; a different company or an unknown name stays private.
        named_subject = " ".join(match.group("subject").split()).casefold()
        if (named_subject not in target_company_names(tickers[0], explicit_actor=bool(named_prefix)) or
                (match.group("cashtag") and match.group("cashtag").upper() != tickers[0])):
            return None, "ambiguous-subject"
    universe = source.get("targetUniverse")
    if universe and tickers[0] not in PRICE_TARGET_UNIVERSES.get(universe, ()):
        return None, "outside-target-universe"
    return {"id": row["id"], "ticker": tickers[0], "firm": firm.group(1),
            "previous": old, "latest": new, "source": source["name"], "url": url,
            "publishedAt": published.isoformat(), "observedAt": observed.isoformat()}, "eligible"


PRICE_TARGET_FIRM_ALIASES = {
    "bofa": "BofA", "bankofamerica": "BofA",
    "citi": "Citi", "citigroup": "Citi",
    "jpmorgan": "JPMorgan",
    "rbc": "RBC", "rbccapital": "RBC",
    "evercore": "Evercore", "evercoreisi": "Evercore",
    "cantor": "Cantor Fitzgerald", "cantorfitzgerald": "Cantor Fitzgerald",
    "bmo": "BMO", "bmocapital": "BMO",
    "goldman": "Goldman Sachs", "goldmansachs": "Goldman Sachs",
    "seaport": "Seaport Research", "seaportresearch": "Seaport Research",
    "wolfe": "Wolfe Research", "wolferesearch": "Wolfe Research",
    "canaccord": "Canaccord Genuity", "canaccordgenuity": "Canaccord Genuity",
    "redburn": "Rothschild & Co Redburn", "rothschildredburn": "Rothschild & Co Redburn",
    "rothschild&coredburn": "Rothschild & Co Redburn",
    "melius": "Melius Research", "meliusresearch": "Melius Research",
    "arete": "Arete Research", "areteresearch": "Arete Research",
    "newstreet": "New Street Research", "newstreetresearch": "New Street Research",
    "roth": "Roth Capital", "rothcapital": "Roth Capital", "rothmkm": "Roth Capital",
    "hcwainwright": "H.C. Wainwright", "telsey": "Telsey Advisory", "telseyadvisory": "Telsey Advisory",
}
PRICE_TARGET_PUBLISHERS = {
    "tipranks": "X · TipRanks", "wallstengine": "X · Wall St Engine", "fabymetal4": "X · FabyΔ",
    "aistocksavvy": "X · Hardik Shah",
}


def canonical_target_firm(firm):
    # Aliases are explicit broker identities already recognized by the parser;
    # do not merge different firms or infer an identity from arbitrary prose.
    key = re.sub(r"[.\s]", "", firm).casefold()
    return PRICE_TARGET_FIRM_ALIASES.get(key, firm)


def target_source_evidence(item, source):
    account = re.fullmatch(r"/([A-Za-z0-9_]+)/status/\d+", urlsplit(item["url"]).path)
    name = item["source"]
    if account and account[1].lower() in {value.lower() for value in source.get("accounts", [])}:
        name = PRICE_TARGET_PUBLISHERS.get(account[1].lower(), name)
    return {"id": item["id"], "source": name, "url": item["url"],
            "publishedAt": item["publishedAt"], "observedAt": item["observedAt"]}


def target_observation_order(item):
    return datetime.fromisoformat(item["observedAt"]), item["id"]


def price_target_projection(db, sources=SOURCES, now=None):
    """Read-only, uncapped projection shared by public feed and private checks."""
    now = now or datetime.now(timezone.utc)
    approved = {s["id"]: s for s in sources if s.get("format") == "x-api"}
    by_change = {}
    # Non-target posts must not crowd a valid target out of an arbitrary row
    # limit. Bound by the seven-day publication window before parsing instead.
    for row in price_target_rows(db, now - timedelta(days=7), now):
        item, _ = price_target_observation(row, approved.get(row["source_id"]), now)
        if item is None:
            continue
        published = datetime.fromisoformat(item["publishedAt"])
        observed = datetime.fromisoformat(item["observedAt"])
        item["firm"] = canonical_target_firm(item["firm"])
        change = (item["ticker"], item["firm"].casefold(), item["previous"], item["latest"],
                  published.astimezone(timezone.utc).date())
        evidence = target_source_evidence(item, approved[row["source_id"]])
        current = by_change.get(change)
        if current is None:
            item["sources"] = [evidence]
            by_change[change] = item
            continue
        # Combine source evidence only after every post independently passes
        # the strict publication gates. Repeated acquisition of the same URL
        # adds no extra publisher, and the first detection stays canonical.
        source_posts = {entry["url"]: entry for entry in current["sources"]}
        previous = source_posts.get(evidence["url"])
        if previous is None or target_observation_order(evidence) < target_observation_order(previous):
            source_posts[evidence["url"]] = evidence
        combined = sorted(source_posts.values(), key=target_observation_order)
        if (observed, item["id"]) < target_observation_order(current):
            item["sources"] = combined
            by_change[change] = item
        else:
            current["sources"] = combined
    return sorted(by_change.values(), key=lambda item: datetime.fromisoformat(item["publishedAt"]), reverse=True)


def public_price_targets(db, sources=SOURCES, now=None, limit=20):
    """Publish only recent structured observations, never the X post body."""
    schema(db)
    items = price_target_projection(db, sources, now)[:max(1, min(limit, 30))]
    return {"ok": True, "items": items, "generatedAt": stamp()}


def price_target_publication_summary(db, sources=SOURCES, now=None, hours=24):
    """Public-safe eligibility counts, never a claim of browser delivery."""
    now = now or datetime.now(timezone.utc)
    approved = {s["id"]: s for s in sources if s.get("format") == "x-api"}
    summary = {"windowHours": hours, "candidatePosts": 0, "eligiblePosts": 0,
               "withheldPosts": 0, "withheldReasons": {},
               "acquiredTargetPosts": 0, "unselectedAcquiredTargetPosts": 0}
    # Acquisition precedes interpretation and cursor advancement. Count target
    # mentions that never reached signal_events too, without exposing post text.
    for row in db.execute(f"""SELECT text,selected_for_processing FROM signal_x_acquisition
            WHERE source_id IN ({PRICE_TARGET_SOURCE_MARKS})
            AND julianday(first_seen_at) BETWEEN julianday(?) AND julianday(?)""",
            (*PRICE_TARGET_SOURCE_IDS, (now - timedelta(hours=hours)).isoformat(), now.isoformat())):
        if PRICE_TARGET_LABEL.search(row["text"]):
            summary["acquiredTargetPosts"] += 1
            if not row["selected_for_processing"]:
                summary["unselectedAcquiredTargetPosts"] += 1
    for row in price_target_rows(db, now - timedelta(hours=hours), now, "observed_at"):
        text = row["document_text"] or row["title"]
        if not isinstance(text, str) or not PRICE_TARGET_LABEL.search(text):
            continue
        summary["candidatePosts"] += 1
        item, reason = price_target_observation(row, approved.get(row["source_id"]), now)
        if item:
            summary["eligiblePosts"] += 1
        else:
            summary["withheldPosts"] += 1
            summary["withheldReasons"][reason] = summary["withheldReasons"].get(reason, 0) + 1
    return summary


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
    if value.startswith("article-fetch-failed:") or value == 'article-queue-overflow':
        return "articlePartial"
    if value in {"fetch-failed", "fetch-error"}:
        return "fetchFailure"
    if value in {"no-links", "no-release-links"}:
        return "noLinks"
    if value.startswith("signal-") or value in {
        "invalid-source-response", "unsupported-content-type",
        "empty-or-oversized-source", "no-extractable-text",
    }:
        return "invalidResponse"
    return "other"


def x_operational_summary(db, sources=SOURCES, reference=None):
    """Public-safe X intake diagnostics: no credentials, queries or post bodies."""
    schema(db)
    current = reference or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("x-summary-reference-timezone")
    current = current.astimezone(timezone.utc)
    x_sources = {source["id"]: source for source in sources if source.get("format") == "x-api"}
    routes = []
    for source in sources:
        if source.get("format") != "x-api":
            continue
        row = db.execute("SELECT * FROM signal_routes WHERE id=?", (source["id"],)).fetchone()
        routes.append({
            "id": source["id"],
            "checkedAt": row["checked_at"] if row else None,
            "succeededAt": row["succeeded_at"] if row else None,
            "nextCheckAt": row["next_check_at"] if row else None,
            "error": monitor.persisted_route_error_code(row["error"]) if row else None,
            "matchedItems": row["matched_items"] if row else 0,
            "acquisitionCoverage": x_intake_coverage(db, source, current),
        })
    usage = x_api_usage(db, sources=sources)
    usage["routeCount"] = usage.pop("sourceCount")
    usage["minimumRouteSpacingSeconds"] = usage.pop("minimumSourceSpacingSeconds")
    errors = {}
    for route in routes:
        if route["error"]:
            errors[route["error"]] = errors.get(route["error"], 0) + 1
    item_counts = {
        "total": 0, "analystRatings": 0, "priceTargets": 0,
        "earnings": 0, "officialUpdates": 0, "other": 0,
        "latestObservedAt": None,
    }
    cutoff = current - timedelta(hours=24)
    for row in db.execute(
            "SELECT source_id,title,observed_at FROM signal_events "
            "WHERE source_id IN (%s)" % ",".join("?" for _ in x_sources),
            tuple(x_sources)) if x_sources else ():
        try:
            observed = datetime.fromisoformat(str(row["observed_at"]).replace("Z", "+00:00"))
            if observed.tzinfo is None:
                continue
            observed = observed.astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            continue
        if not cutoff < observed <= current:
            continue
        source = x_sources[row["source_id"]]
        title = row["title"]
        item_counts["total"] += 1
        matched_category = False
        if x_api.RATING_PATTERN.search(title):
            item_counts["analystRatings"] += 1
            matched_category = True
        if x_api.TARGET_PATTERN.search(title):
            item_counts["priceTargets"] += 1
            matched_category = True
        if (x_api.EARNINGS_PATTERN.search(title) and
                not x_api.EARNINGS_PREVIEW_PATTERN.search(title)):
            item_counts["earnings"] += 1
            matched_category = True
        if source.get("officialUpdates") is True:
            item_counts["officialUpdates"] += 1
            matched_category = True
        if not matched_category:
            item_counts["other"] += 1
        stamp_value = observed.isoformat()
        if not item_counts["latestObservedAt"] or stamp_value > item_counts["latestObservedAt"]:
            item_counts["latestObservedAt"] = stamp_value
    coverages = [route['acquisitionCoverage'] for route in routes]
    coverage = {'completeUpstreamCoverage': False,
                'assessmentCoverage': 'not-measured-by-acquisition',
                'trackedQueryRoutes': sum(c['currentQueryTracked'] for c in coverages),
                'untrackedQueryRoutes': sum(not c['currentQueryTracked'] for c in coverages),
                'paginationPendingRoutes': sum(c['paginationPending'] for c in coverages),
                'awaitingFirstPageRoutes': sum(c['awaitingFirstPage'] for c in coverages),
                'expiredWindowRoutes': sum(c['initialWindowExpired'] for c in coverages),
                'historicalOmissionsBeforeTrackingUnknown': True}
    for key in ('retainedAcquisitionRows', 'rowsAboveRetentionTarget',
                'knownOmittedAcquisitionRows', 'knownOmittedDocumentRows',
                'knownOmittedEventRows', 'pagesSaved', 'postObservationsSaved',
                'excludedAuthorRows', 'truncatedPostObservations'):
        coverage[key] = sum(c[key] for c in coverages)
    return {"usage": usage, "acquisitionCoverage": coverage, "routes": {
        "checked": sum(bool(r["checkedAt"]) for r in routes),
        "error": sum(bool(r["error"]) for r in routes),
        "errors": errors,
        "latestCheckedAt": max((r["checkedAt"] for r in routes if r["checkedAt"]), default=None),
        "oldestSucceededAt": min((r["succeededAt"] for r in routes if r["succeededAt"]), default=None),
        "latestSucceededAt": max((r["succeededAt"] for r in routes if r["succeededAt"]), default=None),
        "nextCheckAt": min((r["nextCheckAt"] for r in routes if r["nextCheckAt"]), default=None),
    }, "items24Hours": item_counts,
        "priceTargetPublication": price_target_publication_summary(db, sources=sources, now=current)}


def operational_summary(db, sources=SOURCES, reference=None):
    """Return URL-free health and publication-evidence totals for official routes."""
    schema(db)
    current = reference or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("signal-summary-reference-timezone")
    current = current.astimezone(timezone.utc)
    all_official = [source for source in sources
                if source.get("kind") != "external-research" and source.get("format") != "x-api"]
    official = [source for source in all_official if source.get('enabled', True)]
    configured = {source["id"]: source for source in official}

    def timestamp_value(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            parsed = parsed.astimezone(timezone.utc)
            return parsed if parsed <= current + timedelta(minutes=5) else None
        except (TypeError, ValueError, OverflowError):
            return None

    def retry_value(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            parsed = parsed.astimezone(timezone.utc)
            return parsed if parsed <= current + timedelta(days=7) else None
        except (TypeError, ValueError, OverflowError):
            return None

    error_kinds = {kind: 0 for kind in (
        "accessRestricted", "rateLimited", "timeout", "server",
        "invalidResponse", "articlePartial", "fetchFailure", "noLinks", "other",
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
    active_outages = {
        "measured": 0, "unmeasured": 0, "ageMaxMs": None,
        "attemptsAverage": None, "attemptsMax": None, "oldestStartedAt": None,
        "byErrorKind": {},
    }
    route_counts = {"configured": len(official), "suspended": len(all_official)-len(official), "checked": 0, "fresh": 0,
                    "stale": 0, "error": 0, "pending": 0,
                    "errorKinds": error_kinds, "retry": retry,
                    "activeOutages": active_outages}
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
            kind_outages = active_outages["byErrorKind"].setdefault(error_kind, {
                "measured": 0, "unmeasured": 0, "ageMaxMs": None,
                "attemptsAverage": None, "attemptsMax": None,
                "oldestStartedAt": None,
            })
            failure_started = timestamp_value(row["failure_started_at"])
            failure_attempts = row["failure_attempts"]
            if (failure_started and failure_started <= current
                    and current - failure_started <= timedelta(days=7)
                    and isinstance(failure_attempts, int)
                    and 1 <= failure_attempts <= 100):
                active_outages["measured"] += 1
                active_outages.setdefault("_ages", []).append(
                    round((current - failure_started).total_seconds() * 1000)
                )
                active_outages.setdefault("_attempts", []).append(failure_attempts)
                kind_outages["measured"] += 1
                kind_outages.setdefault("_ages", []).append(
                    round((current - failure_started).total_seconds() * 1000)
                )
                kind_outages.setdefault("_attempts", []).append(failure_attempts)
                oldest = active_outages["oldestStartedAt"]
                if oldest is None or failure_started.isoformat() < oldest:
                    active_outages["oldestStartedAt"] = failure_started.isoformat()
                kind_oldest = kind_outages["oldestStartedAt"]
                if kind_oldest is None or failure_started.isoformat() < kind_oldest:
                    kind_outages["oldestStartedAt"] = failure_started.isoformat()
            else:
                active_outages["unmeasured"] += 1
                kind_outages["unmeasured"] += 1
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
        "admissionOverflow": {"routes": 0, "unadmitted": 0, "observations": 0,
                              "maxUnadmitted": 0, "lastAt": None},
        "errorKinds": article_error_kinds,
        "retry": retry_summary(),
        "recoveries24Hours": {
            "count": 0, "latencyAverageMs": None, "latencyMaxMs": None,
            "attemptsAverage": None, "attemptsMax": None, "lastRecoveredAt": None,
        },
    }
    evidence = {"total": 0, "timestamp": 0, "dateOnly": 0, "missing": 0}
    transitions = {
        "recoveries": 0, "failures": 0, "changes": 0,
        "lastOutcome": None, "lastOccurredAt": None,
    }
    route_recoveries = {
        "count": 0, "latencyAverageMs": None, "latencyMaxMs": None,
        "attemptsAverage": None, "attemptsMax": None, "lastRecoveredAt": None,
    }
    route_retry_wait = {
        "count": 0, "waitAverageMs": None, "waitMaxMs": None,
        "lastAttemptedAt": None,
    }
    source_to_discovery = {
        "count": 0, "latencyAverageMs": None, "latencyMaxMs": None,
        "lastObservedAt": None,
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
                recoveries = state.get("recoveries", [])
            except (TypeError, ValueError):
                continue
            if not isinstance(children, dict):
                continue
            from html_signals import sanitize_queue_overflow
            overflow = sanitize_queue_overflow(state.get('queueOverflow'))
            coverage = article_retrieval['admissionOverflow']
            coverage['routes'] += int(overflow['current'] > 0)
            coverage['unadmitted'] += overflow['current']
            coverage['observations'] += overflow['observations']
            coverage['maxUnadmitted'] = max(coverage['maxUnadmitted'], overflow['maxUnadmitted'])
            if overflow['lastAt'] and (coverage['lastAt'] is None or overflow['lastAt'] > coverage['lastAt']):
                coverage['lastAt'] = overflow['lastAt']
            for index, child in enumerate(children.values()):
                if index >= 1000:
                    break
                if not isinstance(child, dict):
                    continue
                error = monitor.persisted_source_error_code(child.get("error"))
                if not error:
                    continue
                error_kind = signal_error_kind(error)
                article_retrieval["error"] += 1
                article_error_kinds[error_kind] += 1
                record_retry(article_retrieval["retry"], error_kind, child.get("next_check"))
            if isinstance(recoveries, list):
                measurements = article_retrieval["recoveries24Hours"]
                cutoff = current - timedelta(hours=24)
                for recovery in recoveries[-100:]:
                    if not isinstance(recovery, dict):
                        continue
                    failed = timestamp_value(recovery.get("failedAt"))
                    recovered = timestamp_value(recovery.get("recoveredAt"))
                    attempts = recovery.get("attempts")
                    if (not failed or not recovered or recovered < cutoff or failed > recovered
                            or recovered - failed > timedelta(days=7)
                            or not isinstance(attempts, int) or not 2 <= attempts <= 101):
                        continue
                    latency = round((recovered - failed).total_seconds() * 1000)
                    measurements["count"] += 1
                    measurements.setdefault("_latencies", []).append(latency)
                    measurements.setdefault("_attempts", []).append(attempts)
                    if (measurements["lastRecoveredAt"] is None
                            or recovered.isoformat() > measurements["lastRecoveredAt"]):
                        measurements["lastRecoveredAt"] = recovered.isoformat()
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
        for row in db.execute(f"""SELECT failed_at,recovered_at,attempts
          FROM signal_route_recoveries WHERE source_id IN ({placeholders})
          ORDER BY id""", tuple(configured)):
            failed = timestamp_value(row["failed_at"])
            recovered = timestamp_value(row["recovered_at"])
            attempts = row["attempts"]
            if (not failed or not recovered or recovered < cutoff or failed > recovered
                    or recovered - failed > timedelta(days=7)
                    or not isinstance(attempts, int) or not 2 <= attempts <= 101):
                continue
            latency = round((recovered - failed).total_seconds() * 1000)
            route_recoveries["count"] += 1
            route_recoveries.setdefault("_latencies", []).append(latency)
            route_recoveries.setdefault("_attempts", []).append(attempts)
            if (route_recoveries["lastRecoveredAt"] is None
                    or recovered.isoformat() > route_recoveries["lastRecoveredAt"]):
                route_recoveries["lastRecoveredAt"] = recovered.isoformat()
        for row in db.execute(f"""SELECT eligible_at,attempted_at,error_kind
          FROM signal_route_retry_attempts WHERE source_id IN ({placeholders})
          ORDER BY id""", tuple(configured)):
            eligible = timestamp_value(row["eligible_at"])
            attempted = timestamp_value(row["attempted_at"])
            if (not eligible or not attempted or attempted < cutoff or attempted > current
                    or eligible > attempted
                    or attempted - eligible > timedelta(days=7)
                    or row["error_kind"] not in error_kinds):
                continue
            wait = round((attempted - eligible).total_seconds() * 1000)
            route_retry_wait["count"] += 1
            route_retry_wait.setdefault("_waits", []).append(wait)
            if (route_retry_wait["lastAttemptedAt"] is None
                    or attempted.isoformat() > route_retry_wait["lastAttemptedAt"]):
                route_retry_wait["lastAttemptedAt"] = attempted.isoformat()
    measurements = article_retrieval["recoveries24Hours"]
    latencies = measurements.pop("_latencies", [])
    attempts = measurements.pop("_attempts", [])
    if latencies:
        measurements["latencyAverageMs"] = round(sum(latencies) / len(latencies))
        measurements["latencyMaxMs"] = max(latencies)
        measurements["attemptsAverage"] = round(sum(attempts) / len(attempts), 1)
        measurements["attemptsMax"] = max(attempts)
    route_latencies = route_recoveries.pop("_latencies", [])
    route_attempts = route_recoveries.pop("_attempts", [])
    if route_latencies:
        route_recoveries["latencyAverageMs"] = round(sum(route_latencies) / len(route_latencies))
        route_recoveries["latencyMaxMs"] = max(route_latencies)
        route_recoveries["attemptsAverage"] = round(sum(route_attempts) / len(route_attempts), 1)
        route_recoveries["attemptsMax"] = max(route_attempts)
    retry_waits = route_retry_wait.pop("_waits", [])
    if retry_waits:
        route_retry_wait["waitAverageMs"] = round(sum(retry_waits) / len(retry_waits))
        route_retry_wait["waitMaxMs"] = max(retry_waits)
    measurement_sources = {
        source["id"] for source in sources
        if source.get("officialUpdates") is True and source.get("kind") == "publisher-update"
    }
    if measurement_sources:
        measurement_marks = ",".join("?" for _ in measurement_sources)
        cutoff = current - timedelta(hours=24)
        source_latencies = []
        for row in db.execute(f"""SELECT published_at,observed_at FROM signal_events
          WHERE source_id IN ({measurement_marks})
          AND COALESCE(previous_sha,'')=''""", tuple(measurement_sources)):
            published = timestamp_value(row["published_at"])
            observed = timestamp_value(row["observed_at"])
            if (not published or not observed or observed < cutoff or observed < published
                    or observed - published > timedelta(days=7)):
                continue
            source_latencies.append(round((observed - published).total_seconds() * 1000))
            if (source_to_discovery["lastObservedAt"] is None
                    or observed.isoformat() > source_to_discovery["lastObservedAt"]):
                source_to_discovery["lastObservedAt"] = observed.isoformat()
        if source_latencies:
            source_to_discovery["count"] = len(source_latencies)
            source_to_discovery["latencyAverageMs"] = round(
                sum(source_latencies) / len(source_latencies)
            )
            source_to_discovery["latencyMaxMs"] = max(source_latencies)
    outage_ages = active_outages.pop("_ages", [])
    outage_attempts = active_outages.pop("_attempts", [])
    if outage_ages:
        active_outages["ageMaxMs"] = max(outage_ages)
        active_outages["attemptsAverage"] = round(
            sum(outage_attempts) / len(outage_attempts), 1,
        )
        active_outages["attemptsMax"] = max(outage_attempts)
    for kind_outages in active_outages["byErrorKind"].values():
        kind_ages = kind_outages.pop("_ages", [])
        kind_attempts = kind_outages.pop("_attempts", [])
        if kind_ages:
            kind_outages["ageMaxMs"] = max(kind_ages)
            kind_outages["attemptsAverage"] = round(
                sum(kind_attempts) / len(kind_attempts), 1,
            )
            kind_outages["attemptsMax"] = max(kind_attempts)
    return {"routes": route_counts, "articleRetrieval": article_retrieval,
            "publicationEvidence": evidence,
            "publicationToDetectionLatency24Hours": source_to_discovery,
            "routeTransitions24Hours": transitions,
            "routeRecoveries24Hours": route_recoveries,
            "routeRetryWait24Hours": route_retry_wait}


def due(db, sources=None):
    schema(db)
    current_text = stamp()
    current = datetime.fromisoformat(current_text.replace("Z", "+00:00"))
    if current.tzinfo is None:
        raise ValueError("signal-due-reference-timezone")
    current = current.astimezone(timezone.utc)
    rows = {row["id"]: row for row in db.execute("SELECT * FROM signal_routes")}
    candidates = enabled_sources(SOURCES if sources is None else sources)

    def ready(source):
        row = rows.get(source["id"])
        if not row or not row["next_check_at"]:
            return True
        try:
            next_check = datetime.fromisoformat(
                str(row["next_check_at"]).replace("Z", "+00:00")
            )
            if next_check.tzinfo is None:
                return True
            next_check = next_check.astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            return True
        # Invalid persisted schedules must not strand a route forever. A
        # valid bounded future schedule is still respected, including the
        # seven-day access-control ceiling.
        return next_check <= current or next_check > current + timedelta(days=7)

    return [source for source in candidates if ready(source)]


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


def public_official_updates(db, sources=SOURCES, reference=None, limit=20, *, read_only=False, include_bodies=True,
                            source_snapshots=None):
    """Links/headlines only; never publish private excerpts or unreviewed AI claims."""
    if not read_only:
        schema(db)
    import news_policy
    import official_release_bridge
    current = reference or datetime.now(timezone.utc)
    current = current.replace(tzinfo=current.tzinfo or timezone.utc).astimezone(timezone.utc)
    include_reviewed_oracle = sources is SOURCES
    if sources is SOURCES:
        if not read_only:
            official_release_bridge.sync(db, current)
            # Even an ignored bridge INSERT takes the SQLite writer slot.
            # Finish only this synchronization before the read-only projection;
            # schema() above has already closed any incoming transaction.
            db.commit()
        sources = [*sources, *official_release_bridge.publishers()]
    allowed = {s['id']: s for s in sources if s.get('officialUpdates') is True
               and s.get('kind') == 'publisher-update' and s.get('allowedHosts')
               and (s.get('tickers') or s['id'] == 'bea-pce')}
    if not allowed:
        return []
    cutoff = current - timedelta(days=7)
    marks = ','.join('?' for _ in allowed)
    rows = db.execute(f'''SELECT * FROM signal_events WHERE source_id IN ({marks})
      ORDER BY id DESC LIMIT 500''', tuple(allowed)).fetchall()
    issuer_context_ids=set(allowed)
    context_collision=False
    if include_reviewed_oracle:
        import oracle_reviewed_recovery
        reviewed = oracle_reviewed_recovery.public_event(db, current)
        if reviewed is not None:
            # An injected exception must not change the independent normal
            # issuer source/dedup set used for related authorization evidence.
            context_collision=(reviewed['source_id'] in issuer_context_ids
                               or any(row['url']==reviewed['url'] for row in rows))
            allowed[reviewed['source_id']] = oracle_reviewed_recovery.publisher()
            rows.append(reviewed)
    def instant(value):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
        except (AttributeError, ValueError, TypeError):
            return None
    def release_order(row):
        return next((parsed.timestamp() for parsed in
                     (instant(row['published_at']), instant(row['published_on']), instant(row['observed_at']))
                     if parsed), 0)
    # Resolve ownership before source-clock ordering or eligibility filtering.
    # Held/stale primaries still own their exact URL, even outside this scan.
    primary_urls = official_release_bridge.primary_owned_urls(db, [row['url'] for row in rows
        if not row['source_id'].startswith(official_release_bridge.PREFIX)])
    rows = [row for row in rows if row['source_id'].startswith(official_release_bridge.PREFIX)
            or row['url'] not in primary_urls]
    category_contexts = official_release_bridge.category_contexts(db, rows, sources=allowed.values())
    # A baseline can insert newest-first API results in reverse database-ID order.
    rows = sorted(rows, key=release_order, reverse=True)
    items, seen = [], set()
    issuer_context=[]
    scan_complete=False
    for row in rows:
        source = allowed[row['source_id']]
        if not official_release_bridge.is_current(db, row, source=source, primary_urls=primary_urls,
                reference=current, category_context=category_contexts.get(row['source_id'])):
            continue
        if source['id'] != 'bea-pce' and not news_policy.eligible(row['title']):
            continue
        try:
            published = row['published_at'] or row['published_on']
            published_at = instant(published) if published else None
            observed = instant(row['observed_at'])
            if not observed or not cutoff <= observed <= current or (published and (not published_at or not cutoff <= published_at <= current)):
                continue
            if row['event_kind'] == 'baseline' and not published:
                continue
            url = safe_url(row['url'], source)
            if url in seen:
                continue
            if source['id'] == 'x-nebius-official' and not re.fullmatch(r'https://x.com/nebiusai/status/[0-9]+', url, re.I):
                continue
            configured_tickers = set(source.get('tickers', []))
            tickers = [t for t in json.loads(row['tickers_json'])
                       if t in configured_tickers and re.fullmatch(r'[A-Z][A-Z0-9.-]{0,9}', t)][:5]
            if not tickers and source['id'] != 'bea-pce':
                continue
        except (ValueError, TypeError):
            continue
        seen.add(url)
        publication = {}
        # Preserve precision: a date is not a midnight publication timestamp.
        if isinstance(published, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', published):
            publication['publishedOn'] = published
        elif (isinstance(published, str) and published_at and
              re.search(r'T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$', published)):
            publication['publishedAt'] = published_at.isoformat()
        translated = db.execute('''SELECT headline_ja FROM signal_headline_translations
          WHERE source_id=? AND url=? AND sha=?''',
                                (row['source_id'], row['url'], row['sha'])).fetchone()
        translation = {}
        display_title = news_policy.headline(row['title'])[:180]
        if not display_title:
            continue
        if source['id'] == 'bea-pce':
            # Re-project only the current exact revision; never expose a body,
            # or attach new values to an older release's publication time.
            from bea_pce import parse_release
            document = db.execute('''SELECT title,text,sha FROM signal_documents
              WHERE source_id=? AND url=?''', (row['source_id'], row['url'])).fetchone()
            if not document or document['sha'] != row['sha'] or row['truncated']:
                continue
            try:
                projection = parse_release(document['title'], document['text'], url)
                release_time = instant(projection['publishedAt'])
                if not release_time or not cutoff <= release_time <= current:
                    continue
            except (ValueError, TypeError):
                continue
            display_title = projection['title']
            translation['translationJa'] = projection['translationJa']
            publication = {'publishedAt': projection['publishedAt']}
        if (source['id'] != 'bea-pce' and translated and isinstance(translated['headline_ja'], str)
                and translated['headline_ja'].strip()
                and len(translated['headline_ja']) <= 180
                and '\x00' not in translated['headline_ja']):
            cleaned = news_policy.headline(translated['headline_ja'])
            if cleaned:
                try:
                    factual_validation.validate_numbers(cleaned, display_title)
                    factual_validation.validate_semantics(cleaned, display_title)
                    factual_validation.validate_acquisition(cleaned, display_title, 'ja', require_status=True)
                    factual_validation.validate_names(cleaned, display_title)
                    translation['translationJa'] = cleaned
                except ValueError:
                    pass
        from official_headline_corrections import reviewed_headline
        corrected = reviewed_headline(row)
        if corrected:
            translation['translationJa'] = corrected
        compact = db.execute("""SELECT source_title,title_ja,title_en FROM signal_compact_headlines
          WHERE source_id=? AND url=? AND sha=?""", (row['source_id'], row['url'], row['sha'])).fetchone()
        if compact and compact['source_title'] == display_title and translation.get('translationJa'):
            import compact_headlines
            translation.update(compact_headlines.validated(
                {'shortTitleJa': compact['title_ja'], 'shortTitleEn': compact['title_en']},
                translation['translationJa'], display_title))
        if include_bodies:
            from official_research import public_story_body
            translation.update(public_story_body(db, row, primary_urls=primary_urls, reference=current,
                category_context=category_contexts.get(row['source_id'])))
        item={'id': str(row['id']), 'title': display_title, 'url': url,
              'publisher': source['name'], 'tickers': tickers,
              'observedAt': observed.isoformat(), **publication, **translation}
        if source_snapshots is not None:
            source_snapshots[item['id']] = official_release_bridge.bind_source_policy(
                {key: row[key] for key in official_release_bridge.EVENT_IDENTITY_FIELDS}, source, db=db,
                reference=current, category_context=category_contexts.get(row['source_id']))
        import feed_category_admission
        if feed_category_admission.required(source):
            item['categoryEvidence'] = feed_category_admission.decision(db, source, list(ALIASES), row, current,
                context=category_contexts.get(row['source_id']))['evidence']
        items.append(item)
        if row['source_id'] in issuer_context_ids:issuer_context.append(item)
        if len(items) == limit:
            break
    else:
        scan_complete=True
    if include_reviewed_oracle:
        import buyback_recap
        # Reuse only the same request's complete, body-validated ordinary
        # issuer collection. Smaller/metadata-only/exceptional reads retain
        # the independent lookup; syndicated/reported items never enter it.
        authorization_context=(buyback_recap.from_published(issuer_context)
                               if include_bodies and not context_collision
                               and (scan_complete or len(issuer_context)>=100) else None)
        import issuer_syndication
        # Only validated, revision-bound copy joins the existing display.
        # The distributor feed itself never becomes globally official/AI-eligible.
        items.extend(issuer_syndication.public_items(db, current))
        import general_source_news
        items.extend(general_source_news.public_items(db, current,authorization_context=authorization_context))
        import issuer_business_news
        items.extend(issuer_business_news.public_items(db, current))
        items.sort(key=lambda item: next((stamp.timestamp() for value in
                   (item.get('publishedAt'), item.get('publishedOn'), item.get('observedAt'))
                   if (stamp := instant(value))), 0), reverse=True)
        items = list({item['url']: item for item in items}.values())[:limit]
    return items
