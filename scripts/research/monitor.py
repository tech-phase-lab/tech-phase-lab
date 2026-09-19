"""Official-source research intake. No scheduler, summarization, or publishing side effects."""
import argparse
from datetime import datetime, timedelta, timezone
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
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import threading

ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = {p["ticker"]: p for p in json.loads((ROOT / "lib/research/providers.json").read_text())}
INDEXES = {t: p.get("monitorUrl", p["indexUrl"]) for t, p in PROVIDERS.items()}
HOSTS = {t: set(p["allowedHosts"]) for t, p in PROVIDERS.items()}
MAX_BYTES = 12 * 1024 * 1024
MAX_EXTRACTED_CHARS = 160_000
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


def source_configuration(url, ticker):
    """Return static request settings only for a configured discovery endpoint."""
    for source in monitoring_sources(ticker):
        if source["url"] == url:
            return source
    return {}


def fetch(url, ticker):
    url = safe_url(url, ticker)
    with _FETCH_CACHE_LOCK:
        cached = _FETCH_CACHE.get(url)
    headers = {
        "User-Agent": os.environ.get("RESEARCH_USER_AGENT", "TechPhaseResearch-SourceCheck/0.1"),
        "Accept": "application/json,application/rss+xml,application/atom+xml,text/html,application/pdf",
    }
    source = source_configuration(url, ticker)
    request_body = source.get("requestJson")
    data = None
    if request_body is not None:
        data = json.dumps(request_body, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
    if cached and cached.get("etag"):
        headers["If-None-Match"] = cached["etag"]
    if cached and cached.get("last_modified"):
        headers["If-Modified-Since"] = cached["last_modified"]
    req = Request(url, headers=headers, data=data, method="POST" if data is not None else "GET")
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


class ArticleText(HTMLParser):
    """Extract readable evidence text without retaining scripts or page chrome."""

    ignored = {"script", "style", "noscript", "svg", "nav", "footer", "form", "button"}
    blocks = {"title", "h1", "h2", "h3", "h4", "p", "li", "blockquote", "figcaption", "td", "th", "time"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.ignored:
            self.ignored_depth += 1
            return
        if self.ignored_depth:
            return
        if tag == "meta":
            values = {key.lower(): value for key, value in attrs if key and value}
            name = (values.get("name") or values.get("property") or "").lower()
            if name in {"description", "og:description", "twitter:description"}:
                self.parts.extend(["\n", values.get("content", ""), "\n"])
        elif tag in self.blocks or tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.ignored:
            self.ignored_depth = max(0, self.ignored_depth - 1)
            return
        if not self.ignored_depth and tag in self.blocks:
            self.parts.append("\n")

    def handle_data(self, value):
        if not self.ignored_depth:
            self.parts.append(value)

    def result(self):
        lines, previous = [], None
        for part in "".join(self.parts).splitlines():
            line = " ".join(part.split())
            if line and line != previous:
                lines.append(line)
                previous = line
        return "\n".join(lines)[:MAX_EXTRACTED_CHARS]


def extract_text(content, content_type):
    """Return bounded plain text for later evidence-grounded editorial work."""
    if content_type == "text/html":
        parser = ArticleText()
        parser.feed(content.decode("utf-8", errors="replace"))
        parser.close()
        return parser.result()
    if content_type in {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}:
        if b"\x00" in content or re.search(br"<!\s*(DOCTYPE|ENTITY)", content, re.I):
            raise ValueError("XML declarations with entities are not supported")
        return "\n".join(" ".join(text.split()) for text in ET.fromstring(content).itertext() if text.strip())[:MAX_EXTRACTED_CHARS]
    if content_type == "application/json":
        return json.dumps(json.loads(content), ensure_ascii=False, separators=(",", ":"))[:MAX_EXTRACTED_CHARS]
    return ""


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


def sitemap_links(body, ticker):
    """Extract approved article URLs from a first-party XML sitemap."""
    if b"\x00" in body or re.search(br"<!\s*(DOCTYPE|ENTITY)", body, re.I):
        raise ValueError("XML declarations with entities are not supported")
    root = ET.fromstring(body)
    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    links = {}
    for item in root.findall(namespace + "url"):
        canonical = article_url(item.findtext(namespace + "loc") or "", ticker)
        if canonical:
            links[canonical] = None
    return links


def news_json_links(body, ticker, source):
    """Parse a first-party page's public JSON result shape."""
    data = json.loads(body)
    items = data.get(source.get("itemsKey", "items"), [])
    if not isinstance(items, list):
        raise ValueError("Invalid news JSON structure")
    links = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        value = item.get(source.get("urlKey", "pageUrl"))
        canonical = article_url(urljoin(source["url"], value or ""), ticker)
        if not canonical:
            continue
        title = item.get(source.get("titleKey", "displayName"))
        links[canonical] = " ".join(unescape(title).split())[:300] if isinstance(title, str) and title.strip() else None
    return links


def roc_date(value):
    """Convert a strict seven-digit Minguo date to ISO without guessing."""
    if not re.fullmatch(r"\d{7}", value or ""):
        raise ValueError("Invalid TWSE material-information date")
    year = int(value[:3]) + 1911
    parsed = datetime.strptime(f"{year:04d}{value[3:]}", "%Y%m%d")
    return parsed.strftime("%Y-%m-%d")


def twse_material_links(body, ticker, source):
    """Extract one company's official material disclosures with inline evidence."""
    data = json.loads(body)
    if not isinstance(data, list):
        raise ValueError("Invalid TWSE material-information structure")
    company_code = source.get("twseCompanyCode")
    if not re.fullmatch(r"\d{4,6}", company_code or ""):
        raise ValueError("Invalid TWSE company code")
    links = {}
    for item in data:
        if not isinstance(item, dict) or item.get("公司代號") != company_code:
            continue
        spoken_date = item.get("發言日期", "")
        spoken_time = item.get("發言時間", "")
        subject = item.get("主旨 ", "")
        explanation = item.get("說明", "")
        if not re.fullmatch(r"\d{1,6}", spoken_time) or not isinstance(subject, str) or not subject.strip():
            raise ValueError("Incomplete TWSE material-information record")
        published_on = roc_date(spoken_date)
        subject = " ".join(subject.split())[:300]
        explanation = "\n".join(line.strip() for line in str(explanation).splitlines() if line.strip())
        evidence = "\n".join([
            f"公司代號: {company_code}",
            f"公司名稱: {' '.join(str(item.get('公司名稱', '')).split())}",
            f"發言日期: {spoken_date}",
            f"發言時間: {spoken_time}",
            f"主旨: {subject}",
            f"說明: {explanation}",
        ])[:MAX_EXTRACTED_CHARS]
        identity = hashlib.sha256(evidence.encode()).hexdigest()[:16]
        query = urlencode({"company": company_code, "date": spoken_date, "time": spoken_time, "id": identity})
        url = safe_url(source["url"] + "?" + query, ticker)
        links[url] = {
            "title": subject,
            "publishedOn": published_on,
            "inlineText": evidence,
            "contentBytes": len(json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode()),
        }
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
    CREATE TABLE IF NOT EXISTS briefs (
      url TEXT PRIMARY KEY REFERENCES sources(url), source_sha256 TEXT NOT NULL,
      summary_ja TEXT NOT NULL, impact_label TEXT NOT NULL, impact_ja TEXT NOT NULL,
      confidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      generated_at TEXT NOT NULL, reviewed_at TEXT, reviewer TEXT, review_reason TEXT);
    CREATE TABLE IF NOT EXISTS brief_evidence (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES briefs(url) ON DELETE CASCADE,
      field TEXT NOT NULL, excerpt TEXT NOT NULL);
    """)
    if "index_url" not in {row[1] for row in db.execute("PRAGMA table_info(discovery_runs)")}:
        db.execute("ALTER TABLE discovery_runs ADD COLUMN index_url TEXT")
    if "title" not in {row[1] for row in db.execute("PRAGMA table_info(sources)")}:
        db.execute("ALTER TABLE sources ADD COLUMN title TEXT")
    source_columns = {row[1] for row in db.execute("PRAGMA table_info(sources)")}
    migrations = {
        "content_type": "TEXT",
        "content_bytes": "INTEGER",
        "extracted_text": "TEXT",
        "extracted_chars": "INTEGER NOT NULL DEFAULT 0",
        "fetched_at": "TEXT",
        "fetch_failures": "INTEGER NOT NULL DEFAULT 0",
        "next_fetch_at": "TEXT",
        "source_mode": "TEXT NOT NULL DEFAULT 'remote'",
    }
    for column, declaration in migrations.items():
        if column not in source_columns:
            db.execute(f"ALTER TABLE sources ADD COLUMN {column} {declaration}")
    brief_columns = {row[1] for row in db.execute("PRAGMA table_info(briefs)")}
    for column, declaration in {
        "generation_provider": "TEXT", "generation_model": "TEXT", "generation_response_id": "TEXT",
        "generation_source_truncated": "INTEGER NOT NULL DEFAULT 0",
    }.items():
        if column not in brief_columns:
            db.execute(f"ALTER TABLE briefs ADD COLUMN {column} {declaration}")
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
    primary = {"url": INDEXES[ticker], "format": provider["format"], "route": "primary"}
    for key in ("requestJson", "itemsKey", "urlKey", "titleKey", "twseCompanyCode", "allowEmpty"):
        if key in provider:
            primary[key] = provider[key]
    sources = [primary] + [
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
    if source["format"] == "sitemap":
        return sitemap_links(body, ticker)
    if source["format"] == "news-json":
        if kind != "application/json":
            raise ValueError("News endpoint is not JSON")
        return news_json_links(body, ticker, source)
    if source["format"] == "twse-material-json":
        if kind != "application/json":
            raise ValueError("TWSE material-information source is not JSON")
        return twse_material_links(body, ticker, source)
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
            if not links and not source.get("allowEmpty"):
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
    for url, candidate in links.items():
        detail = candidate if isinstance(candidate, dict) else {"title": candidate}
        add_source(db, ticker, url, published_on=detail.get("publishedOn"), title=detail.get("title"))
        if detail.get("inlineText") is not None:
            with db:
                db.execute("UPDATE sources SET source_mode='inline' WHERE url=?", (url,))
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            text = detail["inlineText"]
            save_source_check(db, row, {
                "sha256": hashlib.sha256(text.encode()).hexdigest(),
                "contentType": "application/json",
                "contentBytes": detail.get("contentBytes", len(text.encode())),
                "extractedText": text,
                "extractedChars": len(text),
            })
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
        sources = [dict(r) for r in db.execute("""
          SELECT url,ticker,title,published_on,discovered_at,checked_at,sha256,status,error,
                 content_type,content_bytes,extracted_chars,fetched_at
          FROM sources ORDER BY ticker,url
        """)]
        history = [dict(r) for r in db.execute("SELECT id,url,at,kind,sha256 FROM history ORDER BY id DESC")]
        runs = [dict(r) for r in db.execute("SELECT id,ticker,at,status,candidates,error,index_url FROM discovery_runs ORDER BY id DESC")]
        events = [dict(r) for r in db.execute("""
          SELECT e.id,e.url,e.ticker,e.detected_at,s.title,s.published_on,
                 s.fetched_at AS body_fetched_at
          FROM release_events e JOIN sources s ON s.url=e.url
          ORDER BY e.id DESC LIMIT 200
        """)]
        briefs = [dict(r) for r in db.execute("""
          SELECT url,source_sha256,summary_ja,impact_label,impact_ja,confidence,status,
                 generated_at,reviewed_at
          FROM briefs WHERE status='approved' ORDER BY reviewed_at DESC
        """)]
    for row in sources + runs:
        row["error"] = public_error(row["error"])
    for row in sources:
        safe_url(row["url"], row["ticker"])
    for row in events:
        row["detection_to_body_ms"] = None
        if row["body_fetched_at"]:
            detected = datetime.fromisoformat(row["detected_at"])
            fetched = datetime.fromisoformat(row["body_fetched_at"])
            if fetched >= detected:
                row["detection_to_body_ms"] = round((fetched - detected).total_seconds() * 1000)
    return {"schemaVersion": 1, "generatedAt": now(), "sources": sources, "history": history, "discoveryRuns": runs, "events": events, "briefs": briefs}


def private_brief_queue(db, limit=20):
    """Return bounded source evidence for the authenticated editorial interface only."""
    limit = max(1, min(int(limit), 50))
    rows = [dict(row) for row in db.execute("""
      SELECT s.url,s.ticker,s.title,s.published_on,s.discovered_at,s.checked_at,s.sha256,
             s.extracted_text,s.extracted_chars,e.detected_at,
             b.summary_ja,b.impact_label,b.impact_ja,b.confidence,b.status AS brief_status,
             b.generated_at,b.reviewed_at,b.reviewer,b.review_reason,
             b.generation_provider,b.generation_model,b.generation_response_id,b.generation_source_truncated
      FROM sources s
      LEFT JOIN release_events e ON e.url=s.url
      LEFT JOIN briefs b ON b.url=s.url
      WHERE s.sha256 IS NOT NULL AND s.error IS NULL AND s.extracted_chars>0
      ORDER BY e.detected_at IS NULL,e.detected_at DESC,s.discovered_at DESC,s.url
      LIMIT ?
    """, (limit,))]
    for row in rows:
        evidence = db.execute(
            "SELECT field,excerpt FROM brief_evidence WHERE url=? ORDER BY id", (row["url"],)
        ).fetchall()
        row["evidence"] = {
            "summary": [item["excerpt"] for item in evidence if item["field"] == "summary"],
            "impact": [item["excerpt"] for item in evidence if item["field"] == "impact"],
        }
        text = row.pop("extracted_text") or ""
        row["source_text"] = text[:80_000]
        row["source_text_truncated"] = len(text) > 80_000
    return {"generatedAt": now(), "items": rows}


def write_snapshot(db, output):
    """Replace a public snapshot atomically so readers never observe partial JSON."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    data = snapshot(db)
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(output)
    return data


def collect_source(row, transport=fetch):
    """Fetch and extract one source without mutating SQLite, safe for worker threads."""
    content, content_type = transport(row["url"], row["ticker"])
    extracted = extract_text(content, content_type)
    return {
        "sha256": hashlib.sha256(content).hexdigest(),
        "contentType": content_type,
        "contentBytes": len(content),
        "extractedText": extracted,
        "extractedChars": len(extracted),
    }


def save_source_check(db, row, result):
    checked_at = now()
    next_fetch_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(timespec="milliseconds")
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT * FROM sources WHERE url=?", (row["url"],)).fetchone()
        if not current:
            raise ValueError("Source disappeared before its fetch result was saved")
        changed = result["sha256"] != current["sha256"]
        if changed:
            db.execute(
                "INSERT INTO history(url,at,kind,sha256,reason) VALUES(?,?,?,?,?)",
                (row["url"], checked_at, "changed" if current["sha256"] else "first-fetch", result["sha256"], "Raw response changed; editorial correction not established"),
            )
            db.execute(
                "UPDATE briefs SET status='stale',reviewed_at=NULL,reviewer=NULL,review_reason=NULL WHERE url=?",
                (row["url"],),
            )
        db.execute("""
          UPDATE sources
          SET sha256=?,checked_at=?,fetched_at=?,error=NULL,status=?,content_type=?,content_bytes=?,
              extracted_text=?,extracted_chars=?,fetch_failures=0,next_fetch_at=?
          WHERE url=?
        """, (
            result["sha256"], checked_at, checked_at, "pending" if changed else current["status"],
            result["contentType"], result["contentBytes"], result["extractedText"],
            result["extractedChars"], next_fetch_at, row["url"],
        ))
    status = "first-fetched" if not current["sha256"] else ("changed" if changed else "unchanged")
    return {"url": row["url"], "status": status, "extractedChars": result["extractedChars"]}


def save_source_error(db, row, exc):
    checked_at = now()
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT fetch_failures FROM sources WHERE url=?", (row["url"],)).fetchone()
        if not current:
            raise ValueError("Source disappeared before its fetch error was saved")
        failures = current["fetch_failures"] + 1
        retry_seconds = min(6 * 60 * 60, 60 * (2 ** min(failures - 1, 8)))
        next_fetch_at = (datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)).isoformat(timespec="milliseconds")
        db.execute(
            "UPDATE sources SET checked_at=?,error=?,fetch_failures=?,next_fetch_at=? WHERE url=?",
            (checked_at, str(exc), failures, next_fetch_at, row["url"]),
        )
        db.execute("INSERT INTO history(url,at,kind,reason) VALUES(?,?,?,?)", (row["url"], checked_at, "fetch-error", str(exc)))
    return {"url": row["url"], "status": "error", "retrySeconds": retry_seconds, "error": str(exc)}


def check_source(db, row, transport=fetch):
    try:
        return save_source_check(db, row, collect_source(row, transport))
    except Exception as exc:
        return save_source_error(db, row, exc)


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


def save_brief_draft(db, url, expected_sha, summary_ja, impact_label, impact_ja, confidence, evidence):
    """Save a private evidence-bound draft; never publish it without a later review."""
    summary_ja, impact_ja = summary_ja.strip(), impact_ja.strip()
    if not 20 <= len(summary_ja) <= 600 or not 20 <= len(impact_ja) <= 900:
        raise ValueError("Japanese summary and impact must be concise but substantive")
    if not re.search(r"[ぁ-んァ-ヶ一-龯]", summary_ja + impact_ja):
        raise ValueError("Summary and impact must contain Japanese text")
    if impact_label not in {"positive", "negative", "mixed", "neutral", "uncertain"}:
        raise ValueError("Invalid impact label")
    if confidence not in {"low", "medium", "high"}:
        raise ValueError("Invalid confidence")
    if not isinstance(evidence, dict) or any(not evidence.get(field) for field in ("summary", "impact")):
        raise ValueError("Summary and impact evidence are required")
    row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
    if not row or not row["sha256"] or row["sha256"] != expected_sha or row["error"] or not row["extracted_text"]:
        raise ValueError("Source is missing, changed, failed, or has no extracted evidence")
    cleaned = []
    for field in ("summary", "impact"):
        for excerpt in evidence[field]:
            excerpt = " ".join(str(excerpt).split())
            if not 12 <= len(excerpt) <= 800 or excerpt not in row["extracted_text"]:
                raise ValueError("Every evidence excerpt must appear exactly in the current source text")
            cleaned.append((field, excerpt))
    cited = " ".join(excerpt for _, excerpt in cleaned)
    for token in re.findall(r"([$€£¥₩]?\d[\d,.]*%?)(?:億|万|兆|倍|年|月|日)?", summary_ja + " " + impact_ja):
        if token not in cited:
            raise ValueError("Every numeric claim must appear in the cited evidence")
    generated_at = now()
    with db:
        db.execute("""
          INSERT INTO briefs(url,source_sha256,summary_ja,impact_label,impact_ja,confidence,status,generated_at,reviewed_at,reviewer,review_reason)
          VALUES(?,?,?,?,?,?,'draft',?,NULL,NULL,NULL)
          ON CONFLICT(url) DO UPDATE SET source_sha256=excluded.source_sha256,
            summary_ja=excluded.summary_ja,impact_label=excluded.impact_label,
            impact_ja=excluded.impact_ja,confidence=excluded.confidence,status='draft',
            generated_at=excluded.generated_at,reviewed_at=NULL,reviewer=NULL,review_reason=NULL
        """, (url, expected_sha, summary_ja, impact_label, impact_ja, confidence, generated_at))
        db.execute("DELETE FROM brief_evidence WHERE url=?", (url,))
        db.execute("""
          UPDATE briefs SET generation_provider=NULL,generation_model=NULL,generation_response_id=NULL,
                            generation_source_truncated=0 WHERE url=?
        """, (url,))
        db.executemany("INSERT INTO brief_evidence(url,field,excerpt) VALUES(?,?,?)", [(url, field, excerpt) for field, excerpt in cleaned])
    return {"url": url, "status": "draft", "generatedAt": generated_at, "published": False}


def review_brief(db, url, expected_sha, decision, reviewer, reason):
    """Record the mandatory human decision for the current source revision."""
    if decision not in {"approved", "held", "rejected"} or not reviewer.strip() or not reason.strip():
        raise ValueError("Decision, reviewer, and reason are required")
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""
          SELECT b.*,s.sha256 AS current_sha,s.error AS source_error
          FROM briefs b JOIN sources s ON s.url=b.url WHERE b.url=?
        """, (url,)).fetchone()
        evidence_count = db.execute("SELECT count(*) FROM brief_evidence WHERE url=?", (url,)).fetchone()[0]
        if not row or row["source_sha256"] != expected_sha or row["current_sha"] != expected_sha or row["source_error"] or evidence_count < 2:
            raise ValueError("Draft evidence is missing or the official source changed; regenerate before review")
        db.execute(
            "UPDATE briefs SET status=?,reviewed_at=?,reviewer=?,review_reason=? WHERE url=?",
            (decision, now(), reviewer.strip(), reason.strip(), url),
        )
    return {"url": url, "status": decision, "published": False}


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
    brief = sub.add_parser("draft-brief")
    brief.add_argument("url")
    brief.add_argument("sha256")
    brief.add_argument("--summary-ja", required=True)
    brief.add_argument("--impact-label", required=True, choices=["positive", "negative", "mixed", "neutral", "uncertain"])
    brief.add_argument("--impact-ja", required=True)
    brief.add_argument("--confidence", required=True, choices=["low", "medium", "high"])
    brief.add_argument("--summary-evidence", required=True, action="append")
    brief.add_argument("--impact-evidence", required=True, action="append")
    brief_review = sub.add_parser("review-brief")
    brief_review.add_argument("url")
    brief_review.add_argument("sha256")
    brief_review.add_argument("decision", choices=["approved", "held", "rejected"])
    brief_review.add_argument("--reviewer", required=True)
    brief_review.add_argument("--reason", required=True)
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
        elif args.command == "draft-brief":
            result = save_brief_draft(db, args.url, args.sha256, args.summary_ja, args.impact_label,
                                      args.impact_ja, args.confidence,
                                      {"summary": args.summary_evidence, "impact": args.impact_evidence})
        elif args.command == "review-brief":
            result = review_brief(db, args.url, args.sha256, args.decision, args.reviewer, args.reason)
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
