"""Official-source research intake. No scheduler, summarization, or publishing side effects."""
import argparse
import difflib
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html.parser import HTMLParser
from html import unescape
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import threading

ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = {p["ticker"]: p for p in json.loads((ROOT / "lib/research/providers.json").read_text())}
INDEXES = {t: p.get("monitorUrl", p["indexUrl"]) for t, p in PROVIDERS.items()}
HOSTS = {t: set(p["allowedHosts"]) for t, p in PROVIDERS.items()}
MAX_BYTES = 12 * 1024 * 1024
MAX_EXTRACTED_CHARS = 160_000
MAX_JSON_LD_CHARS = 512 * 1024
MAX_JSON_LD_BLOCKS = 20
MAX_JSON_LD_NODES = 2_000
MIN_JSON_LD_BODY_CHARS = 120
SUPPORTED_CONTENT_TYPES = {
    "text/html", "application/pdf", "application/json", "application/rss+xml",
    "application/atom+xml", "application/xml", "text/xml",
}
PDF_FALLBACK_CONTENT_TYPES = {"application/octet-stream", "application/x-pdf"}
FETCH_CACHE_MAX_ENTRIES = 64
FETCH_CACHE_MAX_BYTES = 24 * 1024 * 1024
_FETCH_CACHE = {}
_FETCH_CACHE_LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def environment_seconds(name, default, minimum, maximum):
    """Read a bounded interval without letting a bad deployment value stop monitoring."""
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def source_check_is_fresh(checked_at, reference=None):
    """Require a recent successful source check before review or public preview."""
    try:
        checked = datetime.fromisoformat(str(checked_at).replace("Z", "+00:00"))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        checked = checked.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return False
    current = reference or datetime.now(timezone.utc)
    maximum_age = environment_seconds(
        "RESEARCH_REVIEW_SOURCE_MAX_AGE_SECONDS", 8 * 60 * 60, 5 * 60, 24 * 60 * 60
    )
    age = (current - checked).total_seconds()
    return -5 * 60 <= age <= maximum_age


def successful_recheck_seconds(db, url, changed, had_previous_hash, checked_at):
    """Keep recent releases hot while avoiding perpetual historical refetches."""
    background = environment_seconds(
        "RESEARCH_BODY_RECHECK_SECONDS", 6 * 60 * 60, 15 * 60, 7 * 24 * 60 * 60
    )
    hot = environment_seconds("RESEARCH_HOT_BODY_RECHECK_SECONDS", 15 * 60, 60, background)
    hot_window = environment_seconds(
        "RESEARCH_HOT_EVENT_WINDOW_SECONDS", 24 * 60 * 60, hot, 7 * 24 * 60 * 60
    )
    if changed and had_previous_hash:
        return hot
    event = db.execute("SELECT detected_at FROM release_events WHERE url=?", (url,)).fetchone()
    if event:
        try:
            detected = datetime.fromisoformat(event["detected_at"].replace("Z", "+00:00"))
            checked = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
            if 0 <= (checked - detected).total_seconds() <= hot_window:
                return hot
        except (TypeError, ValueError):
            pass
    return background


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


def http_validator(value):
    """Keep only bounded single-line HTTP validators safe to reuse as headers."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 1024 or "\r" in value or "\n" in value:
        return None
    return value


def cached_fetch(url):
    """Return and refresh a bounded discovery-response cache entry."""
    with _FETCH_CACHE_LOCK:
        cached = _FETCH_CACHE.pop(url, None)
        if cached is not None:
            _FETCH_CACHE[url] = cached
        return cached


def remember_fetch(url, cached):
    """Keep discovery bodies for 304 reuse without unbounded process memory growth."""
    with _FETCH_CACHE_LOCK:
        _FETCH_CACHE.pop(url, None)
        _FETCH_CACHE[url] = cached
        cached_bytes = sum(len(item.get("content", b"")) for item in _FETCH_CACHE.values())
        while _FETCH_CACHE and (
            len(_FETCH_CACHE) > FETCH_CACHE_MAX_ENTRIES
            or cached_bytes > FETCH_CACHE_MAX_BYTES
        ):
            oldest_url = next(iter(_FETCH_CACHE))
            removed = _FETCH_CACHE.pop(oldest_url)
            cached_bytes -= len(removed.get("content", b""))


def fetch_cache_stats():
    """Expose only aggregate cache pressure, never cached URLs or response bodies."""
    with _FETCH_CACHE_LOCK:
        return {
            "entries": len(_FETCH_CACHE),
            "bytes": sum(len(item.get("content", b"")) for item in _FETCH_CACHE.values()),
            "maxEntries": FETCH_CACHE_MAX_ENTRIES,
            "maxBytes": FETCH_CACHE_MAX_BYTES,
        }


def source_error_code(exc):
    """Reduce transport failures to bounded operational codes without leaking URLs."""
    if isinstance(exc, HTTPError) and 400 <= exc.code <= 599:
        return f"http-{exc.code}"
    if isinstance(exc, (TimeoutError,)) or (
        isinstance(exc, URLError) and isinstance(exc.reason, TimeoutError)
    ):
        return "timeout"
    message = str(exc)
    http_code = re.search(r"\bHTTP(?: Error)?\s+(\d{3})\b", message, re.I)
    if http_code and 400 <= int(http_code.group(1)) <= 599:
        return f"http-{http_code.group(1)}"
    if isinstance(exc, ValueError):
        lowered = message.lower()
        for fragment, code in (
            ("unsupported content type", "unsupported-content-type"),
            ("empty or oversized source", "empty-or-oversized-source"),
            ("source has no extractable text", "no-extractable-text"),
            ("pdf is encrypted", "pdf-encrypted"),
            ("pdf page limit exceeded", "pdf-page-limit"),
            ("pdf has no extractable text", "pdf-no-text"),
            ("pdf text extraction timed out", "pdf-timeout"),
            ("pdf text extraction failed", "pdf-extract-failed"),
            ("invalid pdf", "invalid-pdf"),
            ("verification page", "verification-page"),
            ("no release links parsed", "no-release-links"),
            ("too many source links", "too-many-source-links"),
        ):
            if fragment in lowered:
                return code
        return "invalid-source-response"
    return "fetch-failed"


def retry_after_seconds(exc, reference=None):
    """Parse a server Retry-After hint and cap it to the body-fetch backoff ceiling."""
    if not isinstance(exc, HTTPError) or not exc.headers:
        return None
    value = str(exc.headers.get("Retry-After", "")).strip()
    if not value:
        return None
    if value.isdigit():
        seconds = int(value)
    else:
        try:
            target = parsedate_to_datetime(value)
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            seconds = round((target - (reference or datetime.now(timezone.utc))).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0, min(6 * 60 * 60, seconds))


def fetch(url, ticker, validators=None, include_metadata=False):
    url = safe_url(url, ticker)
    cached = cached_fetch(url)
    conditional = dict(validators or {})
    if cached:
        for key in ("etag", "last_modified"):
            if cached.get(key):
                conditional[key] = cached[key]
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
    etag = http_validator(conditional.get("etag"))
    last_modified = http_validator(conditional.get("last_modified"))
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    req = Request(url, headers=headers, data=data, method="POST" if data is not None else "GET")
    timeout = PROVIDERS[ticker].get("requestTimeoutSeconds", 20) if url == INDEXES[ticker] else 20
    timeout = environment_seconds("RESEARCH_REQUEST_TIMEOUT_SECONDS", timeout, 1, timeout)
    try:
        response = build_opener(Redirects(ticker)).open(req, timeout=timeout)
    except HTTPError as exc:
        if exc.code == 304 and include_metadata and (etag or last_modified):
            error_headers = exc.headers or {}
            return {
                "content": None, "contentType": None,
                "etag": http_validator(error_headers.get("ETag")) or etag,
                "lastModified": http_validator(error_headers.get("Last-Modified")) or last_modified,
                "notModified": True,
            }
        if exc.code == 304 and cached:
            return cached["content"], cached["content_type"]
        raise
    with response:
        content_type = response.headers.get_content_type()
        if content_type not in SUPPORTED_CONTENT_TYPES | PDF_FALLBACK_CONTENT_TYPES:
            raise ValueError("Unsupported content type: " + content_type)
        content = response.read(MAX_BYTES + 1)
        if not content or len(content) > MAX_BYTES:
            raise ValueError("Empty or oversized source")
        if content_type in PDF_FALLBACK_CONTENT_TYPES:
            if not content.startswith(b"%PDF-"):
                raise ValueError("Unsupported content type: " + content_type)
            content_type = "application/pdf"
        if content_type == "application/pdf" and not content.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF response")
        if content_type == "text/html":
            title = re.search(br"<title[^>]*>(.*?)</title>", content, re.I | re.S)
            if title and re.search(br"access denied|just a moment|page not found|403 forbidden", title.group(1), re.I):
                raise ValueError("Source returned an error or verification page")
        response_etag = http_validator(response.headers.get("ETag"))
        response_last_modified = http_validator(response.headers.get("Last-Modified"))
        if not include_metadata:
            remember_fetch(url, {
                "content": content,
                "content_type": content_type,
                "etag": response_etag,
                "last_modified": response_last_modified,
            })
        if include_metadata:
            return {
                "content": content, "contentType": content_type,
                "etag": response_etag, "lastModified": response_last_modified,
                "notModified": False,
            }
        return content, content_type


fetch.supports_persistent_validators = True


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

    ignored = {
        "script", "style", "noscript", "template", "svg", "canvas", "iframe",
        "header", "nav", "aside", "footer", "form", "button", "dialog", "menu",
    }
    ignored_roles = {"banner", "complementary", "contentinfo", "dialog", "navigation"}
    ignored_tokens = {
        "breadcrumb", "breadcrumbs", "consent", "cookie", "cookies", "modal",
        "newsletter", "promo", "related", "share", "sharing", "social", "subscribe",
    }
    void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    blocks = {"title", "h1", "h2", "h3", "h4", "p", "li", "blockquote", "figcaption", "td", "th", "time"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored_stack = []

    def _is_page_chrome(self, tag, attrs):
        values = {
            str(key).lower(): "" if value is None else str(value)
            for key, value in attrs if key
        }
        if tag in self.ignored or "hidden" in values or "data-nosnippet" in values:
            return True
        if values.get("aria-hidden", "").lower() == "true":
            return True
        if values.get("role", "").lower() in self.ignored_roles:
            return True
        style = values.get("style", "").lower()
        if re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", style):
            return True
        tokens = set(re.split(r"[^a-z0-9]+", " ".join([
            values.get("id", ""), values.get("class", "")
        ]).lower()))
        return bool(tokens & self.ignored_tokens)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.ignored_stack:
            if tag not in self.void_tags:
                self.ignored_stack.append(tag)
            return
        if self._is_page_chrome(tag, attrs):
            if tag not in self.void_tags:
                self.ignored_stack.append(tag)
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
        if self.ignored_stack:
            if tag in self.ignored_stack:
                last = len(self.ignored_stack) - 1 - self.ignored_stack[::-1].index(tag)
                del self.ignored_stack[last:]
            return
        if tag in self.blocks:
            self.parts.append("\n")

    def handle_data(self, value):
        if not self.ignored_stack:
            self.parts.append(value)

    def result(self):
        lines, previous = [], None
        for part in "".join(self.parts).splitlines():
            line = " ".join(part.split())
            if line and line != previous:
                lines.append(line)
                previous = line
        return "\n".join(lines)[:MAX_EXTRACTED_CHARS]


class StructuredArticleText(HTMLParser):
    """Read bounded Schema.org articleBody values without executing page scripts."""

    article_types = {
        "analysisnewsarticle", "article", "blogposting", "newsarticle", "report",
        "techarticle",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.blocks_seen = 0
        self.current = None
        self.current_chars = 0
        self.current_overflow = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script" or self.current is not None:
            return
        values = {
            str(key).lower(): "" if value is None else str(value)
            for key, value in attrs if key
        }
        content_type = values.get("type", "").split(";", 1)[0].strip().lower()
        if content_type == "application/ld+json" and self.blocks_seen < MAX_JSON_LD_BLOCKS:
            self.blocks_seen += 1
            self.current = []
            self.current_chars = 0
            self.current_overflow = False

    def handle_data(self, value):
        if self.current is None or self.current_overflow:
            return
        self.current_chars += len(value)
        if self.current_chars > MAX_JSON_LD_CHARS:
            self.current = []
            self.current_overflow = True
            return
        self.current.append(value)

    def handle_endtag(self, tag):
        if tag.lower() != "script" or self.current is None:
            return
        if not self.current_overflow:
            self.blocks.append("".join(self.current))
        self.current = None
        self.current_chars = 0
        self.current_overflow = False

    @staticmethod
    def _schema_type(value):
        if not isinstance(value, str):
            return ""
        return re.split(r"[/#]", value.strip().lower())[-1]

    @staticmethod
    def _normalize_body(value):
        if not isinstance(value, str):
            return ""
        lines = [" ".join(line.split()) for line in value.splitlines()]
        return "\n".join(line for line in lines if line)[:MAX_EXTRACTED_CHARS]

    def result(self):
        candidates = []
        nodes_seen = 0
        for block in self.blocks:
            try:
                root = json.loads(block)
            except (TypeError, ValueError, RecursionError):
                continue
            stack = [(root, 0)]
            while stack and nodes_seen < MAX_JSON_LD_NODES:
                node, depth = stack.pop()
                nodes_seen += 1
                if depth > 8:
                    continue
                if isinstance(node, dict):
                    raw_types = node.get("@type", [])
                    if isinstance(raw_types, str):
                        raw_types = [raw_types]
                    types = {self._schema_type(item) for item in raw_types}
                    body = self._normalize_body(node.get("articleBody"))
                    if types & self.article_types:
                        meaningful = sum(character.isalnum() for character in body)
                        if len(body) >= MIN_JSON_LD_BODY_CHARS and meaningful >= 80:
                            candidates.append(body)
                    stack.extend((value, depth + 1) for value in node.values())
                elif isinstance(node, list):
                    stack.extend((value, depth + 1) for value in node)
        return max(candidates, key=len, default="")


def extract_html_text(content):
    """Prefer visible evidence, using verified JSON-LD only for thin page shells."""
    decoded = content.decode("utf-8", errors="replace")
    visible_parser = ArticleText()
    visible_parser.feed(decoded)
    visible_parser.close()
    visible = visible_parser.result()

    structured_parser = StructuredArticleText()
    structured_parser.feed(decoded)
    structured_parser.close()
    structured = structured_parser.result()
    visible_meaningful = sum(character.isalnum() for character in visible)
    if structured and visible_meaningful < 120 and len(structured) >= max(240, len(visible) * 2):
        return structured
    return visible


def extract_pdf_text(content):
    """Extract PDF evidence in a resource-limited child process."""
    timeout = environment_seconds("RESEARCH_PDF_EXTRACT_TIMEOUT_SECONDS", 20, 1, 30)
    child_environment = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONIOENCODING": "utf-8",
    }
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("pdf_extract.py"))],
            input=content, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=False, close_fds=True, env=child_environment, timeout=timeout,
            start_new_session=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("PDF text extraction timed out") from exc
    except OSError as exc:
        raise ValueError("PDF text extraction failed") from exc
    extraction_errors = {
        2: "Invalid PDF response",
        3: "PDF is encrypted",
        4: "PDF page limit exceeded",
        5: "PDF has no extractable text",
    }
    if completed.returncode != 0:
        raise ValueError(extraction_errors.get(
            completed.returncode, "PDF text extraction failed"
        ))
    try:
        extracted = completed.stdout.decode("utf-8")[:MAX_EXTRACTED_CHARS]
    except UnicodeDecodeError as exc:
        raise ValueError("PDF text extraction failed") from exc
    if not extracted:
        raise ValueError("PDF has no extractable text")
    return extracted


def extract_text(content, content_type):
    """Return bounded plain text for later evidence-grounded editorial work."""
    if content_type == "text/html":
        return extract_html_text(content)
    if content_type == "application/pdf":
        return extract_pdf_text(content)
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
    CREATE TABLE IF NOT EXISTS source_revisions (
      url TEXT NOT NULL REFERENCES sources(url), sha256 TEXT NOT NULL,
      observed_at TEXT NOT NULL, content_type TEXT, content_bytes INTEGER,
      extracted_text TEXT NOT NULL, extracted_chars INTEGER NOT NULL,
      PRIMARY KEY(url,sha256));
    CREATE INDEX IF NOT EXISTS source_revisions_url_observed
      ON source_revisions(url,observed_at DESC);
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, at TEXT NOT NULL,
      status TEXT NOT NULL, candidates INTEGER NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS release_events (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE REFERENCES sources(url),
      ticker TEXT NOT NULL, detected_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS briefs (
      url TEXT PRIMARY KEY REFERENCES sources(url), source_sha256 TEXT NOT NULL,
      summary_ja TEXT NOT NULL, impact_label TEXT NOT NULL, impact_ja TEXT NOT NULL,
      confidence TEXT NOT NULL, validation_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      generated_at TEXT NOT NULL, reviewed_at TEXT, reviewer TEXT, review_reason TEXT);
    CREATE TABLE IF NOT EXISTS brief_evidence (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES briefs(url) ON DELETE CASCADE,
      field TEXT NOT NULL, excerpt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS brief_review_history (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES sources(url),
      source_sha256 TEXT NOT NULL, draft_validation_sha256 TEXT,
      decision TEXT NOT NULL CHECK(decision IN ('approved','held','rejected')),
      reviewed_at TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS brief_review_history_url_id
      ON brief_review_history(url,id DESC);
    CREATE TABLE IF NOT EXISTS brief_generation_jobs (
      url TEXT PRIMARY KEY REFERENCES sources(url), source_sha256 TEXT,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
      next_attempt_at TEXT NOT NULL, error_code TEXT,
      reserved_tokens INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS brief_generation_attempts (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES sources(url),
      source_sha256 TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
      outcome TEXT NOT NULL, error_code TEXT,
      reserved_tokens INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER);
    CREATE TABLE IF NOT EXISTS annual_filing_briefs (
      ticker TEXT NOT NULL, accession_number TEXT NOT NULL, source_sha256 TEXT NOT NULL,
      brief_id TEXT NOT NULL, summary_ja TEXT NOT NULL, business_model_ja TEXT NOT NULL,
      risk_points_json TEXT NOT NULL, summary_evidence_ids_json TEXT NOT NULL,
      business_evidence_ids_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
      confidence TEXT NOT NULL, generation_method TEXT NOT NULL,
      validation_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'draft', generated_at TEXT NOT NULL,
      reviewed_at TEXT, reviewer TEXT, review_reason TEXT,
      PRIMARY KEY(ticker,accession_number));
    CREATE TABLE IF NOT EXISTS annual_filing_review_history (
      id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, accession_number TEXT NOT NULL,
      source_sha256 TEXT NOT NULL, draft_validation_sha256 TEXT,
      decision TEXT NOT NULL CHECK(decision IN ('approved','held','rejected')),
      reviewed_at TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT NOT NULL,
      FOREIGN KEY(ticker,accession_number)
        REFERENCES annual_filing_briefs(ticker,accession_number));
    CREATE INDEX IF NOT EXISTS annual_filing_review_history_filing_id
      ON annual_filing_review_history(ticker,accession_number,id DESC);
    CREATE TABLE IF NOT EXISTS operational_incidents (
      incident_key TEXT PRIMARY KEY, category TEXT NOT NULL, subject TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
      status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      revision INTEGER NOT NULL DEFAULT 1,
      opened_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1, last_error_code TEXT);
    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY, incident_key TEXT NOT NULL,
      revision INTEGER NOT NULL, at TEXT NOT NULL,
      event TEXT NOT NULL CHECK(event IN ('opened','resolved')),
      severity TEXT NOT NULL CHECK(severity IN ('warning','critical')), error_code TEXT,
      FOREIGN KEY(incident_key) REFERENCES operational_incidents(incident_key));
    CREATE TABLE IF NOT EXISTS incident_notification_outbox (
      id INTEGER PRIMARY KEY, incident_key TEXT NOT NULL, revision INTEGER NOT NULL,
      transition TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held'
        CHECK(status IN ('held','pending','delivered','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT, delivered_at TEXT, last_error_code TEXT,
      UNIQUE(incident_key, revision, transition),
      FOREIGN KEY(incident_key) REFERENCES operational_incidents(incident_key));
    CREATE INDEX IF NOT EXISTS operational_incidents_status_seen
      ON operational_incidents(status,last_seen_at);
    CREATE INDEX IF NOT EXISTS incident_outbox_status_created
      ON incident_notification_outbox(status,created_at);
    """)
    if "index_url" not in {row[1] for row in db.execute("PRAGMA table_info(discovery_runs)")}:
        db.execute("ALTER TABLE discovery_runs ADD COLUMN index_url TEXT")
    discovery_columns = {row[1] for row in db.execute("PRAGMA table_info(discovery_runs)")}
    discovery_migrations = {
        "source_format": "TEXT",
        "sources_checked": "INTEGER NOT NULL DEFAULT 1",
        "sources_configured": "INTEGER NOT NULL DEFAULT 1",
    }
    for column, declaration in discovery_migrations.items():
        if column not in discovery_columns:
            db.execute(f"ALTER TABLE discovery_runs ADD COLUMN {column} {declaration}")
    if "title" not in {row[1] for row in db.execute("PRAGMA table_info(sources)")}:
        db.execute("ALTER TABLE sources ADD COLUMN title TEXT")
    source_columns = {row[1] for row in db.execute("PRAGMA table_info(sources)")}
    migrations = {
        "content_type": "TEXT",
        "content_bytes": "INTEGER",
        "extracted_text": "TEXT",
        "extracted_chars": "INTEGER NOT NULL DEFAULT 0",
        "body_sha256": "TEXT",
        "raw_sha256": "TEXT",
        "fetched_at": "TEXT",
        "fetch_failures": "INTEGER NOT NULL DEFAULT 0",
        "next_fetch_at": "TEXT",
        "source_mode": "TEXT NOT NULL DEFAULT 'remote'",
        "response_etag": "TEXT",
        "response_last_modified": "TEXT",
    }
    for column, declaration in migrations.items():
        if column not in source_columns:
            db.execute(f"ALTER TABLE sources ADD COLUMN {column} {declaration}")
    for source in db.execute("""
      SELECT url,sha256,extracted_text FROM sources
      WHERE sha256 IS NOT NULL AND extracted_text IS NOT NULL
        AND (body_sha256 IS NULL OR raw_sha256 IS NULL)
    """).fetchall():
        body_sha = hashlib.sha256(source["extracted_text"].encode("utf-8")).hexdigest()
        db.execute("""
          UPDATE sources SET body_sha256=COALESCE(body_sha256,?),
                             raw_sha256=COALESCE(raw_sha256,sha256)
          WHERE url=?
        """, (body_sha, source["url"]))
    brief_columns = {row[1] for row in db.execute("PRAGMA table_info(briefs)")}
    for column, declaration in {
        "validation_sha256": "TEXT",
        "generation_provider": "TEXT", "generation_model": "TEXT", "generation_response_id": "TEXT",
        "generation_source_truncated": "INTEGER NOT NULL DEFAULT 0",
        "generation_input_tokens": "INTEGER", "generation_output_tokens": "INTEGER",
        "generation_total_tokens": "INTEGER",
    }.items():
        if column not in brief_columns:
            db.execute(f"ALTER TABLE briefs ADD COLUMN {column} {declaration}")
    brief_history_columns = {
        row[1] for row in db.execute("PRAGMA table_info(brief_review_history)")
    }
    if "draft_validation_sha256" not in brief_history_columns:
        db.execute(
            "ALTER TABLE brief_review_history ADD COLUMN draft_validation_sha256 TEXT"
        )
    job_columns = {row[1] for row in db.execute("PRAGMA table_info(brief_generation_jobs)")}
    if "reserved_tokens" not in job_columns:
        db.execute("ALTER TABLE brief_generation_jobs ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0")
    attempt_columns = {row[1] for row in db.execute("PRAGMA table_info(brief_generation_attempts)")}
    for column, declaration in {
        "reserved_tokens": "INTEGER NOT NULL DEFAULT 0", "input_tokens": "INTEGER",
        "output_tokens": "INTEGER", "total_tokens": "INTEGER",
    }.items():
        if column not in attempt_columns:
            db.execute(f"ALTER TABLE brief_generation_attempts ADD COLUMN {column} {declaration}")
    annual_columns = {row[1] for row in db.execute("PRAGMA table_info(annual_filing_briefs)")}
    if "validation_sha256" not in annual_columns:
        db.execute("ALTER TABLE annual_filing_briefs ADD COLUMN validation_sha256 TEXT")
    annual_history_columns = {
        row[1] for row in db.execute("PRAGMA table_info(annual_filing_review_history)")
    }
    if "draft_validation_sha256" not in annual_history_columns:
        db.execute(
            "ALTER TABLE annual_filing_review_history ADD COLUMN draft_validation_sha256 TEXT"
        )
    db.commit()
    return db


def _incident_value(value, maximum=80):
    value = " ".join(str(value or "").split())
    if not value or len(value) > maximum or not re.fullmatch(r"[A-Za-z0-9:._-]+", value):
        raise ValueError("invalid-incident-value")
    return value


def record_operational_incident(db, incident_key, category, subject, severity, error_code=None, seen_at=None):
    """Persist an operational fault once and queue only state transitions.

    Notification rows intentionally remain held. A separately authorized sender can
    be added later without losing incidents that occurred during a restart.
    """
    incident_key = _incident_value(incident_key, 120)
    category = _incident_value(category)
    subject = _incident_value(subject)
    if severity not in {"warning", "critical"}:
        raise ValueError("invalid-incident-severity")
    error_code = _incident_value(error_code, 120) if error_code else None
    seen_at = seen_at or now()
    with db:
        row = db.execute(
            "SELECT status,revision,occurrences FROM operational_incidents WHERE incident_key=?",
            (incident_key,),
        ).fetchone()
        if row is None:
            revision, transition = 1, "opened"
            db.execute("""
              INSERT INTO operational_incidents(
                incident_key,category,subject,severity,status,revision,opened_at,last_seen_at,
                occurrences,last_error_code
              ) VALUES(?,?,?,?,?,?,?,?,?,?)
            """, (incident_key, category, subject, severity, "open", revision, seen_at,
                  seen_at, 1, error_code))
        elif row["status"] == "resolved":
            revision, transition = row["revision"] + 1, "opened"
            db.execute("""
              UPDATE operational_incidents SET category=?,subject=?,severity=?,status='open',
                revision=?,opened_at=?,last_seen_at=?,resolved_at=NULL,
                occurrences=occurrences+1,last_error_code=? WHERE incident_key=?
            """, (category, subject, severity, revision, seen_at, seen_at, error_code, incident_key))
        else:
            db.execute("""
              UPDATE operational_incidents SET category=?,subject=?,severity=?,last_seen_at=?,
                occurrences=occurrences+1,last_error_code=? WHERE incident_key=?
            """, (category, subject, severity, seen_at, error_code, incident_key))
            return "ongoing"
        db.execute("""
          INSERT INTO incident_events(incident_key,revision,at,event,severity,error_code)
          VALUES(?,?,?,?,?,?)
        """, (incident_key, revision, seen_at, transition, severity, error_code))
        db.execute("""
          INSERT OR IGNORE INTO incident_notification_outbox(
            incident_key,revision,transition,created_at,status
          ) VALUES(?,?,?,?, 'held')
        """, (incident_key, revision, transition, seen_at))
    return transition


def resolve_operational_incident(db, incident_key, resolved_at=None):
    incident_key = _incident_value(incident_key, 120)
    resolved_at = resolved_at or now()
    with db:
        row = db.execute("""
          SELECT revision,severity FROM operational_incidents
          WHERE incident_key=? AND status='open'
        """, (incident_key,)).fetchone()
        if row is None:
            return False
        db.execute("""
          UPDATE operational_incidents SET status='resolved',resolved_at=?,last_seen_at=?
          WHERE incident_key=?
        """, (resolved_at, resolved_at, incident_key))
        db.execute("""
          INSERT INTO incident_events(incident_key,revision,at,event,severity)
          VALUES(?,?,?,'resolved',?)
        """, (incident_key, row["revision"], resolved_at, row["severity"]))
        db.execute("""
          INSERT OR IGNORE INTO incident_notification_outbox(
            incident_key,revision,transition,created_at,status
          ) VALUES(?,?, 'resolved',?, 'held')
        """, (incident_key, row["revision"], resolved_at))
    return True


def claim_incident_notification(db, activated_at, claimed_at=None, lease_seconds=120):
    """Claim one eligible transition with a retry lease.

    Rows older than the explicit cutover remain held so enabling a destination
    cannot unexpectedly replay the full incident history.
    """
    claimed_at = claimed_at or now()
    try:
        activated = datetime.fromisoformat(activated_at.replace("Z", "+00:00"))
        claimed = datetime.fromisoformat(claimed_at.replace("Z", "+00:00"))
        if activated.tzinfo is None or claimed.tzinfo is None:
            raise ValueError
    except (AttributeError, ValueError) as exc:
        raise ValueError("invalid-notification-time") from exc
    lease_seconds = max(30, min(int(lease_seconds), 900))
    lease_until = (claimed.astimezone(timezone.utc) + timedelta(seconds=lease_seconds)).isoformat(
        timespec="milliseconds"
    )
    with db:
        db.execute("""
          UPDATE incident_notification_outbox
          SET status='pending',next_attempt_at=COALESCE(next_attempt_at,created_at)
          WHERE status='held' AND julianday(created_at)>=julianday(?)
        """, (activated.astimezone(timezone.utc).isoformat(timespec="milliseconds"),))
        row = db.execute("""
          SELECT o.id,o.incident_key,o.revision,o.transition,o.attempts,
                 e.at AS occurred_at,e.severity,e.error_code,
                 i.category,i.subject
          FROM incident_notification_outbox o
          JOIN incident_events e ON e.incident_key=o.incident_key
            AND e.revision=o.revision AND e.event=o.transition
          JOIN operational_incidents i ON i.incident_key=o.incident_key
          WHERE o.status='pending' AND julianday(o.next_attempt_at)<=julianday(?)
          ORDER BY o.created_at,o.id LIMIT 1
        """, (claimed_at,)).fetchone()
        if row is None:
            return None
        attempts = row["attempts"] + 1
        updated = db.execute("""
          UPDATE incident_notification_outbox
          SET attempts=?,next_attempt_at=?
          WHERE id=? AND status='pending' AND attempts=?
        """, (attempts, lease_until, row["id"], row["attempts"])).rowcount
        if updated != 1:
            return None
    return {
        "id": row["id"], "key": row["incident_key"], "revision": row["revision"],
        "transition": row["transition"], "occurredAt": row["occurred_at"],
        "category": row["category"], "subject": row["subject"],
        "severity": row["severity"], "errorCode": row["error_code"],
        "attempts": attempts,
    }


def finish_incident_notification(db, claim, error_code=None, completed_at=None, max_attempts=5):
    completed_at = completed_at or now()
    notification_id = int(claim["id"])
    attempts = int(claim["attempts"])
    max_attempts = max(1, min(int(max_attempts), 20))
    if error_code is None:
        with db:
            updated = db.execute("""
              UPDATE incident_notification_outbox
              SET status='delivered',delivered_at=?,next_attempt_at=NULL,last_error_code=NULL
              WHERE id=? AND status='pending' AND attempts=?
            """, (completed_at, notification_id, attempts)).rowcount
        return "delivered" if updated == 1 else "superseded"
    error_code = _incident_value(error_code, 120)
    terminal = attempts >= max_attempts
    delay = min(6 * 60 * 60, 60 * (5 ** max(0, attempts - 1)))
    try:
        completed = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        if completed.tzinfo is None:
            raise ValueError
    except (AttributeError, ValueError) as exc:
        raise ValueError("invalid-notification-time") from exc
    next_attempt = None if terminal else (
        completed.astimezone(timezone.utc) + timedelta(seconds=delay)
    ).isoformat(timespec="milliseconds")
    with db:
        updated = db.execute("""
          UPDATE incident_notification_outbox
          SET status=?,next_attempt_at=?,last_error_code=?
          WHERE id=? AND status='pending' AND attempts=?
        """, ("dead" if terminal else "pending", next_attempt, error_code,
              notification_id, attempts)).rowcount
    return ("dead" if terminal else "retry") if updated == 1 else "superseded"


def operational_incident_summary(db, limit=20, delivery_enabled=False):
    limit = max(1, min(int(limit), 100))
    rows = db.execute("""
      SELECT incident_key,category,subject,severity,status,revision,opened_at,
             last_seen_at,resolved_at,occurrences,last_error_code
      FROM operational_incidents ORDER BY status='open' DESC,last_seen_at DESC LIMIT ?
    """, (limit,)).fetchall()
    counts = db.execute("""
      SELECT
        sum(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count,
        count(*) AS total_count
      FROM operational_incidents
    """).fetchone()
    outbox = db.execute("""
      SELECT
        sum(CASE WHEN status='held' THEN 1 ELSE 0 END) AS held_count,
        sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count,
        sum(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered_count,
        sum(CASE WHEN status='dead' THEN 1 ELSE 0 END) AS dead_count
      FROM incident_notification_outbox
    """).fetchone()
    return {
        "open": counts["open_count"] or 0,
        "total": counts["total_count"] or 0,
        "heldNotifications": outbox["held_count"] or 0,
        "pendingNotifications": outbox["pending_count"] or 0,
        "deliveredNotifications": outbox["delivered_count"] or 0,
        "deadNotifications": outbox["dead_count"] or 0,
        "deliveryEnabled": bool(delivery_enabled),
        "recent": [{
            "key": row["incident_key"], "category": row["category"],
            "subject": row["subject"], "severity": row["severity"],
            "status": row["status"], "revision": row["revision"],
            "openedAt": row["opened_at"], "lastSeenAt": row["last_seen_at"],
            "resolvedAt": row["resolved_at"], "occurrences": row["occurrences"],
            "errorCode": row["last_error_code"],
        } for row in rows],
    }


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
    sources = monitoring_sources(ticker, automatic=automatic)
    for source in sources:
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
            failures.append(source_error_code(exc))
    if used_source:
        result = {
            "ticker": ticker,
            "status": "ok" if used_source["route"] == "primary" else "fallback",
            "route": used_source["route"],
            "sourceUrl": used_source["url"],
            "sourceFormat": used_source["format"],
            "sourcesChecked": len(failures) + 1,
            "sourcesConfigured": len(sources),
            "candidates": len(links),
            # Automatic monitoring may try a preferred low-latency route before the
            # company's primary page. A recovered primary result is healthy; retain
            # the earlier failure only when an actual fallback route was required.
            "error": failures[0] if failures and used_source["route"] == "fallback" else None,
        }
    else:
        result = {
            "ticker": ticker, "status": "degraded", "route": "none",
            "sourceUrl": INDEXES[ticker], "sourceFormat": "none",
            "sourcesChecked": len(failures), "sourcesConfigured": len(sources),
            "candidates": 0,
            "error": failures[0] if failures else "No monitoring sources configured",
        }
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
        db.execute("""
          INSERT INTO discovery_runs(
            ticker,at,status,candidates,error,index_url,source_format,
            sources_checked,sources_configured
          ) VALUES(?,?,?,?,?,?,?,?,?)
        """, (
            ticker, now(), result["status"], result["candidates"], result["error"],
            result["sourceUrl"], result.get("sourceFormat"),
            result.get("sourcesChecked", 1), result.get("sourcesConfigured", 1),
        ))
    return sorted(set(links) - before)


def add_release_events(db, ticker, urls):
    """Record newly observed URLs once; baseline imports should not call this."""
    detected_at = now()
    inserted = []
    with db:
        for url in urls:
            safe = safe_url(url, ticker)
            cursor = db.execute(
                "INSERT OR IGNORE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)",
                (safe, ticker, detected_at),
            )
            if cursor.rowcount:
                inserted.append(safe)
    return inserted


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
        runs = [dict(r) for r in db.execute("""
          SELECT id,ticker,at,status,candidates,error,index_url,source_format,
                 sources_checked,sources_configured
          FROM discovery_runs ORDER BY id DESC
        """)]
        events = [dict(r) for r in db.execute("""
          SELECT e.id,e.url,e.ticker,e.detected_at,s.title,s.published_on,
                 COALESCE((SELECT MIN(h.at) FROM history h
                           WHERE h.url=s.url AND h.kind='first-fetch'),s.fetched_at) AS body_fetched_at
          FROM release_events e JOIN sources s ON s.url=e.url
          ORDER BY e.id DESC LIMIT 200
        """)]
        brief_rows = [dict(r) for r in db.execute("""
          SELECT b.url,s.ticker,s.title,s.published_on,e.detected_at,b.source_sha256,
                 s.checked_at AS source_checked_at,
                 b.summary_ja,b.impact_label,b.impact_ja,b.confidence,b.status,
                 b.generated_at,b.reviewed_at,b.validation_sha256,s.extracted_text,
                 CASE WHEN b.generation_provider IS NULL THEN 'human'
                      ELSE 'ai-assisted' END AS generation_method
          FROM briefs b JOIN sources s ON s.url=b.url
          LEFT JOIN release_events e ON e.url=b.url
          WHERE b.status='approved' AND b.source_sha256=s.sha256
            AND b.validation_sha256 IS NOT NULL
            AND s.error IS NULL AND s.extracted_chars>0 AND s.checked_at IS NOT NULL
            AND b.reviewed_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM brief_review_history h
              WHERE h.url=b.url AND h.source_sha256=b.source_sha256
                AND h.draft_validation_sha256=b.validation_sha256
                AND h.decision='approved' AND h.reviewed_at=b.reviewed_at
            )
          ORDER BY b.reviewed_at DESC
        """)]
        briefs = []
        for row in brief_rows:
            if not source_check_is_fresh(row["source_checked_at"]):
                continue
            evidence_rows = db.execute(
                "SELECT field,excerpt FROM brief_evidence WHERE url=? ORDER BY id",
                (row["url"],),
            ).fetchall()
            evidence = {
                field: [item["excerpt"] for item in evidence_rows if item["field"] == field]
                for field in ("summary", "impact")
            }
            try:
                summary_ja, impact_ja, cleaned = _validate_brief_payload(
                    row["extracted_text"], row["summary_ja"], row["impact_label"],
                    row["impact_ja"], row["confidence"], evidence,
                )
            except (TypeError, ValueError):
                continue
            validation_sha = _brief_validation_sha(
                row["source_sha256"], summary_ja, row["impact_label"],
                impact_ja, row["confidence"], cleaned,
            )
            if validation_sha != row["validation_sha256"]:
                continue
            row.pop("validation_sha256")
            row.pop("extracted_text")
            row["evidence"] = _public_brief_evidence(evidence)
            briefs.append(row)
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


def private_brief_queue(db, limit=20, review_filter="all"):
    """Return bounded source evidence for the authenticated editorial interface only."""
    limit = max(1, min(int(limit), 50))
    review_filter = str(review_filter).strip().lower()
    if review_filter not in {"all", "ready", "blocked", "needs-draft"}:
        raise ValueError("invalid-review-filter")
    counts = dict(db.execute("""
      SELECT count(*) AS total,
             sum(CASE WHEN b.url IS NULL THEN 1 ELSE 0 END) AS needs_draft,
             sum(CASE WHEN b.status='draft' THEN 1 ELSE 0 END) AS awaiting_review,
             sum(CASE WHEN b.status='stale' THEN 1 ELSE 0 END) AS stale,
             sum(CASE WHEN b.status='held' THEN 1 ELSE 0 END) AS held,
             sum(CASE WHEN b.status='approved' THEN 1 ELSE 0 END) AS approved,
             sum(CASE WHEN b.status='rejected' THEN 1 ELSE 0 END) AS rejected
      FROM sources s LEFT JOIN briefs b ON b.url=s.url
      WHERE s.sha256 IS NOT NULL AND s.error IS NULL AND s.extracted_chars>0
    """).fetchone())
    counts = {key: int(value or 0) for key, value in counts.items()}
    counts.update({"machine_ready": 0, "machine_blocked": 0})
    preflight_candidates = db.execute("""
      SELECT b.*,s.sha256 AS current_sha,s.error AS source_error,
             s.extracted_text AS source_text,s.checked_at AS source_checked_at
      FROM briefs b JOIN sources s ON s.url=b.url
      WHERE s.sha256 IS NOT NULL AND s.error IS NULL AND s.extracted_chars>0
        AND b.status IN ('draft','stale','held','rejected')
    """).fetchall()
    evidence_by_url = {candidate["url"]: [] for candidate in preflight_candidates}
    if evidence_by_url:
        placeholders = ",".join("?" for _ in evidence_by_url)
        for evidence_row in db.execute(f"""
          SELECT url,field,excerpt FROM brief_evidence
          WHERE url IN ({placeholders}) ORDER BY url,id
        """, tuple(evidence_by_url)):
            evidence_by_url[evidence_row["url"]].append(evidence_row)
    preflight_by_url = {}
    for candidate in preflight_candidates:
        result = _brief_preflight_result(
            candidate, evidence_by_url[candidate["url"]], candidate["current_sha"]
        )
        preflight_by_url[candidate["url"]] = result
        counts["machine_ready" if result["ready"] else "machine_blocked"] += 1

    filter_sql = ""
    query_params = []
    if review_filter == "needs-draft":
        filter_sql = "AND b.url IS NULL"
    elif review_filter in {"ready", "blocked"}:
        expected_ready = review_filter == "ready"
        filtered_urls = [
            url for url, result in preflight_by_url.items()
            if result["ready"] is expected_ready
        ]
        if not filtered_urls:
            rows = []
        else:
            placeholders = ",".join("?" for _ in filtered_urls)
            filter_sql = f"AND s.url IN ({placeholders})"
            query_params.extend(filtered_urls)
    if review_filter not in {"ready", "blocked"} or filter_sql:
        query_params.append(limit)
        rows = [dict(row) for row in db.execute(f"""
      SELECT s.url,s.ticker,s.title,s.published_on,s.discovered_at,s.checked_at,s.sha256,
             s.extracted_text,s.extracted_chars,e.detected_at,
             b.source_sha256 AS brief_source_sha256,
             b.summary_ja,b.impact_label,b.impact_ja,b.confidence,b.status AS brief_status,
             b.validation_sha256 AS brief_validation_sha256,
             b.generated_at,b.reviewed_at,b.reviewer,b.review_reason,
             b.generation_provider,b.generation_model,b.generation_response_id,b.generation_source_truncated,
             b.generation_input_tokens,b.generation_output_tokens,b.generation_total_tokens,
             j.status AS generation_job_status,j.attempts AS generation_job_attempts,
             j.next_attempt_at AS generation_job_next_attempt_at,j.error_code AS generation_job_error,
             j.reserved_tokens AS generation_job_reserved_tokens
      FROM sources s
      LEFT JOIN release_events e ON e.url=s.url
      LEFT JOIN briefs b ON b.url=s.url
      LEFT JOIN brief_generation_jobs j ON j.url=s.url
      WHERE s.sha256 IS NOT NULL AND s.error IS NULL AND s.extracted_chars>0
        {filter_sql}
      ORDER BY CASE
                 WHEN b.status='draft' THEN 0
                 WHEN b.status='stale' THEN 1
                 WHEN b.status='held' THEN 2
                 WHEN b.url IS NULL THEN 3
                 WHEN b.status='rejected' THEN 4
                 WHEN b.status='approved' THEN 5
                 ELSE 6
               END,
               e.detected_at IS NULL,e.detected_at DESC,s.discovered_at DESC,s.url
      LIMIT ?
    """, tuple(query_params))]
    for row in rows:
        brief_source_sha = row.pop("brief_source_sha256")
        brief_validation_sha = row.pop("brief_validation_sha256")
        brief_current = bool(brief_source_sha and brief_source_sha == row["sha256"] and row["brief_status"] != "stale")
        row["brief_current"] = brief_current
        row["draft_validation_sha256"] = brief_validation_sha if brief_current else None
        evidence_rows = (db.execute(
            "SELECT field,excerpt FROM brief_evidence WHERE url=? ORDER BY id", (row["url"],)
        ).fetchall() if brief_source_sha else [])
        row["previous_brief"] = _validated_previous_brief(
            db, row, brief_source_sha, brief_validation_sha, evidence_rows
        )
        evidence = evidence_rows if brief_current else []
        row["evidence"] = {
            "summary": [item["excerpt"] for item in evidence if item["field"] == "summary"],
            "impact": [item["excerpt"] for item in evidence if item["field"] == "impact"],
        }
        preflight_row = {
            "source_sha256": brief_source_sha,
            "current_sha": row["sha256"],
            "source_error": None,
            "source_text": row["extracted_text"],
            "source_checked_at": row["checked_at"],
            "summary_ja": row["summary_ja"],
            "impact_label": row["impact_label"],
            "impact_ja": row["impact_ja"],
            "confidence": row["confidence"],
            "validation_sha256": brief_validation_sha,
        }
        row["review_preflight"] = _brief_preflight_result(
            preflight_row, evidence_rows, row["sha256"]
        )
        row["review_history"] = [{
            "source_sha256": item["source_sha256"], "decision": item["decision"],
            "draft_validation_sha256": item["draft_validation_sha256"],
            "reviewed_at": item["reviewed_at"], "reviewer": item["reviewer"],
            "reason": item["reason"], "current_revision": (
                item["source_sha256"] == row["sha256"]
                and item["draft_validation_sha256"] is not None
                and item["draft_validation_sha256"] == brief_validation_sha
            ),
        } for item in db.execute("""
          SELECT source_sha256,draft_validation_sha256,decision,reviewed_at,reviewer,reason
          FROM brief_review_history WHERE url=? ORDER BY id DESC LIMIT 10
        """, (row["url"],))]
        if not brief_current:
            for field in (
                "summary_ja", "impact_label", "impact_ja", "confidence", "generated_at", "reviewed_at",
                "reviewer", "review_reason", "generation_provider", "generation_model",
                "generation_response_id", "generation_input_tokens", "generation_output_tokens",
                "generation_total_tokens",
            ):
                row[field] = None
            row["generation_source_truncated"] = 0
        text = row.pop("extracted_text") or ""
        row["revision_evidence"] = source_revision_evidence(
            db, row["url"], row["sha256"], text
        )
        row["source_text"] = text[:80_000]
        row["source_text_truncated"] = len(text) > 80_000
    filtered_total = {
        "all": counts["total"],
        "ready": counts["machine_ready"],
        "blocked": counts["machine_blocked"],
        "needs-draft": counts["needs_draft"],
    }[review_filter]
    return {
        "generatedAt": now(), "filter": review_filter,
        "filteredTotal": filtered_total, "counts": counts, "items": rows,
    }


def _machine_diff(previous_text, current_text, maximum=6_000):
    """Return a bounded word-level preview; it makes no semantic correction claim."""
    previous_all, current_all = previous_text.split(), current_text.split()
    input_truncated = len(previous_all) > 12_000 or len(current_all) > 12_000
    previous_words, current_words = previous_all[:12_000], current_all[:12_000]
    matcher = difflib.SequenceMatcher(None, previous_words, current_words)
    lines = []
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        if old_start != old_end:
            lines.append("- " + " ".join(
                previous_words[max(0, old_start - 10):min(len(previous_words), old_end + 10)]
            ))
        if new_start != new_end:
            lines.append("+ " + " ".join(
                current_words[max(0, new_start - 10):min(len(current_words), new_end + 10)]
            ))
        if sum(len(line) + 1 for line in lines) >= maximum:
            break
    preview = "\n".join(lines)
    return preview[:maximum], input_truncated or len(preview) > maximum


def source_revision_evidence(db, url, current_sha, current_text):
    """Build private revision evidence from retained official-source text."""
    previous = db.execute("""
      SELECT sha256,observed_at,extracted_text FROM source_revisions
      WHERE url=? AND sha256<>? ORDER BY observed_at DESC,rowid DESC LIMIT 1
    """, (url, current_sha)).fetchone()
    if not previous:
        return None
    preview, truncated = _machine_diff(previous["extracted_text"], current_text)
    return {
        "previous_sha256": previous["sha256"],
        "previous_observed_at": previous["observed_at"],
        "current_sha256": current_sha,
        "diff_preview": preview,
        "truncated": truncated,
        "method": "word-diff",
    }


def _validated_previous_brief(db, row, source_sha, validation_sha, evidence_rows):
    """Return a read-only stale draft only when its retained evidence still validates."""
    if (
        row["brief_status"] != "stale" or not source_sha or not validation_sha
        or source_sha == row["sha256"]
        or any(item["field"] not in {"summary", "impact"} for item in evidence_rows)
    ):
        return None
    previous = db.execute("""
      SELECT extracted_text FROM source_revisions
      WHERE url=? AND sha256=? ORDER BY observed_at DESC,rowid DESC LIMIT 1
    """, (row["url"], source_sha)).fetchone()
    if not previous:
        return None
    evidence = {
        field: [item["excerpt"] for item in evidence_rows if item["field"] == field]
        for field in ("summary", "impact")
    }
    try:
        summary_ja, impact_ja, cleaned = _validate_brief_payload(
            previous["extracted_text"], row["summary_ja"], row["impact_label"],
            row["impact_ja"], row["confidence"], evidence,
        )
    except (AttributeError, TypeError, ValueError):
        return None
    if _brief_validation_sha(
        source_sha, summary_ja, row["impact_label"], impact_ja,
        row["confidence"], cleaned,
    ) != validation_sha:
        return None
    return {
        "source_sha256": source_sha,
        "summary_ja": summary_ja,
        "impact_label": row["impact_label"],
        "impact_ja": impact_ja,
        "confidence": row["confidence"],
        "generated_at": row["generated_at"],
        "evidence": {
            field: [excerpt for item_field, excerpt in cleaned if item_field == field]
            for field in ("summary", "impact")
        },
    }


def queue_generation_job(db, url, reserved_tokens=0):
    """Queue one monitored release revision; never backfill sources without a release event."""
    queued_at = now()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""
          SELECT s.sha256,s.error,s.extracted_chars
          FROM sources s JOIN release_events e ON e.url=s.url WHERE s.url=?
        """, (url,)).fetchone()
        if not row:
            raise ValueError("Only a newly detected release event can be queued")
        ready = bool(row["sha256"] and not row["error"] and row["extracted_chars"] > 0)
        db.execute("""
          INSERT INTO brief_generation_jobs(
            url,source_sha256,status,attempts,queued_at,started_at,completed_at,next_attempt_at,error_code,reserved_tokens
          ) VALUES(?,?,?,0,?,NULL,NULL,?,NULL,?)
          ON CONFLICT(url) DO NOTHING
        """, (url, row["sha256"] if ready else None, "queued" if ready else "waiting-body", queued_at, queued_at,
              max(0, int(reserved_tokens)) if ready else 0))
    return {"url": url, "status": "queued" if ready else "waiting-body"}


def activate_generation_job(db, url, reserved_tokens=0):
    """Make a queued release ready after body retrieval, resetting only a changed revision."""
    activated_at = now()
    with db:
        db.execute("BEGIN IMMEDIATE")
        source = db.execute("SELECT sha256,error,extracted_chars FROM sources WHERE url=?", (url,)).fetchone()
        job = db.execute("SELECT * FROM brief_generation_jobs WHERE url=?", (url,)).fetchone()
        if not source or not job or not source["sha256"] or source["error"] or source["extracted_chars"] <= 0:
            return None
        if (job["source_sha256"] == source["sha256"] and job["status"] != "waiting-body"
                and job["reserved_tokens"] > 0):
            return {"url": url, "status": job["status"]}
        db.execute("""
          UPDATE brief_generation_jobs SET source_sha256=?,status='queued',attempts=0,
            queued_at=?,started_at=NULL,completed_at=NULL,next_attempt_at=?,error_code=NULL,reserved_tokens=?
          WHERE url=?
        """, (source["sha256"], activated_at, activated_at, max(0, int(reserved_tokens)), url))
    return {"url": url, "status": "queued"}


def recover_generation_jobs(db, stale_minutes=10):
    """Recover interrupted work without paying twice when a valid generated draft was saved."""
    recovered_at = now()
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)).isoformat(timespec="milliseconds")
    with db:
        db.execute("BEGIN IMMEDIATE")
        completed = db.execute("""
          UPDATE brief_generation_jobs AS j SET status='succeeded',completed_at=?,next_attempt_at=?,error_code=NULL
          WHERE status='running' AND EXISTS (
            SELECT 1 FROM briefs b WHERE b.url=j.url AND b.source_sha256=j.source_sha256
              AND b.generation_response_id IS NOT NULL
          )
        """, (recovered_at, recovered_at)).rowcount
        db.execute("""
          UPDATE brief_generation_attempts AS a SET completed_at=?,outcome='succeeded',error_code=NULL
          WHERE outcome='running' AND EXISTS (
            SELECT 1 FROM briefs b WHERE b.url=a.url AND b.source_sha256=a.source_sha256
              AND b.generation_response_id IS NOT NULL
          )
        """, (recovered_at,))
        interrupted = db.execute("""
          UPDATE brief_generation_jobs SET status='retry',next_attempt_at=?,error_code='worker-interrupted'
          WHERE status='running' AND started_at<=?
        """, (recovered_at, cutoff)).rowcount
        db.execute("""
          UPDATE brief_generation_attempts SET completed_at=?,outcome='interrupted',error_code='worker-interrupted'
          WHERE outcome='running' AND started_at<=?
        """, (recovered_at, cutoff))
    return {"completed": completed, "interrupted": interrupted}


def claim_generation_job(db, daily_limit, max_attempts, token_limit):
    """Atomically claim one due revision under rolling job and token budgets."""
    claimed_at = now()
    window_start = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="milliseconds")
    with db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""
          UPDATE brief_generation_jobs SET status='failed',completed_at=?,error_code='generation-failed'
          WHERE status IN ('queued','retry') AND attempts>=?
        """, (claimed_at, max_attempts))
        used = db.execute(
            "SELECT count(*) FROM brief_generation_attempts WHERE started_at>=?", (window_start,)
        ).fetchone()[0]
        if used >= daily_limit:
            return None
        tokens_used = db.execute("""
          SELECT coalesce(sum(CASE WHEN outcome='succeeded' AND total_tokens IS NOT NULL
                              THEN total_tokens ELSE reserved_tokens END),0)
          FROM brief_generation_attempts WHERE started_at>=?
        """, (window_start,)).fetchone()[0]
        row = db.execute("""
          SELECT j.* FROM brief_generation_jobs j
          JOIN sources s ON s.url=j.url
          WHERE j.status IN ('queued','retry') AND j.next_attempt_at<=?
            AND j.attempts<? AND j.source_sha256=s.sha256
            AND s.error IS NULL AND s.extracted_chars>0
            AND j.reserved_tokens>0 AND j.reserved_tokens<=?
          ORDER BY j.queued_at,j.url LIMIT 1
        """, (claimed_at, max_attempts, max(0, token_limit - tokens_used))).fetchone()
        if not row:
            return None
        attempt = row["attempts"] + 1
        db.execute("""
          UPDATE brief_generation_jobs SET status='running',attempts=?,started_at=?,completed_at=NULL,error_code=NULL
          WHERE url=?
        """, (attempt, claimed_at, row["url"]))
        cursor = db.execute("""
          INSERT INTO brief_generation_attempts(url,source_sha256,started_at,outcome,reserved_tokens)
          VALUES(?,?,?,'running',?)
        """, (row["url"], row["source_sha256"], claimed_at, row["reserved_tokens"]))
    return {"url": row["url"], "sha256": row["source_sha256"], "attempt": attempt,
            "attemptId": cursor.lastrowid, "reservedTokens": row["reserved_tokens"]}


def claim_manual_generation(db, url, expected_sha, reserved_tokens, daily_limit, token_limit):
    """Reserve rolling budgets for an authenticated one-at-a-time generation."""
    claimed_at = now()
    window_start = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="milliseconds")
    reserved_tokens = max(1, int(reserved_tokens))
    with db:
        db.execute("BEGIN IMMEDIATE")
        source = db.execute("SELECT sha256,error,extracted_chars FROM sources WHERE url=?", (url,)).fetchone()
        if (not source or source["sha256"] != expected_sha or source["error"]
                or source["extracted_chars"] <= 0):
            raise ValueError("Source is missing, changed, failed, or has no extracted evidence")
        used, budget_tokens = db.execute("""
          SELECT count(*),coalesce(sum(CASE WHEN outcome='succeeded' AND total_tokens IS NOT NULL
                                      THEN total_tokens ELSE reserved_tokens END),0)
          FROM brief_generation_attempts WHERE started_at>=?
        """, (window_start,)).fetchone()
        if used >= daily_limit:
            raise ValueError("generation-daily-limit-reached")
        if budget_tokens + reserved_tokens > token_limit:
            raise ValueError("generation-token-budget-exhausted")
        cursor = db.execute("""
          INSERT INTO brief_generation_attempts(url,source_sha256,started_at,outcome,reserved_tokens)
          VALUES(?,?,?,'running',?)
        """, (url, expected_sha, claimed_at, reserved_tokens))
    return {"url": url, "sha256": expected_sha, "attemptId": cursor.lastrowid,
            "reservedTokens": reserved_tokens}


def finish_manual_generation(db, claim, error_code=None, usage=None):
    completed_at = now()
    error_code = error_code if error_code in {
        None, "generation-not-configured", "generation-failed", "validation-failed", "worker-error"
    } else "worker-error"
    usage = usage or {}
    with db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""
          UPDATE brief_generation_attempts SET completed_at=?,outcome=?,error_code=?,
            input_tokens=?,output_tokens=?,total_tokens=? WHERE id=? AND outcome='running'
        """, (completed_at, "succeeded" if error_code is None else "failed", error_code,
              usage.get("inputTokens"), usage.get("outputTokens"), usage.get("totalTokens"), claim["attemptId"]))


def finish_generation_job(db, claim, error_code=None, max_attempts=3, usage=None):
    """Complete or reschedule a claimed generation without storing sensitive errors."""
    completed_at = now()
    error_code = error_code if error_code in {
        None, "generation-not-configured", "generation-failed", "validation-failed", "worker-error"
    } else "worker-error"
    if error_code is None:
        status, retry_seconds = "succeeded", 0
    elif claim["attempt"] >= max_attempts:
        status, retry_seconds = "failed", 0
    else:
        status = "retry"
        retry_seconds = min(3600, 60 * (5 ** max(0, claim["attempt"] - 1)))
    next_attempt_at = (datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)).isoformat(timespec="milliseconds")
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT source_sha256,status FROM brief_generation_jobs WHERE url=?", (claim["url"],)).fetchone()
        if not current or current["source_sha256"] != claim["sha256"]:
            status = "superseded"
        else:
            db.execute("""
              UPDATE brief_generation_jobs SET status=?,completed_at=?,next_attempt_at=?,error_code=? WHERE url=?
            """, (status, completed_at, next_attempt_at, error_code, claim["url"]))
        usage = usage or {}
        db.execute("""
          UPDATE brief_generation_attempts SET completed_at=?,outcome=?,error_code=?,
            input_tokens=?,output_tokens=?,total_tokens=?
          WHERE id=? AND outcome='running'
        """, (completed_at, status, error_code, usage.get("inputTokens"), usage.get("outputTokens"),
              usage.get("totalTokens"), claim["attemptId"]))
    return {"url": claim["url"], "status": status, "retrySeconds": retry_seconds}


def generation_queue_stats(db, daily_limit, token_limit):
    window_start = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="milliseconds")
    counts = {row["status"]: row["total"] for row in db.execute(
        "SELECT status,count(*) AS total FROM brief_generation_jobs GROUP BY status"
    )}
    attempt = db.execute("""
      SELECT count(*) AS total,max(started_at) AS last_attempt_at,
             max(CASE WHEN outcome='succeeded' THEN completed_at END) AS last_success_at,
             coalesce(sum(CASE WHEN outcome='succeeded' AND total_tokens IS NOT NULL
                          THEN total_tokens ELSE reserved_tokens END),0) AS budget_tokens,
             coalesce(sum(CASE WHEN total_tokens IS NOT NULL THEN total_tokens ELSE 0 END),0) AS measured_tokens
      FROM brief_generation_attempts WHERE started_at>=?
    """, (window_start,)).fetchone()
    error = db.execute("""
      SELECT error_code FROM brief_generation_attempts
      WHERE error_code IS NOT NULL ORDER BY id DESC LIMIT 1
    """).fetchone()
    remaining_tokens = max(0, token_limit - attempt["budget_tokens"])
    budget_blocked = db.execute("""
      SELECT count(*) FROM brief_generation_jobs
      WHERE status IN ('queued','retry') AND reserved_tokens>?
    """, (remaining_tokens,)).fetchone()[0]
    return {
        "waitingBody": counts.get("waiting-body", 0), "queued": counts.get("queued", 0),
        "running": counts.get("running", 0), "retry": counts.get("retry", 0),
        "succeeded": counts.get("succeeded", 0), "failed": counts.get("failed", 0),
        "attemptsLast24Hours": attempt["total"], "limitReached": attempt["total"] >= daily_limit,
        "tokenLimit": token_limit, "budgetTokensLast24Hours": attempt["budget_tokens"],
        "measuredTokensLast24Hours": attempt["measured_tokens"],
        "tokenLimitReached": attempt["budget_tokens"] >= token_limit,
        "tokenBudgetBlocked": budget_blocked,
        "lastAttemptAt": attempt["last_attempt_at"], "lastSuccessAt": attempt["last_success_at"],
        "lastErrorCode": error["error_code"] if error else None,
    }


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
    if getattr(transport, "supports_persistent_validators", False):
        legacy_unextracted_pdf = (
            row["content_type"] == "application/pdf"
            and bool(row["sha256"])
            and not row["extracted_chars"]
        )
        response = transport(
            row["url"], row["ticker"],
            validators={} if legacy_unextracted_pdf else {
                "etag": row["response_etag"],
                "last_modified": row["response_last_modified"],
            },
            include_metadata=True,
        )
        if response["notModified"]:
            return {
                "notModified": True, "responseEtag": response["etag"],
                "responseLastModified": response["lastModified"],
            }
        content, content_type = response["content"], response["contentType"]
        response_etag, response_last_modified = response["etag"], response["lastModified"]
    else:
        content, content_type = transport(row["url"], row["ticker"])
        response_etag = response_last_modified = None
    extracted = extract_text(content, content_type)
    if not extracted.strip():
        raise ValueError("Source has no extractable text")
    return {
        "sha256": hashlib.sha256(content).hexdigest(),
        "bodySha256": hashlib.sha256(extracted.encode("utf-8")).hexdigest(),
        "contentType": content_type,
        "contentBytes": len(content),
        "extractedText": extracted,
        "extractedChars": len(extracted),
        "responseEtag": response_etag,
        "responseLastModified": response_last_modified,
    }


def save_source_check(db, row, result):
    checked_at = now()
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT * FROM sources WHERE url=?", (row["url"],)).fetchone()
        if not current:
            raise ValueError("Source disappeared before its fetch result was saved")
        not_modified = bool(result.get("notModified"))
        if not_modified and not current["sha256"]:
            raise ValueError("Not-modified response has no stored source body")
        result_body_sha = None if not_modified else result.get("bodySha256")
        if not not_modified and not result_body_sha:
            result_body_sha = hashlib.sha256(
                result["extractedText"].encode("utf-8")
            ).hexdigest()
        changed = False if not_modified else result_body_sha != current["body_sha256"]
        recheck_seconds = successful_recheck_seconds(
            db, row["url"], changed, bool(current["sha256"]), checked_at
        )
        next_fetch_at = (
            datetime.fromisoformat(checked_at) + timedelta(seconds=recheck_seconds)
        ).isoformat(timespec="milliseconds")
        if changed:
            db.execute(
                "INSERT INTO history(url,at,kind,sha256,reason) VALUES(?,?,?,?,?)",
                (row["url"], checked_at, "changed" if current["sha256"] else "first-fetch", result["sha256"], "Extracted evidence body changed; editorial correction not established"),
            )
            db.execute(
                "UPDATE briefs SET status='stale',reviewed_at=NULL,reviewer=NULL,review_reason=NULL WHERE url=?",
                (row["url"],),
            )
        if current["sha256"] and current["extracted_text"]:
            db.execute("""
              INSERT OR IGNORE INTO source_revisions(
                url,sha256,observed_at,content_type,content_bytes,extracted_text,extracted_chars
              ) VALUES(?,?,?,?,?,?,?)
            """, (
                row["url"], current["sha256"],
                current["checked_at"] or current["fetched_at"] or checked_at,
                current["content_type"], current["content_bytes"],
                current["extracted_text"], current["extracted_chars"],
            ))
        if not_modified:
            db.execute("""
              UPDATE sources
              SET checked_at=?,error=NULL,fetch_failures=0,next_fetch_at=?,
                  response_etag=COALESCE(?,response_etag),
                  response_last_modified=COALESCE(?,response_last_modified)
              WHERE url=?
            """, (
                checked_at, next_fetch_at, http_validator(result.get("responseEtag")),
                http_validator(result.get("responseLastModified")), row["url"],
            ))
        elif changed:
            db.execute("""
              INSERT OR IGNORE INTO source_revisions(
                url,sha256,observed_at,content_type,content_bytes,extracted_text,extracted_chars
              ) VALUES(?,?,?,?,?,?,?)
            """, (
                row["url"], result["sha256"], checked_at, result["contentType"],
                result["contentBytes"], result["extractedText"], result["extractedChars"],
            ))
            db.execute("""
              DELETE FROM source_revisions WHERE rowid IN (
                SELECT rowid FROM source_revisions WHERE url=?
                ORDER BY observed_at DESC,rowid DESC LIMIT -1 OFFSET 12
              )
            """, (row["url"],))
        if not not_modified:
            db.execute("""
          UPDATE sources
          SET sha256=?,raw_sha256=?,body_sha256=?,checked_at=?,
              fetched_at=COALESCE(fetched_at,?),error=NULL,status=?,
              content_type=?,content_bytes=?,extracted_text=?,extracted_chars=?,fetch_failures=0,
              next_fetch_at=?,response_etag=?,response_last_modified=?
          WHERE url=?
        """, (
            result["sha256"] if changed else current["sha256"], result["sha256"],
            result_body_sha, checked_at, checked_at,
            "pending" if changed else current["status"],
            result["contentType"], result["contentBytes"], result["extractedText"],
            result["extractedChars"], next_fetch_at, http_validator(result.get("responseEtag")),
            http_validator(result.get("responseLastModified")), row["url"],
        ))
    status = "not-modified" if not_modified else (
        "first-fetched" if not current["sha256"] else ("changed" if changed else "unchanged")
    )
    return {
        "url": row["url"], "status": status,
        "extractedChars": current["extracted_chars"] if not_modified else result["extractedChars"],
        "recheckSeconds": recheck_seconds,
    }


def save_source_error(db, row, exc):
    checked_at = now()
    error_code = source_error_code(exc)
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT fetch_failures FROM sources WHERE url=?", (row["url"],)).fetchone()
        if not current:
            raise ValueError("Source disappeared before its fetch error was saved")
        failures = current["fetch_failures"] + 1
        retry_seconds = min(6 * 60 * 60, 60 * (2 ** min(failures - 1, 8)))
        retry_hint = retry_after_seconds(exc)
        if retry_hint is not None:
            retry_seconds = max(retry_seconds, retry_hint)
        next_fetch_at = (datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)).isoformat(timespec="milliseconds")
        db.execute(
            "UPDATE sources SET checked_at=?,error=?,fetch_failures=?,next_fetch_at=? WHERE url=?",
            (checked_at, error_code, failures, next_fetch_at, row["url"]),
        )
        db.execute("INSERT INTO history(url,at,kind,reason) VALUES(?,?,?,?)", (row["url"], checked_at, "fetch-error", error_code))
    return {"url": row["url"], "status": "error", "retrySeconds": retry_seconds, "error": error_code}


def check_source(db, row, transport=fetch):
    try:
        return save_source_check(db, row, collect_source(row, transport))
    except Exception as exc:
        return save_source_error(db, row, exc)


def _review_text(value, minimum, maximum):
    if not isinstance(value, str):
        raise ValueError("Decision, reviewer, and reason are required")
    value = value.strip()
    if not minimum <= len(value) <= maximum or re.search(r"[\x00-\x1f\x7f<>]", value):
        raise ValueError("Decision, reviewer, and reason are required")
    return value


def review(db, url, expected_sha, decision, reviewer, reason):
    if decision not in {"approved", "held", "rejected"}:
        raise ValueError("Decision, reviewer, and reason are required")
    reviewer, reason = _review_text(reviewer, 2, 120), _review_text(reason, 5, 500)
    with db:
        # Acquire a write lock before reading so a concurrent check cannot invalidate approval.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
        if not row or not row["sha256"] or row["sha256"] != expected_sha or row["error"]:
            raise ValueError("Source is missing, changed, or failed its latest check; review current content first")
        db.execute("INSERT INTO history(url,at,kind,sha256,reviewer,reason) VALUES(?,?,?,?,?,?)", (url, now(), decision, expected_sha, reviewer, reason))
        db.execute("UPDATE sources SET status=? WHERE url=?", (decision, url))


def _validate_brief_payload(source_text, summary_ja, impact_label, impact_ja, confidence, evidence):
    """Return normalized evidence only when both editorial fields remain source-bound."""
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
    cleaned = []
    cited_by_field = {}
    for field in ("summary", "impact"):
        field_excerpts = []
        for excerpt in evidence[field]:
            excerpt = " ".join(str(excerpt).split())
            if not 12 <= len(excerpt) <= 800 or excerpt not in source_text:
                raise ValueError("Every evidence excerpt must appear exactly in the current source text")
            cleaned.append((field, excerpt))
            field_excerpts.append(excerpt)
        cited_by_field[field] = " ".join(field_excerpts)
    for field, text in (("summary", summary_ja), ("impact", impact_ja)):
        for token in re.findall(r"([$€£¥₩]?\d[\d,.]*%?)(?:億|万|兆|倍|年|月|日)?", text):
            if token not in cited_by_field[field]:
                raise ValueError(f"Every numeric {field} claim must appear in its cited evidence")
    return summary_ja, impact_ja, cleaned


def _brief_validation_sha(source_sha, summary_ja, impact_label, impact_ja, confidence, evidence):
    """Seal the exact normalized news draft that passed evidence and numeric checks."""
    fields = {
        "sourceSha256": source_sha,
        "summaryJa": summary_ja,
        "impactLabel": impact_label,
        "impactJa": impact_ja,
        "confidence": confidence,
        "evidence": [{"field": field, "excerpt": excerpt} for field, excerpt in evidence],
    }
    encoded = json.dumps(
        fields, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_brief_for_review(row, evidence_rows, expected_sha):
    """Run the exact, read-only integrity checks required before a human decision."""
    if not row or not row["source_sha256"]:
        raise ValueError("draft-missing")
    if row["source_sha256"] != expected_sha or row["current_sha"] != expected_sha:
        raise ValueError("source-revision-mismatch")
    if row["source_error"] or not row["source_text"]:
        raise ValueError("source-unavailable")
    if not source_check_is_fresh(row["source_checked_at"]):
        raise ValueError("source-check-stale")
    if any(item["field"] not in {"summary", "impact"} for item in evidence_rows):
        raise ValueError("draft-evidence-invalid")
    evidence = {
        field: [item["excerpt"] for item in evidence_rows if item["field"] == field]
        for field in ("summary", "impact")
    }
    try:
        summary_ja, impact_ja, cleaned = _validate_brief_payload(
            row["source_text"], row["summary_ja"], row["impact_label"],
            row["impact_ja"], row["confidence"], evidence,
        )
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("draft-evidence-invalid") from exc
    validation_sha = _brief_validation_sha(
        expected_sha, summary_ja, row["impact_label"], impact_ja,
        row["confidence"], cleaned,
    )
    if not row["validation_sha256"]:
        raise ValueError("draft-fingerprint-missing")
    if row["validation_sha256"] != validation_sha:
        raise ValueError("draft-fingerprint-mismatch")
    return validation_sha


def _brief_preflight_result(row, evidence_rows, expected_sha):
    """Return the private, read-only review gate result without changing state."""
    try:
        _validate_brief_for_review(row, evidence_rows, expected_sha)
    except ValueError as exc:
        return {"ready": False, "blockers": [str(exc)], "checks": []}
    return {
        "ready": True,
        "blockers": [],
        "checks": [
            "source-revision-current", "source-fetch-successful",
            "source-check-recent", "evidence-and-numbers-valid",
            "draft-fingerprint-matched",
        ],
    }


def _public_brief_evidence(evidence, maximum_items=2, maximum_chars=320):
    """Expose a small, source-verbatim prefix without leaking editorial metadata."""
    result = {}
    for field in ("summary", "impact"):
        items = []
        for excerpt in evidence.get(field, [])[:maximum_items]:
            text = excerpt[:maximum_chars].rstrip()
            items.append({"text": text, "truncated": len(text) < len(excerpt)})
        result[field] = items
    return result


def save_brief_draft(db, url, expected_sha, summary_ja, impact_label, impact_ja, confidence, evidence):
    """Save a private evidence-bound draft; never publish it without a later review."""
    generated_at = now()
    with db:
        # Lock before reading so a concurrent source refresh cannot race the evidence check.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
        if not row or not row["sha256"] or row["sha256"] != expected_sha or row["error"] or not row["extracted_text"]:
            raise ValueError("Source is missing, changed, failed, or has no extracted evidence")
        summary_ja, impact_ja, cleaned = _validate_brief_payload(
            row["extracted_text"], summary_ja, impact_label, impact_ja, confidence, evidence
        )
        validation_sha = _brief_validation_sha(
            expected_sha, summary_ja, impact_label, impact_ja, confidence, cleaned
        )
        db.execute("""
          INSERT INTO briefs(url,source_sha256,summary_ja,impact_label,impact_ja,confidence,validation_sha256,status,generated_at,reviewed_at,reviewer,review_reason)
          VALUES(?,?,?,?,?,?,?,'draft',?,NULL,NULL,NULL)
          ON CONFLICT(url) DO UPDATE SET source_sha256=excluded.source_sha256,
            summary_ja=excluded.summary_ja,impact_label=excluded.impact_label,
            impact_ja=excluded.impact_ja,confidence=excluded.confidence,
            validation_sha256=excluded.validation_sha256,status='draft',
            generated_at=excluded.generated_at,reviewed_at=NULL,reviewer=NULL,review_reason=NULL
        """, (
            url, expected_sha, summary_ja, impact_label, impact_ja, confidence,
            validation_sha, generated_at,
        ))
        db.execute("DELETE FROM brief_evidence WHERE url=?", (url,))
        db.execute("""
          UPDATE briefs SET generation_provider=NULL,generation_model=NULL,generation_response_id=NULL,
                            generation_source_truncated=0,generation_input_tokens=NULL,
                            generation_output_tokens=NULL,generation_total_tokens=NULL WHERE url=?
        """, (url,))
        db.executemany("INSERT INTO brief_evidence(url,field,excerpt) VALUES(?,?,?)", [(url, field, excerpt) for field, excerpt in cleaned])
    return {"url": url, "status": "draft", "generatedAt": generated_at, "published": False}


def review_brief(db, url, expected_sha, decision, reviewer, reason, expected_validation_sha):
    """Record the mandatory human decision for the current source revision."""
    if decision not in {"approved", "held", "rejected"}:
        raise ValueError("Decision, reviewer, and reason are required")
    reviewer, reason = _review_text(reviewer, 2, 120), _review_text(reason, 5, 500)
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""
          SELECT b.*,s.sha256 AS current_sha,s.error AS source_error,
                 s.extracted_text AS source_text,s.checked_at AS source_checked_at
          FROM briefs b JOIN sources s ON s.url=b.url WHERE b.url=?
        """, (url,)).fetchone()
        evidence_rows = db.execute(
            "SELECT field,excerpt FROM brief_evidence WHERE url=? ORDER BY id", (url,)
        ).fetchall()
        if (not _ANNUAL_SHA.fullmatch(str(expected_validation_sha)) or not row
                or row["validation_sha256"] != expected_validation_sha):
            raise ValueError("draft-revision-mismatch")
        try:
            _validate_brief_for_review(row, evidence_rows, expected_sha)
        except ValueError as exc:
            if str(exc) in {
                "draft-missing", "source-revision-mismatch", "source-unavailable",
                "source-check-stale",
            }:
                raise ValueError(
                    "Draft evidence is missing, stale, or the official source changed; "
                    "refresh or regenerate before review"
                ) from exc
            raise ValueError(
                "Draft evidence is missing or invalid; regenerate before review"
            ) from exc
        reviewed_at = now()
        db.execute("""
          INSERT INTO brief_review_history(
            url,source_sha256,draft_validation_sha256,decision,reviewed_at,reviewer,reason
          ) VALUES(?,?,?,?,?,?,?)
        """, (
            url, expected_sha, row["validation_sha256"], decision,
            reviewed_at, reviewer, reason,
        ))
        db.execute(
            "UPDATE briefs SET status=?,reviewed_at=?,reviewer=?,review_reason=? WHERE url=?",
            (decision, reviewed_at, reviewer, reason, url),
        )
    return {"url": url, "status": decision, "published": False}


_ANNUAL_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{2,79}$")
_ANNUAL_TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,14}$")
_ANNUAL_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_ANNUAL_SHA = re.compile(r"^[a-f0-9]{64}$")


def _annual_text(value, minimum, maximum, japanese=False):
    if not isinstance(value, str) or value != value.strip() or not minimum <= len(value) <= maximum:
        raise ValueError("invalid-annual-brief-text")
    if re.search(r"[\x00-\x1f\x7f<>]", value):
        raise ValueError("invalid-annual-brief-text")
    if japanese and not re.search(r"[ぁ-んァ-ヶ一-龯]", value):
        raise ValueError("annual-brief-text-must-be-japanese")
    return value


def _annual_ids(value, maximum=8):
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        raise ValueError("invalid-annual-evidence-ids")
    result = [_annual_text(item, 3, 80) for item in value]
    if len(set(result)) != len(result):
        raise ValueError("duplicate-annual-evidence-id")
    return result


def _annual_numbers(value):
    return {
        match.group(0).replace(",", "").replace("％", "%")
        for match in re.finditer(r"\d+(?:[,.]\d+)*(?:%|％)?", value)
    }


def _validate_annual_filing_payload(payload):
    """Validate an editor draft against the submitted SEC excerpts before storage.

    The excerpts are deliberately not persisted. Public delivery independently checks
    the stored record against a newly retrieved SEC filing and its current SHA.
    """
    if not isinstance(payload, dict):
        raise ValueError("invalid-annual-brief")
    ticker = str(payload.get("ticker", ""))
    accession = str(payload.get("accessionNumber", ""))
    source_sha = str(payload.get("sourceSha256", ""))
    brief_id = str(payload.get("id", ""))
    if not _ANNUAL_TICKER.fullmatch(ticker):
        raise ValueError("invalid-annual-ticker")
    if not _ANNUAL_ACCESSION.fullmatch(accession):
        raise ValueError("invalid-annual-accession")
    if not _ANNUAL_SHA.fullmatch(source_sha):
        raise ValueError("invalid-annual-source-sha")
    if not _ANNUAL_ID.fullmatch(brief_id):
        raise ValueError("invalid-annual-brief-id")
    summary = _annual_text(payload.get("summaryJa"), 20, 500, japanese=True)
    business_model = _annual_text(payload.get("businessModelJa"), 20, 800, japanese=True)
    confidence = payload.get("confidence")
    method = payload.get("generationMethod")
    if confidence not in {"low", "medium", "high"}:
        raise ValueError("invalid-annual-confidence")
    if method not in {"human", "ai-assisted"}:
        raise ValueError("invalid-annual-generation-method")
    source_business = payload.get("sourceBusiness", "")
    source_risks = payload.get("sourceRisks", "")
    if not isinstance(source_business, str) or not isinstance(source_risks, str):
        raise ValueError("invalid-annual-source-evidence")
    if len(source_business) > 20_000 or len(source_risks) > 30_000:
        raise ValueError("annual-source-evidence-too-large")

    evidence_value = payload.get("evidence")
    if not isinstance(evidence_value, list) or not 2 <= len(evidence_value) <= 12:
        raise ValueError("invalid-annual-evidence")
    evidence, evidence_map = [], {}
    for item in evidence_value:
        if not isinstance(item, dict):
            raise ValueError("invalid-annual-evidence")
        evidence_id = _annual_text(item.get("id"), 3, 80)
        section = item.get("section")
        quote = _annual_text(item.get("quote"), 24, 800)
        if not _ANNUAL_ID.fullmatch(evidence_id) or evidence_id in evidence_map:
            raise ValueError("invalid-annual-evidence-id")
        if section not in {"business", "risk"}:
            raise ValueError("invalid-annual-evidence-section")
        corpus = source_business if section == "business" else source_risks
        if quote not in corpus:
            raise ValueError("annual-evidence-not-in-source")
        cleaned = {"id": evidence_id, "section": section, "quote": quote}
        evidence.append(cleaned)
        evidence_map[evidence_id] = cleaned

    summary_ids = _annual_ids(payload.get("summaryEvidenceIds"))
    business_ids = _annual_ids(payload.get("businessModelEvidenceIds"))
    risk_value = payload.get("riskPointsJa")
    if not isinstance(risk_value, list) or not 1 <= len(risk_value) <= 6:
        raise ValueError("invalid-annual-risk-points")
    risks = []
    for point in risk_value:
        if not isinstance(point, dict):
            raise ValueError("invalid-annual-risk-point")
        risks.append({
            "text": _annual_text(point.get("text"), 12, 360, japanese=True),
            "evidenceIds": _annual_ids(point.get("evidenceIds"), 4),
        })
    references = summary_ids + business_ids + [ref for point in risks for ref in point["evidenceIds"]]
    if any(ref not in evidence_map for ref in references):
        raise ValueError("annual-evidence-reference-missing")
    if any(evidence_map[ref]["section"] != "business" for ref in summary_ids + business_ids):
        raise ValueError("annual-business-evidence-section-invalid")
    if any(evidence_map[ref]["section"] != "risk" for point in risks for ref in point["evidenceIds"]):
        raise ValueError("annual-risk-evidence-section-invalid")
    for text, refs in [(summary, summary_ids), (business_model, business_ids)] + [
        (point["text"], point["evidenceIds"]) for point in risks
    ]:
        supported = _annual_numbers(" ".join(evidence_map[ref]["quote"] for ref in refs))
        if _annual_numbers(text) - supported:
            raise ValueError("annual-number-not-grounded")
    return {
        "ticker": ticker, "accessionNumber": accession, "sourceSha256": source_sha,
        "id": brief_id, "summaryJa": summary, "businessModelJa": business_model,
        "riskPointsJa": risks, "summaryEvidenceIds": summary_ids,
        "businessModelEvidenceIds": business_ids, "evidence": evidence,
        "confidence": confidence, "generationMethod": method,
    }


def _annual_validation_sha(record):
    """Seal the exact normalized draft that passed source and numeric checks."""
    fields = {
        key: record[key] for key in (
            "ticker", "accessionNumber", "sourceSha256", "id", "summaryJa",
            "businessModelJa", "riskPointsJa", "summaryEvidenceIds",
            "businessModelEvidenceIds", "evidence", "confidence", "generationMethod",
        )
    }
    encoded = json.dumps(
        fields, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _annual_record_from_row(row):
    try:
        return {
            "ticker": row["ticker"], "accessionNumber": row["accession_number"],
            "sourceSha256": row["source_sha256"], "id": row["brief_id"],
            "summaryJa": row["summary_ja"], "businessModelJa": row["business_model_ja"],
            "riskPointsJa": json.loads(row["risk_points_json"]),
            "summaryEvidenceIds": json.loads(row["summary_evidence_ids_json"]),
            "businessModelEvidenceIds": json.loads(row["business_evidence_ids_json"]),
            "evidence": json.loads(row["evidence_json"]), "confidence": row["confidence"],
            "generationMethod": row["generation_method"],
        }
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ValueError("annual-draft-evidence-invalid") from exc


def _validate_annual_review_sources(record, source_business, source_risks):
    """Recheck stored excerpts against the exact SEC text shown to the reviewer."""
    if (not isinstance(source_business, str) or not isinstance(source_risks, str)
            or not source_business or not source_risks):
        raise ValueError("annual-review-source-invalid")
    if len(source_business) > 20_000 or len(source_risks) > 30_000:
        raise ValueError("annual-review-source-too-large")
    try:
        return _validate_annual_filing_payload({
            **record, "sourceBusiness": source_business, "sourceRisks": source_risks,
        })
    except ValueError as exc:
        if str(exc) == "annual-evidence-not-in-source":
            raise ValueError("annual-review-evidence-mismatch") from exc
        raise ValueError("annual-draft-evidence-invalid") from exc


def save_annual_filing_brief_draft(db, payload):
    """Persist a source-bound private draft after exact local evidence checks."""
    record = _validate_annual_filing_payload(payload)
    generated_at = now()
    with db:
        db.execute("""
          INSERT INTO annual_filing_briefs(
            ticker,accession_number,source_sha256,brief_id,summary_ja,business_model_ja,
            risk_points_json,summary_evidence_ids_json,business_evidence_ids_json,
            evidence_json,confidence,generation_method,validation_sha256,status,generated_at,
            reviewed_at,reviewer,review_reason
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,NULL,NULL,NULL)
          ON CONFLICT(ticker,accession_number) DO UPDATE SET
            source_sha256=excluded.source_sha256,brief_id=excluded.brief_id,
            summary_ja=excluded.summary_ja,business_model_ja=excluded.business_model_ja,
            risk_points_json=excluded.risk_points_json,
            summary_evidence_ids_json=excluded.summary_evidence_ids_json,
            business_evidence_ids_json=excluded.business_evidence_ids_json,
            evidence_json=excluded.evidence_json,confidence=excluded.confidence,
            generation_method=excluded.generation_method,
            validation_sha256=excluded.validation_sha256,status='draft',
            generated_at=excluded.generated_at,reviewed_at=NULL,reviewer=NULL,review_reason=NULL
        """, (
            record["ticker"], record["accessionNumber"], record["sourceSha256"], record["id"],
            record["summaryJa"], record["businessModelJa"],
            json.dumps(record["riskPointsJa"], ensure_ascii=False, separators=(",", ":")),
            json.dumps(record["summaryEvidenceIds"], separators=(",", ":")),
            json.dumps(record["businessModelEvidenceIds"], separators=(",", ":")),
            json.dumps(record["evidence"], ensure_ascii=False, separators=(",", ":")),
            record["confidence"], record["generationMethod"],
            _annual_validation_sha(record), generated_at,
        ))
    return {"ticker": record["ticker"], "accessionNumber": record["accessionNumber"],
            "status": "draft", "generatedAt": generated_at, "published": False}


def review_annual_filing_brief(
        db, ticker, accession, expected_sha, decision, reviewer, reason,
        expected_validation_sha, source_business, source_risks):
    """Record a human decision for one exact annual filing revision."""
    if not _ANNUAL_TICKER.fullmatch(str(ticker)) or not _ANNUAL_ACCESSION.fullmatch(str(accession)):
        raise ValueError("invalid-annual-filing-identity")
    if not _ANNUAL_SHA.fullmatch(str(expected_sha)):
        raise ValueError("invalid-annual-source-sha")
    if decision not in {"approved", "held", "rejected"}:
        raise ValueError("invalid-annual-review-decision")
    reviewer = _annual_text(reviewer, 2, 120)
    reason = _annual_text(reason, 5, 500)
    reviewed_at = now()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""
          SELECT * FROM annual_filing_briefs
          WHERE ticker=? AND accession_number=?
        """, (ticker, accession)).fetchone()
        if not row or row["source_sha256"] != expected_sha:
            raise ValueError("annual-draft-missing-or-source-changed")
        if (not _ANNUAL_SHA.fullmatch(str(expected_validation_sha))
                or row["validation_sha256"] != expected_validation_sha):
            raise ValueError("annual-draft-revision-mismatch")
        record = _annual_record_from_row(row)
        record = _validate_annual_review_sources(record, source_business, source_risks)
        if not row["validation_sha256"] or row["validation_sha256"] != _annual_validation_sha(record):
            raise ValueError("annual-draft-evidence-invalid")
        db.execute("""
          INSERT INTO annual_filing_review_history(
            ticker,accession_number,source_sha256,draft_validation_sha256,
            decision,reviewed_at,reviewer,reason
          ) VALUES(?,?,?,?,?,?,?,?)
        """, (
            ticker, accession, expected_sha, row["validation_sha256"],
            decision, reviewed_at, reviewer, reason,
        ))
        db.execute("""
          UPDATE annual_filing_briefs SET status=?,reviewed_at=?,reviewer=?,review_reason=?
          WHERE ticker=? AND accession_number=?
        """, (decision, reviewed_at, reviewer, reason, ticker, accession))
    return {"ticker": ticker, "accessionNumber": accession, "status": decision,
            "reviewedAt": reviewed_at, "published": False}


def _annual_row(row, private=False):
    if row is None:
        return None
    generated_at = row["generated_at"].replace("+00:00", "Z")
    reviewed_at = row["reviewed_at"].replace("+00:00", "Z") if row["reviewed_at"] else None
    value = {
        "id": row["brief_id"], "ticker": row["ticker"],
        "accessionNumber": row["accession_number"], "sourceSha256": row["source_sha256"],
        "summaryJa": row["summary_ja"], "businessModelJa": row["business_model_ja"],
        "riskPointsJa": json.loads(row["risk_points_json"]),
        "summaryEvidenceIds": json.loads(row["summary_evidence_ids_json"]),
        "businessModelEvidenceIds": json.loads(row["business_evidence_ids_json"]),
        "evidence": json.loads(row["evidence_json"]), "confidence": row["confidence"],
        "generationMethod": row["generation_method"], "status": row["status"],
        "generatedAt": generated_at, "reviewedAt": reviewed_at,
    }
    if private:
        value.update({
            "reviewer": row["reviewer"], "reviewReason": row["review_reason"],
            "validationSha256": row["validation_sha256"],
        })
    return value


_ANNUAL_QUEUE_VIEWS = {
    "all", "actionable", "invalid", "draft", "held", "approved", "rejected",
}


def annual_filing_brief_queue(db, limit=20, review_filter="all"):
    """Return private annual drafts in human-action order with integrity counts."""
    limit = max(1, min(int(limit), 50))
    if review_filter not in _ANNUAL_QUEUE_VIEWS:
        raise ValueError("invalid-annual-review-filter")
    rows = db.execute("""
      SELECT * FROM annual_filing_briefs
      ORDER BY generated_at DESC,ticker,accession_number
    """).fetchall()
    counts = {
        "total": len(rows), "draft": 0, "held": 0, "approved": 0,
        "rejected": 0, "integrity_invalid": 0, "actionable": 0,
    }
    items = []
    for row in rows:
        item = _annual_row(row, private=True)
        try:
            integrity_valid = bool(
                row["validation_sha256"]
                and row["validation_sha256"] == _annual_validation_sha(
                    _annual_record_from_row(row)
                )
            )
        except ValueError:
            integrity_valid = False
        item["integrityValid"] = integrity_valid
        status = row["status"] if row["status"] in {"draft", "held", "approved", "rejected"} else "draft"
        counts[status] += 1
        if not integrity_valid:
            counts["integrity_invalid"] += 1
        if not integrity_valid or status in {"draft", "held"}:
            counts["actionable"] += 1
        item["reviewHistory"] = []
        items.append(item)
    items_by_key = {(item["ticker"], item["accessionNumber"]): item for item in items}
    for history in db.execute("""
      WITH ranked AS (
        SELECT ticker,accession_number,source_sha256,draft_validation_sha256,
               decision,reviewed_at,reviewer,reason,
               ROW_NUMBER() OVER (
                 PARTITION BY ticker,accession_number ORDER BY id DESC
               ) AS history_rank
        FROM annual_filing_review_history
      )
      SELECT * FROM ranked WHERE history_rank<=10
      ORDER BY ticker,accession_number,history_rank
    """):
        item = items_by_key.get((history["ticker"], history["accession_number"]))
        if item is None:
            continue
        item["reviewHistory"].append({
            "sourceSha256": history["source_sha256"], "decision": history["decision"],
            "draftValidationSha256": history["draft_validation_sha256"],
            "reviewedAt": history["reviewed_at"].replace("+00:00", "Z"),
            "reviewer": history["reviewer"], "reason": history["reason"],
            "currentRevision": (
                history["source_sha256"] == item["sourceSha256"]
                and history["draft_validation_sha256"] is not None
                and history["draft_validation_sha256"] == item["validationSha256"]
            ),
        })
    priority = {"held": 1, "draft": 2, "rejected": 3, "approved": 4}
    items.sort(key=lambda item: (
        0 if not item["integrityValid"] else priority.get(item["status"], 5)
    ))
    if review_filter == "actionable":
        filtered = [item for item in items if not item["integrityValid"]
                    or item["status"] in {"draft", "held"}]
    elif review_filter == "invalid":
        filtered = [item for item in items if not item["integrityValid"]]
    elif review_filter == "all":
        filtered = items
    else:
        filtered = [item for item in items if item["status"] == review_filter]
    return {
        "generatedAt": now(), "counts": counts, "view": review_filter,
        "filteredTotal": len(filtered), "items": filtered[:limit],
    }


def approved_annual_filing_brief(db, ticker, accession, source_sha):
    """Return only an intact revision with a matching append-only approval."""
    if (not _ANNUAL_TICKER.fullmatch(str(ticker))
            or not _ANNUAL_ACCESSION.fullmatch(str(accession))
            or not _ANNUAL_SHA.fullmatch(str(source_sha))):
        raise ValueError("invalid-annual-filing-identity")
    row = db.execute("""
      SELECT b.* FROM annual_filing_briefs b
      WHERE b.ticker=? AND b.accession_number=? AND b.source_sha256=?
        AND b.status='approved' AND b.reviewed_at IS NOT NULL
        AND b.validation_sha256 IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM annual_filing_review_history h
          WHERE h.ticker=b.ticker AND h.accession_number=b.accession_number
            AND h.source_sha256=b.source_sha256
            AND h.draft_validation_sha256=b.validation_sha256
            AND h.decision='approved' AND h.reviewed_at=b.reviewed_at
        )
    """, (ticker, accession, source_sha)).fetchone()
    if row is None:
        return None
    try:
        if row["validation_sha256"] != _annual_validation_sha(_annual_record_from_row(row)):
            return None
    except ValueError:
        return None
    return _annual_row(row, private=False)


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
    brief_review.add_argument("--validation-sha256", required=True)
    brief_review.add_argument("--reviewer", required=True)
    brief_review.add_argument("--reason", required=True)
    annual_draft = sub.add_parser(
        "draft-annual",
        help="validate and store one private SEC annual-report draft from JSON",
    )
    annual_draft.add_argument(
        "--input", required=True,
        help="private JSON payload containing current SEC excerpts and cited evidence",
    )
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
            result = review_brief(
                db, args.url, args.sha256, args.decision, args.reviewer, args.reason,
                args.validation_sha256,
            )
        elif args.command == "draft-annual":
            candidate_path = Path(args.input)
            try:
                if candidate_path.stat().st_size > 60_000:
                    p.error("--input must be 60 KB or smaller")
                candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                p.error(f"could not read --input: {type(exc).__name__}")
            result = save_annual_filing_brief_draft(db, candidate)
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
