"""Opt-in, read-only X recent-search adapter for private editorial review.

This module never publishes. X reads remain disabled unless both X_API_ENABLED
and X_BEARER_TOKEN are configured in the monitor service environment.
"""
import json
import os
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

API_URL = "https://api.x.com/2/tweets/search/recent"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_RESULTS = 10
ALLOWED_ACCOUNT_NAMES = {"tipranks", "theflynews", "wallstengine"}
TARGET_PATTERN = re.compile(
    r"\b(?:price[ -]?target|target price|pt\s+(?:raised|cut|lowered|hiked|boosted|slashed|(?:to|at)\s*\$?\d+))\b",
    re.I,
)
EARNINGS_PATTERN = re.compile(r"\b(?:earnings|quarterly results|financial results)\b", re.I)
EARNINGS_PREVIEW_PATTERN = re.compile(
    r"\b(?:earnings preview|ahead of (?:its |the )?earnings|upcoming earnings|"
    r"scheduled to report|expected to report|will report (?:its )?earnings)\b", re.I,
)


def parse_response(source, payload, tickers):
    users = {str(user.get("id")): user for user in payload.get("includes", {}).get("users", [])
             if isinstance(user, dict)}
    items = {}
    for post in payload.get("data", []) or []:
        if not isinstance(post, dict):
            continue
        post_id = str(post.get("id", ""))
        text = post.get("text")
        author = users.get(str(post.get("author_id", "")), {})
        username = str(author.get("username", ""))
        if (not post_id.isdigit() or not isinstance(text, str) or not text.strip()
                or username.lower() not in {name.lower() for name in source.get("accounts", [])}
                or username.lower() not in ALLOWED_ACCOUNT_NAMES):
            continue
        matches = signals_match(text, tickers)
        is_earnings = bool(EARNINGS_PATTERN.search(text) and
                           not EARNINGS_PREVIEW_PATTERN.search(text))
        if not matches or not (TARGET_PATTERN.search(text) or is_earnings):
            continue
        url = f"https://x.com/{username}/status/{post_id}"
        items[url] = {
            "url": url,
            "title": " ".join(text.split())[:500],
            "text": text[:160000],
            "publishedAt": post.get("created_at"),
            "matches": matches,
            "truncated": len(text) > 160000,
        }
    return list(items.values())


def signals_match(text, tickers):
    # Import lazily so this adapter can be tested independently of monitor startup.
    import signals
    return signals.match_companies(text, tickers)


def fetch_posts(source, tickers, opener_factory=build_opener):
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if os.environ.get("X_API_ENABLED", "").strip().lower() not in {"1", "true", "yes"}:
        raise ValueError("x-api-disabled")
    if not token:
        raise ValueError("x-api-token-missing")
    query = str(source.get("query", "")).strip()
    if not query or len(query) > 512:
        raise ValueError("x-api-query-invalid")
    max_results = max(10, min(MAX_RESULTS, int(source.get("maxResults", MAX_RESULTS))))
    params = urlencode({
        "query": query,
        "max_results": max_results,
        "tweet.fields": "created_at,author_id,lang",
        "expansions": "author_id",
        "user.fields": "username",
    })
    request = Request(f"{API_URL}?{params}", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "TechPhaseResearch/1.0",
    })
    started = time.monotonic()
    try:
        with opener_factory().open(request, timeout=15) as response:
            content_type = response.headers.get_content_type()
            if content_type != "application/json":
                raise ValueError("x-api-unexpected-content-type")
            body = bytearray()
            while True:
                block = response.read(65536)
                if not block:
                    break
                body.extend(block)
                if len(body) > MAX_RESPONSE_BYTES or time.monotonic() - started > 20:
                    raise ValueError("x-api-response-limit")
    except HTTPError:
        raise
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        raise ValueError("x-api-invalid-json") from exc
    if not isinstance(payload, dict) or payload.get("errors"):
        raise ValueError("x-api-response-error")
    return {"_items": parse_response(source, payload, tickers)}
