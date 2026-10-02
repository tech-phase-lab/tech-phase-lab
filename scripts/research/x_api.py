"""Opt-in, read-only X recent-search adapter for private editorial review.

This module never publishes. X reads remain disabled unless both X_API_ENABLED
and X_BEARER_TOKEN are configured in the monitor service environment.
"""
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

API_URL = "https://api.x.com/2/tweets/search/recent"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_RESULTS = 30
OFFICIAL_ACCOUNTS = {"nebiusai": "NBIS"}
ALLOWED_ACCOUNT_NAMES = {"tipranks", "wallstengine", "fabymetal4", "trendspider", "barchart", *OFFICIAL_ACCOUNTS}
INDEX = re.compile(r'\b(?:S\s*&\s*P\s*500|SPX|Nasdaq[ -]?(?:100)?|NDX)\b',re.I)
MEMBERSHIP = re.compile(r'\b(?:rebalanc(?:e|ing)|reconstitution|add(?:s|ed|ition|itions|ing)?|remov(?:e|es|ed|al|als|ing)|join(?:s|ed|ing)?|replac(?:e|es|ed|ing)|inclusion|exclusion|delet(?:e|es|ed|ion|ions))\b|組み入れ|採用|除外|リバランス',re.I)
BONDS = re.compile(r'\b(?:Treasuries|Treasury (?:yields?|bonds?|notes?|bills?|auctions?)|government bonds?|sovereign bonds?|JGBs?|bunds?|gilts?)\b|\b(?:U\.?S\.?|United States|Japan(?:ese)?|German(?:y)?|Brit(?:ain|ish)|U\.?K\.?)\b.{0,60}\b(?:bonds? (?:yields?|market)|[0-9]+[ -]year bonds?)\b|国債',re.I)
OIL = re.compile(r'\b(?:crude(?: oil)?|WTI|Brent|oil (?:prices?|futures|production|supply|demand)|barrels?|OPEC\+?)\b|原油',re.I)


def market_topic(username,text):
    if username.lower()=='trendspider':
        if re.search(r'\b(?:trading tools|chart indicators|webinar|subscribe|giveaway)\b',text,re.I):
            return None
        event=bool(re.search(r'\brebalanc(?:e|ing)|\breconstitution|リバランス',text,re.I)
                   or re.search(r'\$[A-Z]{1,6}\b',text)
                   or re.search(r'\b(?:joins?|joining|replaces?|replacing|removed from|added to)\b.{0,100}\b(?:index|S\s*&\s*P\s*500|Nasdaq)',text,re.I))
        return 'index-membership' if INDEX.search(text) and MEMBERSHIP.search(text) and event else None
    if username.lower()=='barchart':
        return 'government-bonds' if BONDS.search(text) else 'crude-oil' if OIL.search(text) else None
    return None
TARGET_PATTERN = re.compile(
    r"\b(?:price[ -]?target|target price|pt\s+(?:raised|cut|lowered|hiked|boosted|slashed|(?:to|at)\s*\$?\d+))\b",
    re.I,
)
RATING_PATTERN = re.compile(r"\b(?:initiated|initiat(?:es|ing)\s+(?:coverage|with)|upgraded|downgraded|reiterat(?:es|ed)|maintain(?:s|ed))\b", re.I)
EARNINGS_PATTERN = re.compile(r"(?:\b(?:earnings|quarterly results|financial results|Q[1-4].{0,30}(?:results|highlights))\b|決算)", re.I)
EARNINGS_PREVIEW_PATTERN = re.compile(
    r"\b(?:earnings preview|ahead of (?:its |the )?earnings|upcoming earnings|"
    r"scheduled to report|expected to report|will report (?:its )?earnings)\b", re.I,
)
FINANCING_PATTERN = re.compile(
    r"\b(?:funding|financing|fundrais(?:ing|e)|capital rais(?:e|ing)|"
    r"convertible(?:[ -](?:senior|subordinated|unsecured|secured)){0,3}"
    r"[ -](?:notes?|bonds?|debt))\b|資金調達|転換社債", re.I,
)


def parse_response(source, payload, tickers):
    users = {str(user.get("id")): user for user in payload.get("includes", {}).get("users", [])
             if isinstance(user, dict)}
    items = {}
    for post in payload.get("data", []) or []:
        if not isinstance(post, dict):
            continue
        post_id = str(post.get("id", ""))
        note = post.get("note_post") or post.get("note_tweet")
        text = note.get("text") if isinstance(note, dict) and isinstance(note.get("text"), str) else post.get("text")
        author = users.get(str(post.get("author_id", "")), {})
        username = str(author.get("username", ""))
        if (not post_id.isdigit() or not isinstance(text, str) or not text.strip()
                or username.lower() not in {name.lower() for name in source.get("accounts", [])}
                or username.lower() not in ALLOWED_ACCOUNT_NAMES):
            continue
        matches = signals_match(text, tickers)
        if source.get('marketTopics'):
            topic=market_topic(username,text)
            if topic not in source['marketTopics']:
                continue
            matches={'MARKET':[topic]}
        official_ticker = OFFICIAL_ACCOUNTS.get(username.lower()) if source.get("officialUpdates") is True else None
        if official_ticker and official_ticker in tickers:
            matches[official_ticker] = ["official-account:" + username.lower()]
        # Keep X-only pilot tickers separate from the 22-company research roster.
        for ticker in source.get("extraTickers", []):
            if (ticker in source.get("tickers", []) and
                    re.search(r"(?<!\w)\$" + re.escape(ticker) + r"(?!\w)", text, re.I)):
                matches[ticker] = ["$" + ticker]
        if TARGET_PATTERN.search(text):
            # Explicit cashtags identify targets beyond the fixed research roster.
            cashtags = set(re.findall(r"(?<!\w)\$([A-Z]{1,5}(?:[.-][A-Z])?)(?![\w.])", text))
            if cashtags:
                matches = {ticker: ["$" + ticker] for ticker in cashtags}
        is_earnings = bool(EARNINGS_PATTERN.search(text) and
                           not EARNINGS_PREVIEW_PATTERN.search(text))
        is_economic = bool(re.search(r'\b(?:ADP|CPI|PPI|PCE|FOMC|NFP|GDP|nonfarm payrolls|unemployment rate)\b', text, re.I)
                           and re.search(r'(?:actual|実績|結果)\s*[:=]?\s*[-+−]?\d', text, re.I))
        if is_economic:
            matches = {'ECON':['economic-result']}
        is_financing = source.get('financingUpdates') is True and FINANCING_PATTERN.search(text)
        if not matches or not (source.get('marketTopics') or official_ticker or TARGET_PATTERN.search(text) or is_earnings or is_economic or RATING_PATTERN.search(text) or is_financing):
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


def fetch_posts(source, tickers, opener_factory=build_opener, validators=None):
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if os.environ.get("X_API_ENABLED", "").strip().lower() not in {"1", "true", "yes"}:
        raise ValueError("x-api-disabled")
    if not token:
        raise ValueError("x-api-token-missing")
    query = str(source.get("query", "")).strip()
    if not query or len(query) > 512:
        raise ValueError("x-api-query-invalid")
    max_results = max(10, min(MAX_RESULTS, int(source.get("maxResults", MAX_RESULTS))))
    params_dict = {
        "query": query,
        "max_results": max_results,
        "post.fields": "created_at,author_id,lang,note_post",
        "expansions": "author_id",
        "user.fields": "username",
    }
    cursor = {}
    try:
        cursor = json.loads((validators or {}).get('index_state', '{}'))
    except (ValueError, TypeError):
        pass
    if not isinstance(cursor, dict):
        cursor = {}
    since = cursor.get('sinceId')
    if isinstance(since,str) and since.isdigit():
        params_dict['since_id'] = since
    else:
        params_dict['start_time'] = cursor.get('startTime') or (datetime.now(timezone.utc)-timedelta(hours=12)).isoformat(timespec='seconds').replace('+00:00','Z')
    token_page = cursor.get('nextToken')
    if isinstance(token_page,str) and len(token_page)<=2048:
        params_dict['next_token'] = token_page
    params = urlencode(params_dict)
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
    meta = payload.get('meta') or {}
    newest = cursor.get('newestId') or meta.get('newest_id') or since
    if newest is not None and (not isinstance(newest, str) or not newest.isdigit()):
        raise ValueError('x-api-invalid-cursor')
    next_token = meta.get('next_token')
    if next_token is not None and (not isinstance(next_token, str) or not 1 <= len(next_token) <= 2048):
        raise ValueError('x-api-invalid-cursor')
    update = {'sinceId':since,'newestId':newest,'nextToken':next_token,'startTime':params_dict.get('start_time')} if next_token else {'sinceId':newest}
    return {"_items": parse_response(source, payload, tickers), "cursor_update":json.dumps(update)}
