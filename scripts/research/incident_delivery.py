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
