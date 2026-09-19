"""Manual research intake. No scheduler, summarization, or publishing side effects."""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
from html import unescape
import json
from pathlib import Path
import sqlite3
import sys
import re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = {p["ticker"]: p for p in json.loads((ROOT / "lib/research/providers.json").read_text())}
INDEXES = {t: p["indexUrl"] for t, p in PROVIDERS.items()}
HOSTS = {t: set(p["allowedHosts"]) for t, p in PROVIDERS.items()}
MAX_BYTES = 12 * 1024 * 1024


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
    req = Request(url, headers={"User-Agent": "TechPhaseResearch-SourceCheck/0.1", "Accept": "application/rss+xml,application/atom+xml,text/html,application/pdf"})
    with build_opener(Redirects(ticker)).open(req, timeout=20) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/pdf", "application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}:
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


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
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


def discover(db, ticker, transport=fetch):
    """First-page candidates only. Missing markup is degraded, never 'no news'."""
    try:
        body, kind = transport(INDEXES[ticker], ticker)
        if PROVIDERS[ticker]["format"] == "rss":
            links = feed_links(body, ticker)
        else:
            if kind != "text/html":
                raise ValueError("Index is not HTML")
            parser = Links(INDEXES[ticker], ticker)
            parser.feed(body.decode("utf-8", errors="replace"))
            links = {url: parser.labels.get(url) for url in parser.urls}
        if not links:
            raise ValueError("No release links parsed; source discovery requires investigation")
        if len(links) > 500:
            raise ValueError("Too many source links; narrow the source scope before importing")
        for url, title in links.items():
            add_source(db, ticker, url, title=title)
        result = {"ticker": ticker, "status": "ok", "candidates": len(links), "error": None}
    except Exception as exc:
        result = {"ticker": ticker, "status": "degraded", "candidates": 0, "error": str(exc)}
    with db:
        db.execute("INSERT INTO discovery_runs(ticker,at,status,candidates,error,index_url) VALUES(?,?,?,?,?,?)", (ticker, now(), result["status"], result["candidates"], result["error"], INDEXES[ticker]))
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
    for row in sources + runs:
        row["error"] = public_error(row["error"])
    for row in sources:
        safe_url(row["url"], row["ticker"])
    return {"schemaVersion": 1, "generatedAt": now(), "sources": sources, "history": history, "discoveryRuns": runs}


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
        elif args.command == "export":
            data = snapshot(db)
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            result = {"sources": len(data["sources"]), "exported": str(output), "published": False}
        else:
            table = "sources" if args.command == "list" else "history"
            result = [dict(row) for row in db.execute("SELECT * FROM " + table)]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if (isinstance(result, dict) and result.get("status") == "degraded") or (isinstance(result, list) and any(row.get("status") == "error" for row in result)):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
