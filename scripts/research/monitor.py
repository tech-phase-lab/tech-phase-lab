Warning: truncated output (original token count: 46968)
Total output lines: 4007

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
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit
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
MIN_INLINE_FEED_CHARS = 120
MIN_SEC_EXHIBIT_CHARS = 120
SUPPORTED_CONTENT_TYPES = {
    "text/html", "application/pdf", "application/json", "application/rss+xml",
    "application/atom+xml", "application/xml", "text/xml",
}
PDF_FALLBACK_CONTENT_TYPES = {"application/octet-stream", "application/x-pdf"}
FETCH_CACHE_MAX_ENTRIES = 64
FETCH_CACHE_MAX_BYTES = 24 * 1024 * 1024
DISCOVERY_CACHE_MAX_BYTES = 2 * 1024 * 1024
# Increment this whenever discovery parsing semantics change. Persisted validators
# must not make a new deployment reuse candidates produced by an older parser.
DISCOVERY_CACHE_PARSER_VERSION = 1
_FETCH_CACHE = {}
_FETCH_CACHE_LOCK = threading.Lock()
ACCESS_RESTRICTED_ERRORS = {
    "http-401", "http-403", "http-451", "verification-page",
}


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
            ("unexpected-signal-content-type", "signal-content-type"),
            ("unapproved-signal-url", "signal-unapproved-url"),
            ("signal-response-limit", "signal-response-limit"),
            ("empty-signal-response", "signal-empty-response"),
            ("unsafe-signal-xml", "signal-unsafe-xml"),
            ("not-a-signal-feed", "signal-invalid-feed-root"),
            ("signal-item-limit", "signal-feed-item-limit"),
            ("signal-document-body-limit", "signal-document-body-invalid"),
            ("signal-index-invalid-sitemap", "signal-invalid-sitemap"),
            ("signal-index-invalid-listing", "signal-invalid-listing"),
            ("signal-index-no-articles", "signal-no-article-links"),
            ("signal-index-article-limit", "signal-article-limit"),
            ("signal-304-without-baseline", "signal-unexpected-not-modified"),
            ("signal-304-without-article", "signal-unexpected-not-modified"),
            ("signal-article-body-limit", "signal-article-body-invalid"),
            ("unsupported content type", "unsupported-content-type"),
            ("empty or oversized source", "empty-or-oversized-source"),
            ("source has no extractable text", "no-extractable-text"),
            ("sec exhibit evidence unavailable", "sec-exhibit-unavailable"),
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


def source_retry_seconds(error_code, failures, retry_hint=None):
    """Back off access controls without repeatedly probing a blocked official page."""
    access_restricted = error_code in ACCESS_RESTRICTED_ERRORS
    if access_restricted:
        # A denied or interstitial-protected route is unlikely to recover within
        # minutes. Keep it eligible for a later lawful retry, but do not hammer it
        # or let it crowd newly discovered first-party evidence out of the queue.
        retry_seconds = min(
            7 * 24 * 60 * 60,
            6 * 60 * 60 * (2 ** min(max(failures - 1, 0), 5)),
        )
    else:
        retry_seconds = min(6 * 60 * 60, 60 * (2 ** min(max(failures - 1, 0), 8)))
    if retry_hint is not None:
        retry_seconds = max(retry_seconds, retry_hint)
    return retry_seconds


def source_hostname(url):
    """Return a bounded normalized hostname for private circuit-breaker state."""
    try:
        hostname = (urlsplit(str(url)).hostname or "").lower().rstrip(".")
    except (TypeError, ValueError):
        return None
    if not hostname or len(hostname) > 253 or not re.fullmatch(r"[a-z0-9.-]+", hostname):
        return None
    return hostname


def fetch(url, ticker, validators=None, include_metadata=False):
    url = safe_url(url, ticker)
    cached = cached_fetch(url)
    conditional = dict(validators or {})
    force_unconditional = bool(conditional.pop("force_unconditional", False))
    if cached and not force_unconditional:
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


class SecIndexExhibits(HTMLParser):
    """Collect same-accession document links from rows typed exactly EX-99.1."""

    def __init__(self, base, ticker, directory):
        super().__init__(convert_charrefs=True)
        self.base, self.ticker, self.directory = base, ticker, directory
        self.row_depth = self.cell_depth = 0
        self.row_urls, self.cell_text, self.urls = set(), [], set()
        self.row_is_exhibit = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            if self.row_depth == 0:
                self.row_urls, self.cell_text = set(), []
                self.row_is_exhibit = False
            self.row_depth += 1
            return
        if not self.row_depth:
            return
        if tag in {"td", "th"}:
            self.cell_depth += 1
            if self.cell_depth == 1:
                self.cell_text = []
            return
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        try:
            url = article_url(safe_url(urljoin(self.base, href), self.ticker), self.ticker)
        except ValueError:
            return
        if not url:
            return
        parsed = urlsplit(url)
        filename = parsed.path.rsplit("/", 1)[-1]
        if (parsed.hostname == "www.sec.gov"
                and parsed.path.rsplit("/", 1)[0] + "/" == self.directory
                and re.search(r"\.(?:html?|pdf)$", filename, re.I)):
            self.row_urls.add(url)

    def handle_data(self, value):
        if self.cell_depth:
            self.cell_text.append(value)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.cell_depth:
            self.cell_depth -= 1
            if self.cell_depth == 0:
                label = " ".join(" ".join(self.cell_text).split())
                if re.fullmatch(r"EX(?:HIBIT)?[- .]*99[.\- ]?1", label, re.I):
                    self.row_is_exhibit = True
                self.cell_text = []
            return
        if tag == "tr" and self.row_depth:
            self.row_depth -= 1
            if self.row_depth == 0 and self.row_is_exhibit:
                self.urls.update(self.row_urls)


def sec_exhibit_links(content, filing_url, ticker):
    """Return explicit EX-99.1 links in the same immutable SEC filing directory.

    Filing HTML is untrusted input. The same-host and same-accession checks prevent
    it from turning article retrieval into a general-purpose URL fetcher.
    """
    parsed = urlsplit(filing_url)
    directory = parsed.path.rsplit("/", 1)[0] + "/"
    if (parsed.hostname != "www.sec.gov"
            or not re.fullmatch(r"/Archives/edgar/data/\d+/\d+/", directory)):
        return []
    markup = content[:MAX_EXTRACTED_CHARS * 2].decode("utf-8", "replace")
    parser = Links(filing_url, ticker)
    parser.feed(markup)
    parser.close()
    candidates = []
    for url in parser.urls:
        candidate = urlsplit(url)
        if candidate.hostname != "www.sec.gov" or candidate.path.rsplit("/", 1)[0] + "/" != directory:
            continue
        filename = candidate.path.rsplit("/", 1)[-1]
        label = parser.labels.get(url, "")
        identity = re.sub(r"[^a-z0-9]", "", f"{filename} {label}".lower())
        if not re.search(r"(?:exhibit|ex)99(?:01|1)(?:htm|html|pdf)?$", identity):
            if not re.search(r"\b(?:exhibit\s*)?99[.\- ]?1\b", label, re.I):
                continue
        score = 2 if re.search(r"\bEX(?:HIBIT)?[- .]*99[.\- ]?1\b", label, re.I) else 1
        candidates.append((score, url))
    index_parser = SecIndexExhibits(filing_url, ticker, directory)
    index_parser.feed(markup)
    index_parser.close()
    candidates.extend((3, url) for url in index_parser.urls)
    ranked = {}
    for score, url in candidates:
        ranked[url] = max(score, ranked.get(url, 0))
    return [url for url, _score in sorted(
        ranked.items(), key=lambda item: (-item[1], item[0])
    )[:2]]


def sec_filing_index_url(filing_url, ticker):
    """Derive SEC's canonical filing index without guessing another accession."""
    parsed = urlsplit(filing_url)
    directory = parsed.path.rsplit("/", 1)[0]
    accession = directory.rsplit("/", 1)[-1]
    if parsed.hostname != "www.sec.gov" or not re.fullmatch(r"\d{18}", accession):
        return None
    formatted = f"{accession[:10]}-{accession[10:12]}-{accession[12:]}"
    return article_url(
        urlunsplit((parsed.scheme, parsed.netloc, f"{directory}/{formatted}-index.html", "", "")),
        ticker,
    )


def sec_exhibit_evidence(content, filing_url, ticker, transport):
    """Fetch the first substantive EX-99.1 without leaving the filing directory."""
    candidates = sec_exhibit_links(content, filing_url, ticker)
    last_error = None
    # The primary 8-K/6-K document can contain substantive filing text without
    # linking its exhibits. The canonical same-accession index is authoritative
    # for the exhibit Type column, so consult it whenever the primary document
    # did not yield a safe candidate. Never broaden the lookup beyond the
    # immutable filing directory derived below.
    if not candidates:
        index_url = sec_filing_index_url(filing_url, ticker)
        if index_url and index_url != filing_url:
            try:
                index_content, index_type = transport(index_url, ticker)
                if index_type != "text/html":
                    raise ValueError("SEC filing index has unsupported content type")
                candidates = sec_exhibit_links(index_content, index_url, ticker)
                if not candidates:
                    last_error = ValueError("SEC exhibit link not found in filing index")
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                last_error = exc
    for url in candidates:
        try:
            exhibit, content_type = transport(url, ticker)
            extracted = extract_text(exhibit, content_type)
            meaningful = sum(character.isalnum() for character in extracted)
            if len(extracted) < MIN_SEC_EXHIBIT_CHARS or meaningful < 80:
                raise ValueError("SEC exhibit has no extractable text")
            return {
                "content": exhibit, "contentType": content_type,
                "extractedText": extracted, "url": url,
            }
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            last_error = exc
    if last_error is not None:
        return {"error": last_error}
    return None


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


def _feed_inline_text(element):
    """Convert one bounded RSS/Atom body field to safe plain-text evidence."""
    if element is None:
        return "", 0
    raw = "\n".join(element.itertext()).strip()
    if not raw:
        return "", 0
    parser = ArticleText()
    parser.feed(raw[:MAX_EXTRACTED_CHARS * 2])
    parser.close()
    text = parser.result()
    meaningful = sum(character.isalnum() for character in text)
    if len(text) < MIN_INLINE_FEED_CHARS or meaningful < 80:
        return "", len(raw.encode("utf-8"))
    return text, len(raw.encode("utf-8"))


def _feed_publication_date(item):
    """Return a source-stated calendar date without inventing a publication time."""
    atom = "{http://www.w3.org/2005/Atom}"
    candidates = [
        item.findtext("pubDate"), item.findtext(atom + "published"),
    ]
    for value in candidates:
        value = (value or "").strip()
        if not value:
            continue
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except (TypeError, ValueError, OverflowError):
                continue
        return parsed.date().isoformat()
    return None


def feed_links(body, ticker, content_type="application/rss+xml"):
    """Extract official links and substantive first-party feed evidence."""
    if b"\x00" in body or re.search(br"<!\s*(DOCTYPE|ENTITY)", body, re.I):
        raise ValueError("XML declarations with entities are not supported")
    root = ET.fromstring(body)
    atom = "{http://www.w3.org/2005/Atom}"
    content = "{http://purl.org/rss/1.0/modules/content/}"
    entries = root.findall("./channel/item") + root.findall(atom + "entry")
    links = {}
    for item in entries:
        url = item.findtext("link")
        if not url:
            for link in item.findall(atom + "link"):
                if link.get("rel", "alternate") == "alternate":
                    url = link.get("href")
                    break
        canonical = article_url(url or "", ticker)
        if canonical:
            title = item.findtext("title") or item.findtext(atom + "title") or ""
            title = " ".join(unescape(title).split())[:300] or None
            evidence_candidates = [
                _feed_inline_text(item.find(content + "encoded")),
                _feed_inline_text(item.find(atom + "content")),
                _feed_inline_text(item.find("description")),
                _feed_inline_text(item.find(atom + "summary")),
            ]
            evidence, content_bytes = max(evidence_candidates, key=lambda candidate: len(candidate[0]))
            published_on = _feed_publication_date(item)
            if evidence or published_on:
                detail = {"title": title, "publishedOn": published_on}
                if evidence:
                    detail.update({
                        "inlineText": evidence,
                        "contentBytes": content_bytes,
                        "contentType": content_type,
                    })
                links[canonical] = detail
            else:
                links[canonical] = title
    return lin…28968 tokens truncated…+ impact_ja):
        raise ValueError("Summary and impact must contain Japanese text")
    if impact_label not in {"positive", "negative", "mixed", "neutral", "uncertain"}:
        raise ValueError("Invalid impact label")
    if confidence not in {"low", "medium", "high"}:
        raise ValueError("Invalid confidence")
    if not isinstance(evidence, dict) or set(evidence) != {"summary", "impact"}:
        raise ValueError("Summary and impact evidence are required")
    cleaned = []
    cited_by_field = {}
    for field in ("summary", "impact"):
        if (not isinstance(evidence[field], list)
                or not 1 <= len(evidence[field]) <= 4
                or not all(isinstance(item, str) for item in evidence[field])):
            raise ValueError("Each evidence field requires one to four text excerpts")
        field_excerpts = []
        for excerpt in evidence[field]:
            excerpt = " ".join(excerpt.split())
            if not 12 <= len(excerpt) <= 800 or excerpt not in source_text:
                raise ValueError("Every evidence excerpt must appear exactly in the current source text")
            if excerpt in field_excerpts:
                raise ValueError("Evidence excerpts must be unique within each field")
            cleaned.append((field, excerpt))
            field_excerpts.append(excerpt)
        cited_by_field[field] = " ".join(field_excerpts)
    for field, text in (("summary", summary_ja), ("impact", impact_ja)):
        for token in _brief_numeric_claims(text):
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
        previous = db.execute(
            "SELECT source_sha256,generation_provider FROM briefs WHERE url=?", (url,)
        ).fetchone()
        preserve_ai_audit = bool(
            previous and previous["source_sha256"] == expected_sha
            and previous["generation_provider"]
        )
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
        if not preserve_ai_audit:
            db.execute("""
              UPDATE briefs SET generation_provider=NULL,generation_model=NULL,generation_response_id=NULL,
                                generation_source_truncated=0,generation_input_tokens=NULL,
                                generation_output_tokens=NULL,generation_total_tokens=NULL WHERE url=?
            """, (url,))
        db.executemany("INSERT INTO brief_evidence(url,field,excerpt) VALUES(?,?,?)", [(url, field, excerpt) for field, excerpt in cleaned])
    return {"url": url, "status": "draft", "generatedAt": generated_at, "published": False}


def review_brief(
    db, url, expected_sha, decision, reviewer, reason, expected_validation_sha,
    ai_verification=False,
):
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
        if (decision == "approved" and row["generation_provider"] is not None
                and ai_verification is not True):
            raise ValueError("ai-draft-human-verification-required")
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
            url,source_sha256,draft_validation_sha256,decision,reviewed_at,reviewer,reason,
            ai_verification
          ) VALUES(?,?,?,?,?,?,?,?)
        """, (
            url, expected_sha, row["validation_sha256"], decision,
            reviewed_at, reviewer, reason,
            int(row["generation_provider"] is not None and ai_verification is True),
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
    brief_review.add_argument(
        "--ai-verification", action="store_true",
        help="confirm human comparison of an AI-assisted draft with the official source",
    )
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
                args.validation_sha256, args.ai_verification,
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
