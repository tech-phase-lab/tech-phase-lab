"""Once a minute, ask the site to run one minute of the stock comparison's background refresh.

The site (app/api/research/compare/warm) decides which companies' turn it is and keeps the provider's per-minute credits under its own ceiling;
this lane only keeps the clock. Off unless both COMPARISON_WARM_URL (https) and COMPARISON_WARM_SECRET are set. The secret is sent only as the
Authorization header and never printed.
"""
import json
import os
import urllib.request
from urllib.parse import urlsplit


def config(env=None):
    env = os.environ if env is None else env
    url = (env.get("COMPARISON_WARM_URL") or "").strip()
    secret = (env.get("COMPARISON_WARM_SECRET") or "").strip()
    if not url or len(secret) < 32:
        return None
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.netloc or parts.username or parts.password:
        return None
    return url, secret


def run_once(env=None, opener=urllib.request.urlopen):
    settings = config(env)
    if not settings:
        return {"status": "off"}
    url, secret = settings
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}", "User-Agent": "TechPhaseMonitor/1.0"})
    try:
        with opener(request, timeout=55) as response:
            body = json.loads(response.read(65536) or b"{}")
        return {"status": "ok" if body.get("ok") else "error", "spent": body.get("spent"), "tickers": len(body.get("tickers") or [])}
    except Exception as exc:  # the next minute simply tries again
        return {"status": "error", "error": type(exc).__name__}


def seconds_to_next_minute(now):
    return 60 - (now % 60) + 1
