"""Opt-in, read-only X recent-search adapter for private editorial review.

This module never publishes. X reads remain disabled unless both X_API_ENABLED
and X_BEARER_TOKEN are configured in the monitor service environment.
"""
import hashlib
import json
import os
import re
import time

import buyback_news
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
    r"\b(?:price[ -]?target|target price|pt\s+(?:raised|cut|lowered|hiked|increased|reduced|boosted|slashed|(?:to|at|of|from)\s*\$?\d+))\b",
    re.I,
)
RATING_PATTERN = re.compile(r"\b(?:initiated|initiat(?:es|ing)\s+(?:coverage|with)|upgraded|downgraded|reiterat(?:es|ed)|maintain(?:s|ed)|(?:reinstated|restored|named|selected)\s+as\s+(?:a\s+)?Top Pick|added\s+to\s+(?:(?:US|Q[1-4])\s+)?[\"\']?(?:Conviction List|Tactical Ideas list))\b", re.I)
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


def acquired_posts(source, payload):
    """Keep approved query results independently of downstream interpretation.

    These are private acquisition evidence, not publishable news. In particular,
    an unfamiliar result or target format must survive cursor advancement.
    """
    users = {str(user.get("id")): user for user in payload.get("includes", {}).get("users", [])
             if isinstance(user, dict)}
    posts = {}
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
        url = f"https://x.com/{username}/status/{post_id}"
        posts[url] = {"url": url, "title": " ".join(text.split())[:500],
                      "text": text[:160000], "publishedAt": post.get("created_at"),
                      "truncated": len(text) > 160000, "username": username}
    return list(posts.values())


def parse_response(source, payload, tickers):
    items = {}
    for acquired in acquired_posts(source, payload):
        text, username = acquired["text"], acquired["username"]
        matches = signals_match(text, tickers)
        is_buyback = source.get('buybackUpdates') is True and buyback_news.CUE.search(text)
        if source.get('marketTopics'):
            topic=market_topic(username,text)
            if topic in source['marketTopics']:
                matches={'MARKET':[topic]}
            elif is_buyback:
                matches=signals_match(text, tickers)
                approved=set(source.get('buybackTickers',tickers))
                matches={ticker:why for ticker,why in matches.items() if ticker in approved}
                for ticker in approved-set(tickers):
                    if re.search(r'(?<!\w)\$'+re.escape(ticker)+r'(?!\w)',text,re.I):
                        matches[ticker]=['$'+ticker]
            else:
                continue
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
        import market_results
        is_economic = market_results.projection(text, ['ECON']) is not None
        if is_economic:
            matches = {'ECON':['economic-result']}
        is_financing = source.get('financingUpdates') is True and FINANCING_PATTERN.search(text)
        if not matches or not (source.get('marketTopics') or official_ticker or TARGET_PATTERN.search(text) or is_earnings or is_economic or RATING_PATTERN.search(text) or is_financing or is_buyback):
            continue
        url = acquired["url"]
        items[url] = {key: value for key, value in acquired.items() if key != "username"}
        items[url]["matches"] = matches
    return list(items.values())


def signals_match(text, tickers):
    # Import lazily so this adapter can be tested independently of monitor startup.
    import signals
    return signals.match_companies(text, tickers)


def query_generation(source):
    """Bind pagination to acquisition scope, independently of parser/settings."""
    identity = [API_URL, str(source.get('query', '')).strip(),
                sorted(str(name).lower() for name in source.get('accounts', []))]
    return hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()


def window_expired(cursor, now=None):
    """A pinned recent-search lower bound is never silently moved forward."""
    value = cursor.get('startTime')
    if not value:
        return False
    try:
        start = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if not start.tzinfo:
            raise ValueError
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError('x-api-invalid-cursor') from exc
    return (now or datetime.now(timezone.utc)) - start > timedelta(days=7)


def page_evidence(source, payload):
    """Every returned row must be retained or explicitly excluded by author.

    Missing author expansion/body is incomplete evidence, not an empty page.
    Fail before advancing the cursor so a retry cannot skip an unknown record.
    """
    rows = payload.get('data', [])
    includes = payload.get('includes', {})
    if not isinstance(rows, list) or len(rows) > MAX_RESULTS or not isinstance(includes, dict):
        raise ValueError('x-api-incomplete-evidence')
    users = includes.get('users', [])
    if not isinstance(users, list) or any(not isinstance(u, dict) for u in users):
        raise ValueError('x-api-incomplete-evidence')
    authors = {str(u.get('id')): u.get('username') for u in users}
    approved = {str(name).lower() for name in source.get('accounts', [])} & ALLOWED_ACCOUNT_NAMES
    excluded = 0
    for row in rows:
        if not isinstance(row, dict) or not str(row.get('id', '')).isdigit():
            raise ValueError('x-api-incomplete-evidence')
        username = authors.get(str(row.get('author_id', '')))
        if not isinstance(username, str) or not username:
            raise ValueError('x-api-incomplete-evidence')
        if username.lower() not in approved:
            excluded += 1
            continue
        note = row.get('note_post') or row.get('note_tweet')
        body = note.get('text') if isinstance(note, dict) and isinstance(note.get('text'), str) else row.get('text')
        if not isinstance(body, str) or not body.strip():
            raise ValueError('x-api-incomplete-evidence')
    posts = acquired_posts(source, payload)
    # Duplicate source IDs with conflicting text must not silently disappear.
    if len(posts) + excluded != len(rows):
        raise ValueError('x-api-incomplete-evidence')
    return posts, excluded


def fetch_posts(source, tickers, opener_factory=build_opener, validators=None):
    if os.environ.get("X_FILTERED_STREAM_ENABLED", "").strip().lower() in {"1", "true", "yes"}:
        raise ValueError("x-api-stream-supervisor-required")
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
    generation = query_generation(source)
    if not isinstance(cursor, dict) or cursor.get('queryGeneration') != generation:
        # Unbound legacy state cannot establish coverage for a wider query.
        cursor = {}
    if window_expired(cursor):
        raise ValueError('x-api-window-expired')
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
    if not isinstance(meta, dict):
        raise ValueError('x-api-invalid-cursor')
    posts, excluded = page_evidence(source, payload)
    if 'result_count' in meta and (type(meta['result_count']) is not int or
                                   meta['result_count'] != len(payload.get('data', []))):
        raise ValueError('x-api-incomplete-evidence')
    ids = [value for value in (cursor.get('newestId'), meta.get('newest_id'), since)
           if value is not None]
    if any(not isinstance(value, str) or not value.isdigit() for value in ids):
        raise ValueError('x-api-invalid-cursor')
    newest = max(ids, key=int) if ids else None
    next_token = meta.get('next_token')
    if next_token is not None and (not isinstance(next_token, str) or not 1 <= len(next_token) <= 2048):
        raise ValueError('x-api-invalid-cursor')
    update = ({'sinceId': since, 'newestId': newest, 'nextToken': next_token,
               'startTime': params_dict.get('start_time')} if next_token else {'sinceId': newest})
    def count(key):
        value = cursor.get(key, 0)
        return value if type(value) is int and value >= 0 else 0
    update.update({'queryGeneration': generation,
                   'generationStartedAt': cursor.get('generationStartedAt') or datetime.now(timezone.utc).isoformat(),
                   'coverageStartedAt': cursor.get('coverageStartedAt') or params_dict.get('start_time'),
                   'pagesSaved': count('pagesSaved') + 1,
                   'postsSaved': count('postsSaved') + len(posts),
                   'excludedAuthorRows': count('excludedAuthorRows') + excluded,
                   'truncatedRows': count('truncatedRows') + sum(p['truncated'] for p in posts)})
    return {"_items": parse_response(source, payload, tickers),
            "_acquired_posts": posts, "cursor_update": json.dumps(update)}
