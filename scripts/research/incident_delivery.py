"""Fail-closed webhook adapter for operational incident transitions.

Nothing is sent unless an operator explicitly enables delivery and supplies a
cutover timestamp, HTTPS destination, and separate bearer token.
"""

from datetime import datetime, timezone
import hmac
import ipaddress
import json
import os
import re
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


class DeliveryUnavailable(RuntimeError):
    """Delivery is disabled or not safely configured."""


class DeliveryFailed(RuntimeError):
    """A configured delivery attempt failed without exposing response details."""


def _enabled(value):
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def _cutover(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds")
    except (TypeError, ValueError) as exc:
        raise DeliveryUnavailable("notification-cutover-invalid") from exc


def _webhook_url(value):
    value = str(value or "").strip()
    if "\r" in value or "\n" in value:
        raise DeliveryUnavailable("notification-url-invalid")
    parsed = urlsplit(value)
    try:
        invalid_port = parsed.port not in (None, 443)
    except ValueError as exc:
        raise DeliveryUnavailable("notification-url-invalid") from exc
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or invalid_port or parsed.fragment):
        raise DeliveryUnavailable("notification-url-invalid")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise DeliveryUnavailable("notification-url-invalid")
    try:
        address = ipaddress.ip_address(hostname.strip("[]"))
        if not address.is_global:
            raise DeliveryUnavailable("notification-url-invalid")
    except ValueError:
        if not re.fullmatch(r"[a-z0-9.-]+", hostname) or "." not in hostname:
            raise DeliveryUnavailable("notification-url-invalid")
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", parsed.query, ""))


def configuration(environ=None):
    environ = os.environ if environ is None else environ
    requested = _enabled(environ.get("RESEARCH_INCIDENT_DELIVERY_ENABLED"))
    if not requested:
        return {"requested": False, "configured": False, "enabled": False}
    if str(environ.get("RESEARCH_INCIDENT_DELIVERY_MODE", "")).strip().lower() == "web-push":
        # The owner's own phones through the site's Web Push (the route earnings and PPI alerts already use): no URL or bearer token.
        if str(environ.get("WEB_PUSH_ENABLED", "")).lower() != "true":
            raise DeliveryUnavailable("notification-web-push-disabled")
        return {"requested": True, "configured": True, "enabled": True, "mode": "web-push",
                "startAt": _cutover(environ.get("RESEARCH_INCIDENT_DELIVERY_START_AT"))}
    token = str(environ.get("RESEARCH_INCIDENT_WEBHOOK_TOKEN", ""))
    if not 32 <= len(token) <= 512 or "\r" in token or "\n" in token:
        raise DeliveryUnavailable("notification-token-invalid")
    return {
        "requested": True,
        "configured": True,
        "enabled": True,
        "startAt": _cutover(environ.get("RESEARCH_INCIDENT_DELIVERY_START_AT")),
        "url": _webhook_url(environ.get("RESEARCH_INCIDENT_WEBHOOK_URL")),
        "token": token,
    }


def public_payload(claim):
    """Return only bounded incident metadata; raw exceptions never enter the payload."""
    return {
        "schemaVersion": 1,
        "event": "tech-phase.operational-incident",
        "incident": {
            "key": claim["key"],
            "revision": claim["revision"],
            "transition": claim["transition"],
            "occurredAt": claim["occurredAt"],
            "category": claim["category"],
            "subject": claim["subject"],
            "severity": claim["severity"],
            "errorCode": claim.get("errorCode"),
        },
    }


def send_webhook(config, claim, opener=urlopen, timeout=10):
    if not config.get("enabled"):
        raise DeliveryUnavailable("notification-disabled")
    body = json.dumps(public_payload(claim), ensure_ascii=False, separators=(",", ":")).encode()
    request = Request(config["url"], data=body, method="POST", headers={
        "Authorization": "Bearer " + config["token"],
        "Content-Type": "application/json; charset=utf-8",
        "Idempotency-Key": f"tech-phase:{claim['key']}:{claim['revision']}:{claim['transition']}",
        "User-Agent": "TechPhaseResearch-IncidentDelivery/1.0",
    })
    try:
        response = opener(request, timeout=timeout)
        status = getattr(response, "status", None)
        status = int(status if status is not None else response.getcode())
        response.close()
        if not 200 <= status < 300:
            raise DeliveryFailed("notification-http-error")
    except DeliveryFailed:
        raise
    except Exception as exc:
        raise DeliveryFailed("notification-delivery-failed") from exc
    return True


def authorized_token(config, supplied):
    """Small helper for future adapters without logging either secret."""
    expected = config.get("token", "")
    return bool(expected) and hmac.compare_digest(str(supplied), expected)


PUSH_MAX_AGE_SECONDS = 30 * 60
PUSH_TEXT = {
    "discovery-all-sources-failing": ("公式発表の巡回が全社失敗しています", "決算・指標の検知が止まっている可能性があります。"),
    "monitor-stale": ("監視が止まっています", "巡回サイクルが更新されていません。"),
    "backup-failed": ("バックアップに失敗しました", "データのバックアップが取れていません。"),
    "backup-overdue": ("バックアップが遅れています", "データのバックアップが期限を過ぎています。"),
    "incident-watch-failed": ("障害見張りが失敗しました", "監視の見張り自体が動いていません。"),
}


def push_message(claim):
    title, body = PUSH_TEXT.get(claim.get("errorCode"), ("監視で異常を検知しました", "詳しくは監視の状態を確認してください。"))
    if claim["transition"] == "resolved":
        return {"title": "✅ 復旧しました", "body": "監視の異常が解消しました。", "tag": "incident-" + claim["key"], "url": "/research"}
    return {"title": "🚨 " + title, "body": body, "tag": "incident-" + claim["key"], "url": "/research"}


def send_owner_push(claim, devices, sender, now=None):
    """Send one incident transition to the owner's devices. Only CRITICAL transitions that happened in the last 30 minutes are sent;
    anything else (warnings, old rows) is consumed without a push, so enabling this can never replay the history. Returns the number
    of devices reached; raises DeliveryFailed when a critical transition reached none."""
    if claim.get("severity") != "critical":
        return 0
    occurred = datetime.fromisoformat(str(claim["occurredAt"]).replace("Z", "+00:00"))
    current = now or datetime.now(timezone.utc)
    if occurred.tzinfo is None or (current - occurred).total_seconds() > PUSH_MAX_AGE_SECONDS:
        return 0
    message = push_message(claim)
    reached = 0
    for subscription in devices:
        try:
            code = sender(json.loads(subscription), message)
        except Exception:
            code = 0  # never log endpoints, keys or provider responses
        reached += 200 <= code < 300
    if not reached:
        raise DeliveryFailed("notification-delivery-failed")
    return reached
