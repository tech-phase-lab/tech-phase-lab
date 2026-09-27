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
    headers = {"User-Agent": source.get("userAgent", "TechPhaseResearch/0.1 (+source-monitor)"), "Accept-Encoding": "identity"}
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
        return collect(source, validators, tickers or list(ALIASES), fetch, stamp)
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
        "attemp