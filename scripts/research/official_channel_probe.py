"""Opt-in reachability probe for official earnings channels that could not be tested from a development container (owner, Nov 23).

Off unless OFFICIAL_CHANNEL_PROBE_ENABLED=true. Every OFFICIAL_CHANNEL_PROBE_SECONDS (default 1800, never under 600) it sends one
plain GET to each fixed candidate below with the monitor's own declared User-Agent, follows no redirect, reads at most 64 KB and
keeps only what /health needs: the HTTP status, a fixed classification (ok, cloudflare-challenge, akamai-denied, twse-security-page,
http-NNN, timeout, error), the content type, the Last-Modified header and the elapsed time. Nothing is stored on disk, no body text is
kept, and no challenge is ever answered: a challenge or a refusal is the result being recorded.

robots.txt is respected: each host's robots.txt is read first in every round (its own status is recorded, since a blocked robots.txt
is itself the reachability answer) and a candidate path that robots.txt disallows is never requested (Business Wire's feed host,
for example, allows /rss/ only to named partners). The candidate list is code, not configuration, so the probe can never be pointed at an arbitrary address.
"""
from datetime import datetime, timezone
import os
import threading
import time
import urllib.robotparser
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import monitor

READ_LIMIT = 64 * 1024
HISTORY = 6

# Candidates the monitor cannot rely on yet. Each names the company and why it is worth knowing.
CANDIDATES = (
    {"id": "tsmc-press-center", "ticker": "TSM", "url": "https://pr.tsmc.com/english/latest-news",
     "why": "TSMC press center; the monitor's primary route, intermittently a Cloudflare challenge"},
    {"id": "tsmc-investor-quarterly", "ticker": "TSM", "url": "https://investor.tsmc.com/english/quarterly-results",
     "why": "TSMC investor site: management report and statements on results day"},
    {"id": "tsmc-corporate", "ticker": "TSM", "url": "https://www.tsmc.com/english",
     "why": "TSMC corporate site"},
    {"id": "twse-mops", "ticker": "TSM", "url": "https://mops.twse.com.tw/mops/",
     "why": "MOPS material information, filed by TSMC on results day"},
    {"id": "twse-mopsov", "ticker": "TSM", "url": "https://mopsov.twse.com.tw/mops/web/t05st01",
     "why": "MOPS (old interface) material information"},
    {"id": "twse-emops", "ticker": "TSM", "url": "https://emops.twse.com.tw/server-java/t58query",
     "why": "MOPS English material information"},
    {"id": "twse-openapi-material", "ticker": "TSM", "url": "https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
     "why": "TWSE open data material information; Last-Modified shows when the daily batch was built"},
    {"id": "sandisk-investor", "ticker": "SNDK", "url": "https://investor.sandisk.com/news-events/news-releases",
     "why": "Sandisk investor site (Akamai)"},
    {"id": "sandisk-gcs", "ticker": "SNDK", "url": "https://sandisk.gcs-web.com/",
     "why": "Sandisk investor site's platform host"},
    {"id": "businesswire-newsroom", "ticker": "SNDK", "url": "https://www.businesswire.com/newsroom",
     "why": "Business Wire release pages (full release text)"},
    {"id": "businesswire-technology-feed", "ticker": "SNDK",
     "url": "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpQWg==",
     "why": "Business Wire Technology feed; the monitor's SNDK primary route"},
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def enabled(env=None):
    env = os.environ if env is None else env
    return env.get("OFFICIAL_CHANNEL_PROBE_ENABLED", "").strip().lower() == "true"


def interval_seconds(env=None):
    env = os.environ if env is None else env
    try:
        value = int(env.get("OFFICIAL_CHANNEL_PROBE_SECONDS", "1800"))
    except ValueError:
        value = 1800
    return max(600, min(value, 86400))


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def classify(status, headers, head):
    """A fixed label for one response. ``head`` is the first bytes of the body; it is never stored."""
    head = head.lower()
    server = (headers.get("server") or "").lower()
    if headers.get("cf-mitigated") == "challenge" or (b"just a moment" in head and "cloudflare" in server):
        return "cloudflare-challenge"
    if b"for security reasons, this page can not be accessed" in head:
        return "twse-security-page"
    if status == 403 and (headers.get("akamai-grn") or "akamai" in server or b"access denied" in head):
        return "akamai-denied"
    if 200 <= status < 300:
        return "ok"
    return f"http-{status}"


def request(url, timeout=15):
    """One GET without redirects. Returns (status, headers with lower-cased names, the first READ_LIMIT bytes)."""
    headers = {"User-Agent": monitor.request_user_agent(), "Accept": "*/*"}
    try:
        with build_opener(NoRedirect()).open(Request(url, headers=headers), timeout=timeout) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read(READ_LIMIT)
    except HTTPError as exc:
        try:
            head = exc.read(READ_LIMIT)
        except Exception:
            head = b""
        return exc.code, {k.lower(): v for k, v in (exc.headers or {}).items()}, head


def outcome(url, transport):
    started = time.monotonic()
    try:
        status, headers, head = transport(url)
        result = {"status": status, "result": classify(status, headers, head),
                  "contentType": (headers.get("content-type") or "").split(";")[0].strip()[:60] or None,
                  "lastModified": (headers.get("last-modified") or None)}
        if 300 <= status < 400:
            result["redirectHost"] = urlsplit(headers.get("location") or "").hostname
    except (TimeoutError, OSError, URLError) as exc:
        timed_out = isinstance(exc, TimeoutError) or "timed out" in str(getattr(exc, "reason", exc)).lower()
        result = {"status": None, "result": "timeout" if timed_out else "error"}
    except Exception:
        result = {"status": None, "result": "error"}
    result["elapsedMs"] = round((time.monotonic() - started) * 1000)
    result["checkedAt"] = stamp()
    return result


def robots_allows(robots, url):
    """Whether robots.txt lets the probe request ``url`` (RFC 9309). Rules that were read are obeyed. A robots.txt answered with a
    4xx, a challenge or a security page publishes no rules, so the one probe request may be sent and its answer recorded. A robots.txt
    that could not be reached at all (5xx, timeout) means nothing else on that host is requested this round."""
    if robots["result"] == "ok":
        return robots["_parser"].can_fetch(monitor.request_user_agent(), url)
    status = robots.get("status")
    if status is not None and status < 500:
        return True
    return False


def run_round(transport=None, candidates=CANDIDATES):
    """Probe every candidate once. Returns {candidateId: outcome} plus each host's robots.txt outcome."""
    transport = transport or request
    robots_by_host = {}
    results = {}
    for candidate in candidates:
        host = urlsplit(candidate["url"]).hostname
        if host not in robots_by_host:
            captured = {}

            def keep(url, _captured=captured):
                status, headers, head = transport(url)
                _captured["head"] = head
                return status, headers, head
            robots = outcome(f"https://{host}/robots.txt", keep)
            if robots["result"] == "ok":
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(captured.get("head", b"").decode("utf-8", "replace").splitlines())
                robots["_parser"] = parser
            robots_by_host[host] = robots
        if robots_allows(robots_by_host[host], candidate["url"]):
            results[candidate["id"]] = outcome(candidate["url"], transport)
        else:
            results[candidate["id"]] = {"status": None, "result": "not-requested-robots", "checkedAt": stamp(), "elapsedMs": 0}
    hosts = {host: {k: v for k, v in robots.items() if not k.startswith("_")} for host, robots in robots_by_host.items()}
    return results, hosts


class Probe:
    """In-memory state shown in /health as officialChannelProbe."""

    def __init__(self, env=None):
        self.env = os.environ if env is None else env
        self.lock = threading.Lock()
        self.rounds = 0
        self.last_round_at = None
        self.history = {c["id"]: [] for c in CANDIDATES}
        self.robots = {}

    def run_once(self, transport=None):
        results, robots = run_round(transport)
        with self.lock:
            self.rounds += 1
            self.last_round_at = stamp()
            self.robots = robots
            for key, value in results.items():
                self.history[key] = ([value] + self.history.get(key, []))[:HISTORY]

    def diagnostics(self):
        with self.lock:
            return {
                "enabled": enabled(self.env), "intervalSeconds": interval_seconds(self.env), "rounds": self.rounds,
                "lastRoundAt": self.last_round_at, "robots": dict(self.robots),
                "candidates": [{"id": c["id"], "ticker": c["ticker"], "url": c["url"],
                                "latest": (self.history.get(c["id"]) or [None])[0],
                                "okCount": sum(1 for h in self.history.get(c["id"], []) if h["result"] == "ok"),
                                "recent": [h["result"] for h in self.history.get(c["id"], [])]} for c in CANDIDATES],
            }
