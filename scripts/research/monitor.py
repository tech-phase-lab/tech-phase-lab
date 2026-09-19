"""Official-source research intake. No scheduler, summarization, or publishing side effects."""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
from html import unescape
import json
import os
from pathlib import Path
import sqlite3
import sys
import re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import threading

ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = {p["ticker"]: p for p in json.loads((ROOT / "lib/research/providers.json").read_text())}
INDEXES = {t: p["indexUrl"] for t, p in PROVIDERS.items()}
HOSTS = {t: set(p["allowedHosts"]) for t, p in PROVIDERS.items()}
MAX_BYTES = 12 * 1024 * 1024
_FETCH_CACHE = {}
_FETCH_CACHE_LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def safe_url(url, ticker):
    p = urlsplit(url)
    if (p.scheme != "https" or p.hostname not in HOSTS[ticker]
            or p.username or p.password or p.port not in (None, 443)):
        raise ValueError("URL outside approved official hosts")
    return urlunsplit((p.scheme, p.netloc, p.path, p.query, ""))


class Redirects(HTTPRedirectHandler):
    def __init__(self, ticker):
        self.ticker = ticker

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl, self.ticker)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, ticker):
    url = safe_url(url, ticker)
    with _FETCH_CACHE_LOCK:
        cached = _FETCH_CACHE.get(url)
    headers = {
        "User-Agent": os.environ.get("RESEARCH_USER_AGENT", "TechPhaseResearch-SourceCheck/0.1"),
        "Accept": "application/json,application/rss+xml,application/atom+xml,text/html,application/pdf",
    }
    if cached and cached.get("etag"):
        headers["If-None-Match"] = cached["etag"]
    if cached and cached.get("last_modified"):
        headers["If-Modified-Since"] = cached["last_modified"]
    req = Request(url, headers=headers)
    timeout = PROVIDERS[ticker].get("requestTimeoutSeconds", 20) if url == INDEXES[ticker] else 20
    if os.environ.get("RESEARCH_REQUEST_TIMEOUT_SECONDS"):
        timeout = min(timeout, max(1, int(os.environ["RESEARCH_REQUEST_TIMEOUT_SECONDS"])))
    try:
        response = build_opener(Redirects(ticker)).open(req, timeout=timeout)
    except HTTPError as exc:
        if exc.code == 304 and cached:
            return cached["content"], cached["content_type"]
        raise
    with response:
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/pdf", "application/json", "application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}:
            raise ValueError("Unsupported content type: " + content_type)
        content = response.read(MAX_BYTES + 1)
        if not content or len(content) > MAX_BYTES:
            raise ValueError("Empty or oversized source")
        if content_type == "application/pdf" and not content.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF response")
        if content_type == "text/html":
            title = re.search(br"<title[^>]*>(.*?)</title>", content, re.I | re.S)
            if title and re.search(br"access denied|just a moment|page not found|403 forbidden", title.group(1), re.I):
                raise ValueError("Source returned an error or verification page")
        with _FETCH_CACHE_LOCK:
            _FETCH_CACHE[url] = {
                "content": content,
                "content_type": content_type,
                "etag": response.headers.get("ETag"),
                "last_modified": response.headers.get("Last-Modified"),
            }
        return content, content_type


class Links(HTMLParser):
    def __init__(self, base, ticker):
        super().__init__(convert_charrefs=True)
        self.base, self.ticker, self.urls = base, ticker, set()
        self.labels, self.current, self.text = {}, None, []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        try:
            url = safe_url(urljoin(self.base, href), self.ticker)
        except ValueError:
            return
        self.current, self.text = article_url(url, self.ticker), []
        if self.current:
            self.urls.add(self.current)

    def handle_data(self, value):
        if self.current:
            self.text.append(value)

    def handle_endtag(self, tag):
        if tag == "a" and self.current:
            label = " ".join(" ".join(self.text).split())[:300]
            if label and label.lower() not in {"read more", "read article", "learn more", "read press release", "read blog"}:
                self.labels[self.current] = label
            self.current, self.text = None, []


def article_url(url, ticker):
    try:
        p = urlsplit(safe_url(url, ticker))
        if any(p.hostname == rule["host"] and re.search(rule["pattern"], p.path) for rule in PROVIDERS[ticker]["articleRules"]):
            return urlunsplit((p.scheme, p.netloc, p.path, "", ""))
    except (ValueError, KeyError):
        pass
    return None


def feed_links(body, ticker):
    if b"\x00" in body or re.search(br"<!\s*(DOCTYPE|ENTITY)", body, re.I):
        raise ValueError("XML declarations with entities are not supported")
    root = ET.fromstring(body)
    entries = root.findall("./channel/item") + root.findall("{http://www.w3.org/2005/Atom}entry")
    links = {}
    for item in entries:
        url = item.findtext("link")
        if not url:
            for link in item.findall("{http://www.w3.org/2005/Atom}link"):
                if link.get("rel", "alternate") == "alternate":
                    url = link.get("href")
                    break
        canonical = article_url(url or "", ticker)
        if canonical:
            title = item.findtext("title") or item.findtext("{http://www.w3.org/2005/Atom}title") or ""
            links[canonical] = " ".join(unescape(title).split())[:300] or None
    return links


def sec_submission_links(body, ticker, source):
    """Turn the SEC submissions columnar JSON into official filing-document URLs."""
    data = json.loads(body)
    cik = source.get("cik", "")
    if not re.fullmatch(r"\d{10}", cik) or str(data.get("cik", "")).zfill(10) != cik:
        raise ValueError("SEC submissions CIK mismatch")
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    documents = recent.get("primaryDocument", [])
    descriptions = recent.get("primaryDocDescription", [])
    if not all(isinstance(items, list) for items in (forms, accessions, documents, descriptions)):
        raise ValueError("Invalid SEC submissions structure")
    allowed_forms = set(source.get("forms", []))
    limit = max(1, min(int(source.get("limit", 40)), 100))
    links = {}
    for index, form in enumerate(forms):
        if form not in allowed_forms or index >= len(accessions) or index >= len(documents):
            continue
        accession, document = accessions[index], documents[index]
        if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession or "") or not re.fullmatch(r"[A-Za-z0-9._-]+", document or ""):
            continue
        url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{document}"
        canonical = article_url(url, ticker)
        if not canonical:
            continue
        description = descriptions[index] if index < len(descriptions) else ""
        links[canonical] = " ".join(f"{form} · {description or 'Official filing'}".split())[:300]
        if len(links) >= limit:
            break
    return links


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout = 5000")
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS sources (
      url TEXT PRIMARY KEY, ticker TEXT NOT NULL, published_on TEXT,
      discovered_at TEXT NOT NULL, checked_at TEXT, sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'pending', error TEXT);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES sources(url),
      at TEXT NOT NULL, kind TEXT NOT NULL, sha256 TEXT, reviewer TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, at TEXT NOT NULL,
      status TEXT NOT NULL, candidates INTEGER NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS release_events (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE REFERENCES sources(url),
      ticker TEXT NOT NULL, detected_at TEXT NOT NULL);
    """)
    if "index_url" not in {row[1] for row in db.execute("PRAGMA table_info(discovery_runs)")}:
        db.execute("ALTER TABLE discovery_runs ADD COLUMN index_url TEXT")
    if "title" not in {row[1] for row in db.execute("PRAGMA table_info(sources)")}:
        db.execute("ALTER TABLE sources ADD COLUMN title TEXT")
    return db


def add_source(db, ticker, url, published_on=None, title=None):
    url = safe_url(url, ticker)
    if published_on:
        datetime.strptime(published_on, "%Y-%m-%d")
    with db:
        db.execute("INSERT OR IGNORE INTO sources(url,ticker,published_on,discovered_at) VALUES(?,?,?,?)", (url, ticker, published_on, now()))
        if title:
            db.execute("UPDATE sources SET title=? WHERE url=? AND title IS NULL", (title[:300], url))
    return url


def monitoring_sources(ticker, automatic=False):
    """Return the preferred company feed followed by official fallback feeds."""
    provider = PROVIDERS[ticker]
    sources = [{"url": provider["indexUrl"], "format": provider["format"], "route": "primary"}] + [
        {**source, "route": "fallback"} for source in provider.get("fallbackSources", [])
    ]
    if automatic and provider.get("automaticSource") == "fallback":
        sources.sort(key=lambda source: source["route"] != "fallback")
    return sources


def discover_links(body, kind, ticker, source):
    if source["format"] == "sec-json":
        if kind != "application/json":
            raise ValueError("SEC submissions source is not JSON")
        return sec_submission_links(body, ticker, source)
    if source["format"] == "rss":
        return feed_links(body, ticker)
    if kind != "text/html":
        raise ValueError("Index is not HTML")
    parser = Links(source["url"], ticker)
    parser.feed(body.decode("utf-8", errors="replace"))
    return {url: parser.labels.get(url) for url in parser.urls}


def collect_discovery(ticker, transport=fetch, automatic=False):
    """Fetch and parse candidates without mutating storage."""
    failures = []
    links, used_source = {}, None
    for source in monitoring_sources(ticker, automatic=automatic):
        try:
            body, kind = transport(source["url"], ticker)
            links = discover_links(body, kind, ticker, source)
            if not links:
                raise ValueError("No release links parsed; source discovery requires investigation")
            if len(links) > 500:
                raise ValueError("Too many source links; narrow the source scope before importing")
            used_source = source
            break
        except Exception as exc:
            failures.append(str(exc))
    if used_source:
        result = {
            "ticker": ticker,
            "status": "ok" if used_source["route"] == "primary" else "fallback",
            "route": used_source["route"],
            "sourceUrl": used_source["url"],
            "candidates": len(links),
            "error": failures[0] if failures else None,
        }
    else:
        result = {"ticker": ticker, "status": "degraded", "route": "none", "sourceUrl": INDEXES[ticker], "candidates": 0, "error": failures[0] if failures else "No monitoring sources configured"}
    return result, links


def save_discovery(db, ticker, result, links):
    """Persist one completed discovery result and return newly inserted URLs."""
    before = {row[0] for row in db.execute("SELECT url FROM sources WHERE ticker=?", (ticker,))}
    for url, title in links.items():
        add_source(db, ticker, url, title=title)
    with db:
        db.execute("INSERT INTO discovery_runs(ticker,at,status,candidates,error,index_url) VALUES(?,?,?,?,?,?)", (ticker, now(), result["status"], result["candidates"], result["error"], result["sourceUrl"]))
    return sorted(set(links) - before)


def add_release_events(db, ticker, urls):
    """Record newly observed URLs once; baseline imports should not call this."""
    detected_at = now()
    with db:
        for url in urls:
            db.execute(
                "INSERT OR IGNORE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)",
                (safe_url(url, ticker), ticker, detected_at),
            )


def discover(db, ticker, transport=fetch):
    """Discover candidates, using an official fallback when the preferred route fails."""
    result, links = collect_discovery(ticker, transport=transport)
    result["newCandidates"] = len(save_discovery(db, ticker, result, links))
    return result


def public_error(error):
    """Export a category, never exception messages containing local paths or secrets."""
    if not error:
        return None
    if "403" in error:
        return "http-403"
    if "timed out" in error.lower() or "timeout" in error.lower():
        return "timeout"
    if "No release links" in error:
        return "no-links"
    return "fetch-error"


def snapshot(db):
    """Public-safe, read-only report. Explicit field lists prevent identity leaks."""
    with db:
        db.execute("BEGIN")
        sources = [dict(r) for r in db.execute("SELECT url,ticker,title,published_on,discovered_at,checked_at,sha256,status,error FROM sources ORDER BY ticker,url")]
        history = [dict(r) for r in db.execute("SELECT id,url,at,kind,sha256 FROM history ORDER BY id DESC")]
        runs = [dict(r) for r in db.execute("SELECT id,ticker,at,status,candidates,error,index_url FROM discovery_runs ORDER BY id DESC")]
        events = [dict(r) for r in db.execute("""
          SELECT e.id,e.url,e.ticker,e.detected_at,s.title,s.published_on
          FROM release_events e JOIN sources s ON s.url=e.url
          ORDER BY e.id DESC LIMIT 200
        """)]
    for row in sources + runs:
        row["error"] = public_error(row["error"])
    for row in sources:
        safe_url(row["url"], row["ticker"])
    return {"schemaVersion": 1, "generatedAt": now(), "sources": sources, "history": history, "discoveryRuns": runs, "events": events}


def write_snapshot(db, output):
    """Replace a public snapshot atomically so readers never observe partial JSON."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    data = snapshot(db)
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(output)
    return data


def check_source(db, row, transport=fetch):
    try:
        content, _ = transport(row["url"], row["ticker"])
        digest = hashlib.sha256(content).hexdigest()
        with db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT * FROM sources WHERE url=?", (row["url"],)).fetchone()
            changed = digest != current["sha256"]
            if changed:
                db.execute("INSERT INTO history(url,at,kind,sha256,reason) VALUES(?,?,?,?,?)", (row["url"], now(), "changed" if current["sha256"] else "first-fetch", digest, "Raw response changed; editorial correction not established"))
            db.execute("UPDATE sources SET sha256=?,checked_at=?,error=NULL,status=? WHERE url=?", (digest, now(), "pending" if changed else current["status"], row["url"]))
        status = "first-fetched" if not current["sha256"] else ("changed" if changed else "unchanged")
        return {"url": row["url"], "status": status}
    except Exception as exc:
        with db:
            db.execute("UPDATE sources SET checked_at=?,error=? WHERE url=?", (now(), str(exc), row["url"]))
            db.execute("INSERT INTO history(url,at,kind,reason) VALUES(?,?,?,?)", (row["url"], now(), "fetch-error", str(exc)))
        return {"url": row["url"], "status": "error", "error": str(exc)}


def review(db, url, expected_sha, decision, reviewer, reason):
    if decision not in {"approved", "held", "rejected"} or not reviewer.strip() or not reason.strip():
        raise ValueError("Decision, reviewer, and reason are required")
    with db:
        # Acquire a write lock before reading so a concurrent check cannot invalidate approval.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
        if not row or not row["sha256"] or row["sha256"] != expected_sha or row["error"]:
            raise ValueError("Source is missing, changed, or failed its latest check; review current content first")
        db.execute("INSERT INTO history(url,at,kind,sha256,reviewer,reason) VALUES(?,?,?,?,?,?)", (url, now(), decision, expected_sha, reviewer.strip(), reason.strip()))
        db.execute("UPDATE sources SET status=? WHERE url=?", (decision, url))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", default=str(ROOT / ".research-private/intake.sqlite"))
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("seed")
    d = sub.add_parser("discover")
    d.add_argument("ticker", choices=HOSTS)
    c = sub.add_parser("check")
    c.add_argument("--limit", type=int, default=6)
    c.add_argument("--ticker", choices=HOSTS)
    sub.add_parser("list")
    sub.add_parser("history")
    e = sub.add_parser("export")
    e.add_argument("--output", required=True, help="JSON report path; reviewer identities and reasons are excluded")
    refresh = sub.add_parser("refresh")
    refresh.add_argument("--output", required=True, help="JSON report path; replaced atomically after all companies run")
    refresh.add_argument("--check-limit", type=int, default=0, help="Also fetch up to this many oldest unchecked source bodies")
    a = sub.add_parser("add")
    a.add_argument("ticker", choices=HOSTS)
    a.add_argument("url")
    r = sub.add_parser("review")
    r.add_argument("url")
    r.add_argument("sha256")
    r.add_argument("decision", choices=["approved", "held", "rejected"])
    r.add_argument("--reviewer", required=True)
    r.add_argument("--reason", required=True)
    args = p.parse_args()
    with connect(args.db) as db:
        if args.command == "seed":
            seeds = json.loads(Path(__file__).with_name("sources.json").read_text())
            for source in seeds:
                add_source(db, source["ticker"], source["url"], source["publishedOn"])
            result = {"seeded": len(seeds)}
        elif args.command == "discover":
            result = discover(db, args.ticker)
        elif args.command == "check":
            if not 1 <= args.limit <= 20:
                p.error("--limit must be between 1 and 20")
            rows = db.execute("SELECT * FROM sources WHERE (? IS NULL OR ticker=?) ORDER BY checked_at IS NOT NULL, checked_at, url LIMIT ?", (args.ticker, args.ticker, args.limit)).fetchall()
            result = [check_source(db, row) for row in rows]
        elif args.command == "add":
            result = {"url": add_source(db, args.ticker, args.url)}
        elif args.command == "review":
            review(db, args.url, args.sha256, args.decision, args.reviewer, args.reason)
            result = {"status": args.decision, "published": False}
        elif args.command == "refresh":
            if not 0 <= args.check_limit <= 200:
                p.error("--check-limit must be between 0 and 200")
            discoveries = [discover(db, ticker) for ticker in PROVIDERS]
            rows = db.execute("SELECT * FROM sources ORDER BY checked_at IS NOT NULL, checked_at, discovered_at, url LIMIT ?", (args.check_limit,)).fetchall()
            checked = [check_source(db, row) for row in rows]
            data = write_snapshot(db, args.output)
            result = {
                "companies": len(discoveries),
                "available": sum(row["status"] in {"ok", "fallback"} for row in discoveries),
                "fallback": sum(row["status"] == "fallback" for row in discoveries),
                "degraded": sum(row["status"] == "degraded" for row in discoveries),
                "checked": len(checked),
                "sources": len(data["sources"]),
                "exported": str(Path(args.output)),
                "published": False,
            }
        elif args.command == "export":
            data = write_snapshot(db, args.output)
            result = {"sources": len(data["sources"]), "exported": str(Path(args.output)), "published": False}
        else:
            table = "sources" if args.command == "list" else "history"
            result = [dict(row) for row in db.execute("SELECT * FROM " + table)]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if (isinstance(result, dict) and (result.get("status") == "degraded" or result.get("degraded", 0) > 0)) or (isinstance(result, list) and any(row.get("status") == "error" for row in result)):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
