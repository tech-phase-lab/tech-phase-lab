"""Daily cron checks report their result to the monitor's incident alerts instead of crashing (owner, Nov 23).

A Railway cron run that exits non-zero shows as CRASHED, mails "deployment crashed" every morning and marks every release PR
with a failing Railway check. A check that ran to the end and found a problem is not a crashed job: it reports the problem to
the monitor, which records an operational incident and alerts the owner through the existing incident delivery (owner's phone
push or webhook), once per opening and once when it is resolved. The job then exits 0.

Client (the cron container):  RESEARCH_CRON_REPORT_URL (the monitor's base URL, https) and RESEARCH_CRON_REPORT_TOKEN.
Server (the monitor):          RESEARCH_CRON_REPORT_TOKEN (the same value, at least 32 characters). Unset: the route answers 404.

Only a fixed job name, ok and fixed check names travel; never titles, URLs, figures or environment values. When the report
cannot be delivered (not configured, monitor unreachable) the caller keeps the old behaviour and exits 1, so a problem is never
silent.
"""
import hmac
import json
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TOKEN_ENV = "RESEARCH_CRON_REPORT_TOKEN"
URL_ENV = "RESEARCH_CRON_REPORT_URL"
JOBS = frozenset({"earnings-selfcheck", "production-watch", "pro-compare"})  # pro-compare: recorded by the monitor itself
CODE = re.compile(r"[A-Za-z0-9_-]{1,32}")
MAX_CODES = 8
INCIDENT_PREFIX = "cron:"
CATEGORY = "cron-check"


def _token(env):
    token = str(env.get(TOKEN_ENV, ""))
    return token if 32 <= len(token) <= 512 and "\r" not in token and "\n" not in token else ""


def server_enabled(env=None):
    return bool(_token(os.environ if env is None else env))


def token_ok(header, env=None):
    token = _token(os.environ if env is None else env)
    return bool(token) and hmac.compare_digest(str(header or ""), "Bearer " + token)


def parse(payload):
    """(job, ok, codes) from a report body, or ValueError. Codes are check names such as 'live' or 'gaps'."""
    if not isinstance(payload, dict) or set(payload) - {"job", "ok", "codes"}:
        raise ValueError("invalid-report")
    job, ok, codes = payload.get("job"), payload.get("ok"), payload.get("codes", [])
    if job not in JOBS or not isinstance(ok, bool) or not isinstance(codes, list) or len(codes) > MAX_CODES:
        raise ValueError("invalid-report")
    if any(not isinstance(code, str) or not CODE.fullmatch(code) for code in codes):
        raise ValueError("invalid-report")
    if not ok and not codes:
        raise ValueError("invalid-report")
    return job, ok, sorted(set(codes))


def error_code(job, codes):
    return ("cron-check-failed:%s:%s" % (job, ".".join(codes)))[:120]


def record(db, payload, monitor, seen_at=None):
    """Open (or keep open) the job's incident when it failed, resolve it when it passed. Returns the transition."""
    job, ok, codes = parse(payload)
    key = INCIDENT_PREFIX + job
    if ok:
        return "resolved" if monitor.resolve_operational_incident(db, key, resolved_at=seen_at) else "ok"
    return monitor.record_operational_incident(db, key, CATEGORY, job, "critical", error_code(job, codes), seen_at=seen_at)


JOB_NAMES = {"earnings-selfcheck": "決算セルフチェック", "production-watch": "本番点検", "pro-compare": "PRO銘柄比較の点検"}


def push_message(claim):
    """The owner's phone text for a cron-check incident (None for other categories)."""
    if claim.get("category") != CATEGORY:
        return None
    job = claim.get("subject")
    name = JOB_NAMES.get(job, job or "毎日の点検")
    tag = "incident-" + str(claim.get("key"))
    if claim.get("transition") == "resolved":
        return {"title": "✅ %sが合格に戻りました" % name, "body": "毎日の点検の異常が解消しました。", "tag": tag, "url": "/research"}
    code = str(claim.get("errorCode") or "")
    failed = code.split(":", 2)[2].replace(".", "、") if code.count(":") >= 2 else "不明"
    return {"title": "🚨 %sで異常を検知しました" % name, "body": "不合格の項目: %s。Railwayのログで詳細を確認してください。" % failed,
            "tag": tag, "url": "/research"}


def _report_url(env):
    base = str(env.get(URL_ENV, "")).strip().rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    return base + "/internal/cron-report"


def send(job, ok, codes=(), env=None, opener=urlopen, timeout=15):
    """Deliver one report. Returns 'delivered', or 'not-configured' / 'failed' (fixed words; never response text)."""
    env = os.environ if env is None else env
    url, token = _report_url(env), _token(env)
    if not url or not token:
        return "not-configured"
    try:
        body = json.dumps({"job": job, "ok": ok, "codes": sorted(set(codes))}, separators=(",", ":")).encode()
        parse(json.loads(body))
        request = Request(url, data=body, method="POST", headers={
            "Authorization": "Bearer " + token, "Content-Type": "application/json",
            "User-Agent": "TechPhaseCronReport/1.0"})
        response = opener(request, timeout=timeout)
        status = int(getattr(response, "status", None) or response.getcode())
        response.close()
        return "delivered" if 200 <= status < 300 else "failed"
    except Exception:
        return "failed"
