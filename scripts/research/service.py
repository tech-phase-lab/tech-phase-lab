"""Always-on official-source monitor with a small authenticated HTTP API."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import gzip
import hmac
import json
import os
from pathlib import Path
import re
import signal
import threading
import time
from urllib.parse import parse_qs, urlsplit

import monitor
import brief_generator
import incident_delivery
import persistence
import signals
import price_target_reconciliation
import signal_source_detail
import stock_news
import news_drafts
import news_history
import editorial_posts
import questions
import note_translation
import question_translation
import headline_translation
import x_market_news
import analyst_news
import general_source_news
import issuer_business_news
import x_stream_runtime
import x_stream_pilot
import x_preflight_service
import x_stream_trial_service
import market_results
import official_research
import issuer_syndication
import official_research_diagnostics
import mu_earnings_measurement
import web_push


# The preview deployment previously pinned the complete 22-company roster in
# RESEARCH_TICKERS. Keep this one exact roster migration-safe after AMZN was
# deliberately replaced by BE, while continuing to reject typos and arbitrary
# retired tickers in every partial/custom roster.
LEGACY_FULL_TICKERS = (
    "MU", "SKHY", "SNDK", "NBIS", "NVDA", "AMD", "AVGO", "ARM", "TSM", "ASML",
    "MRVL", "ANET", "CRDO", "CRWV", "VRT", "GEV", "DELL", "PLTR", "MSFT", "AMZN",
    "GOOGL", "ORCL",
)
PRIORITY_SEC_TICKERS = ("TSM", "MRVL", "ANET", "VRT", "PLTR")
WEB_PUSH_POLL_SECONDS = 5
WEB_PUSH_STALE_SECONDS = 30
DISCOVERY_METRICS_FLUSH_SECONDS = 5
DISCOVERY_METRICS_MAX_CHECKS = 1000


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def positive_int(name, default, minimum):
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


def configured_tickers(value):
    configured = [item.strip().upper() for item in value.split(",") if item.strip()]
    if not configured:
        return list(monitor.PROVIDERS)
    unknown = sorted(set(configured) - set(monitor.PROVIDERS))
    if not unknown:
        return configured
    if len(configured) == len(LEGACY_FULL_TICKERS) and set(configured) == set(LEGACY_FULL_TICKERS):
        migrated = ["BE" if ticker == "AMZN" else ticker for ticker in configured]
        if len(set(migrated)) == len(migrated) and set(migrated) == set(monitor.PROVIDERS):
            return migrated
    raise ValueError("Unknown RESEARCH_TICKERS: " + ", ".join(unknown))


def timestamp_age_seconds(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return None


def timestamp_latency_ms(started_at, completed_at):
    """Return a bounded measured interval, or None for invalid/future evidence."""
    try:
        started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        completed = datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
        if started.tzinfo is None or completed.tzinfo is None or completed < started:
            return None
        latency = round((completed - started).total_seconds() * 1000)
        return latency if latency <= 31 * 24 * 60 * 60 * 1000 else None
    except (TypeError, ValueError, OverflowError):
        return None


def timestamp_at_or_after(value, reference):
    """Return whether two timezone-aware timestamps prove post-start activity."""
    try:
        observed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        started = datetime.fromisoformat(str(reference).replace("Z", "+00:00"))
        if observed.tzinfo is None or started.tzinfo is None:
            return False
        return observed.astimezone(timezone.utc) >= started.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return False


def bounded_retry_schedule(value, reference):
    """Classify a persisted retry time without letting corrupt values block work."""
    if not value:
        return "due", None
    try:
        current = datetime.fromisoformat(str(reference).replace("Z", "+00:00"))
        scheduled = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if current.tzinfo is None or scheduled.tzinfo is None:
            return "invalid", None
        current = current.astimezone(timezone.utc)
        scheduled = scheduled.astimezone(timezone.utc)
        if scheduled <= current:
            return "due", None
        if scheduled <= current + timedelta(days=7):
            return "deferred", scheduled
    except (TypeError, ValueError, OverflowError):
        return "invalid", None
    return "invalid", None


def body_error_kind(error):
    """Return a bounded, URL-free category for a persisted body-fetch error."""
    if error == "http-429":
        return "rateLimited"
    if error in {"http-401", "http-403", "http-451", "verification-page"}:
        return "accessRestricted"
    if error == "timeout":
        return "timeout"
    if error and re.fullmatch(r"http-5\d\d", error):
        return "server"
    if error in {
        "no-extractable-text", "sec-exhibit-unavailable", "pdf-encrypted",
        "pdf-page-limit", "pdf-no-text", "pdf-timeout", "pdf-extract-failed",
        "invalid-pdf",
    }:
        return "extraction"
    if error in {
        "unsupported-content-type", "empty-or-oversized-source",
        "invalid-source-response",
    }:
        return "invalidResponse"
    return "other"


def bounded_future_timestamp(value, reference):
    """Return a valid near-future UTC time, otherwise treat the value as due."""
    _state, scheduled = bounded_retry_schedule(value, reference)
    return scheduled


def active_body_host_backoff_state(db, reference):
    """Load bounded private host circuits and their earliest safe retry."""
    try:
        current = datetime.fromisoformat(str(reference).replace("Z", "+00:00"))
        if current.tzinfo is None:
            return {}, None
        current = current.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return {}, None
    active = {}
    # Do not pre-filter ISO timestamps as text. Valid offsets can invert their
    # lexical ordering relative to UTC (for example 04:30-02:00 is 06:30Z),
    # which could otherwise make a live circuit disappear from both states.
    for row in db.execute("""
      SELECT host,failures,error,retry_at,updated_at
      FROM body_host_backoff LIMIT 10000
    """).fetchall():
        try:
            updated = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"))
            retry = datetime.fromisoformat(str(row["retry_at"]).replace("Z", "+00:00"))
            failures = int(row["failures"])
            if updated.tzinfo is None or retry.tzinfo is None:
                continue
            updated = updated.astimezone(timezone.utc)
            retry = retry.astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            continue
        host = row["host"]
        if (
            monitor.source_hostname(f"https://{host}") != host
            or row["error"] not in monitor.ACCESS_RESTRICTED_ERRORS
            or not 1 <= failures <= 1_000_000
            or updated > current + timedelta(minutes=5)
            or retry <= current
            or retry > updated + timedelta(days=7, minutes=5)
        ):
            continue
        active[host] = retry
    next_probe = min(active.values()).isoformat(timespec="milliseconds") if active else None
    return active, next_probe


def active_body_host_backoffs(db, reference):
    """Return active circuit hostnames for internal queue filtering only."""
    active, _next_probe = active_body_host_backoff_state(db, reference)
    return set(active)


def due_body_host_backoff_state(db, reference):
    """Return valid expired circuit hosts and their evidence-backed due times."""
    try:
        current = datetime.fromisoformat(str(reference).replace("Z", "+00:00"))
        if current.tzinfo is None:
            return {}
        current = current.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return {}
    due = {}
    for row in db.execute("""
      SELECT host,failures,error,retry_at,updated_at
      FROM body_host_backoff LIMIT 10000
    """).fetchall():
        try:
            updated = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"))
            retry = datetime.fromisoformat(str(row["retry_at"]).replace("Z", "+00:00"))
            failures = int(row["failures"])
            if updated.tzinfo is None or retry.tzinfo is None:
                continue
            updated = updated.astimezone(timezone.utc)
            retry = retry.astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            continue
        host = row["host"]
        if (
            monitor.source_hostname(f"https://{host}") == host
            and row["error"] in monitor.ACCESS_RESTRICTED_ERRORS
            and 1 <= failures <= 1_000_000
            and updated <= current + timedelta(minutes=5)
            and updated <= retry <= current
            and retry <= updated + timedelta(days=7, minutes=5)
        ):
            due[host] = retry
    return due


def due_body_host_backoffs(db, reference):
    """Return valid expired circuit hostnames eligible for one private probe."""
    return set(due_body_host_backoff_state(db, reference))


def process_observation_latency_ms(value, started_at):
    """Return bounded post-start latency only for observations not in the future."""
    try:
        observed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        if observed.tzinfo is None or started.tzinfo is None:
            return None
        observed = observed.astimezone(timezone.utc)
        started = started.astimezone(timezone.utc)
        if observed < started or observed > datetime.now(timezone.utc):
            return None
        latency = round((observed - started).total_seconds() * 1000)
        return latency if latency <= 31 * 24 * 60 * 60 * 1000 else None
    except (TypeError, ValueError, OverflowError):
        return None


def priority_source_coverage(state, configured_tickers):
    """Summarize post-start priority checks without exposing source details."""
    configured = [ticker for ticker in PRIORITY_SEC_TICKERS if ticker in configured_tickers]
    companies = state.get("companies") if isinstance(state.get("companies"), dict) else {}
    checked = []
    latencies = []
    for ticker in configured:
        company = companies.get(ticker)
        if not isinstance(company, dict):
            continue
        latency = process_observation_latency_ms(
            company.get("checkedAt"), state.get("startedAt")
        )
        if latency is not None:
            checked.append(company)
            latencies.append(latency)
    healthy = sum(1 for company in checked if company.get("status") in {"ok", "fallback"})
    degraded = len(checked) - healthy
    return {
        "targetCount": len(PRIORITY_SEC_TICKERS),
        "configuredCount": len(configured),
        "checkedSinceStart": len(checked),
        "healthy": healthy,
        "degraded": degraded,
        "pending": len(configured) - len(checked),
        "omitted": len(PRIORITY_SEC_TICKERS) - len(configured),
        "completionLatencyMs": max(latencies) if len(checked) == len(configured) and latencies else None,
    }


def discovery_signature(result, links):
    """Hash bounded discovery evidence so same-URL feed revisions are observed."""
    digest = hashlib.sha256()

    def add(value):
        text = "" if value is None else str(value)
        digest.update(len(text).to_bytes(8, "big"))
        for offset in range(0, len(text), 4096):
            digest.update(text[offset:offset + 4096].encode("utf-8", "replace"))

    for key in (
        "status", "route", "sourceUrl", "sourceFormat", "sourcesChecked",
        "sourcesConfigured", "error",
    ):
        add(result.get(key))
    for url in sorted(links):
        add(url)
        candidate = links[url]
        if isinstance(candidate, dict):
            for key in ("title", "publishedOn", "contentType", "contentBytes", "inlineText"):
                add(candidate.get(key))
        else:
            add(candidate)
    return digest.hexdigest()


def discovery_has_verified_route(result):
    """True when at least one lawful official route completed successfully."""
    route = result.get("route")
    if route is not None:
        return route != "none"
    return result.get("status") in {"ok", "fallback"}


def discovery_requires_backoff(result):
    """Back off only total discovery failures, not a supplemental-route outage."""
    return result.get("status") == "degraded" and not discovery_has_verified_route(result)


class AutomaticMonitor:
    def __init__(self, db_path, snapshot_path):
        self.db_path = Path(db_path)
        self.snapshot_path = Path(snapshot_path)
        self.fast_seconds = positive_int("RESEARCH_FAST_POLL_SECONDS", 3, 3)
        self.standard_seconds = positive_int("RESEARCH_STANDARD_POLL_SECONDS", 5, 5)
        self.workers = positive_int("RESEARCH_MAX_WORKERS", 8, 1)
        self.body_interval = positive_int("RESEARCH_BODY_FETCH_INTERVAL_SECONDS", 10, 5)
        self.body_batch = min(100, positive_int("RESEARCH_BODY_FETCH_BATCH", 2, 1))
        self.backup_interval = positive_int("RESEARCH_BACKUP_INTERVAL_SECONDS", 3600, 300)
        self.backup_grace = positive_int("RESEARCH_BACKUP_GRACE_SECONDS", 600, 60)
        self.backup_retention = positive_int("RESEARCH_BACKUP_RETENTION", 24, 2)
        self.monitor_stale_seconds = positive_int("RESEARCH_MONITOR_STALE_SECONDS", 60, 15)
        self.incident_check_seconds = positive_int("RESEARCH_INCIDENT_CHECK_SECONDS", 5, 1)
        self.notification_interval = positive_int("RESEARCH_INCIDENT_DELIVERY_INTERVAL_SECONDS", 5, 1)
        self.notification_max_attempts = min(
            20, positive_int("RESEARCH_INCIDENT_DELIVERY_MAX_ATTEMPTS", 5, 1)
        )
        self.backup_dir = Path(os.environ.get(
            "RESEARCH_BACKUP_DIR", str(self.db_path.parent / "backups")
        ))
        self.auto_drafts_requested = os.environ.get("RESEARCH_AUTO_DRAFTS", "").strip().lower() in {"1", "true", "yes"}
        self.generation_daily_limit = positive_int("RESEARCH_AUTO_DRAFT_DAILY_LIMIT", 20, 1)
        self.generation_token_limit = positive_int("RESEARCH_AUTO_DRAFT_TOKEN_LIMIT", 100_000, 10_000)
        self.generation_max_attempts = positive_int("RESEARCH_AUTO_DRAFT_MAX_ATTEMPTS", 3, 1)
        self.generation_interval = positive_int("RESEARCH_AUTO_DRAFT_INTERVAL_SECONDS", 5, 1)
        try:
            brief_generator.configuration()
            generation_configured = True
        except brief_generator.GenerationUnavailable:
            generation_configured = False
        self.auto_drafts_enabled = self.auto_drafts_requested and generation_configured
        try:
            self.notification_config = incident_delivery.configuration()
            notification_configured = self.notification_config["configured"]
            notification_error = None
        except incident_delivery.DeliveryUnavailable as exc:
            self.notification_config = {"requested": True, "configured": False, "enabled": False}
            notification_configured = False
            notification_error = str(exc)
        self.notification_enabled = bool(self.notification_config.get("enabled"))
        self.web_push_enabled = bool(web_push.configuration()["enabled"])
        self.tickers = configured_tickers(os.environ.get("RESEARCH_TICKERS", ""))
        self.signals_enabled = os.environ.get("RESEARCH_SIGNALS_ENABLED", "").lower() in {"1", "true", "yes"}
        self.x_stream_requested = x_stream_runtime.requested()
        self.x_stream_status = {"mode": "waiting"} if self.x_stream_requested else None
        self.priority_completion_latency_ms = None
        self.priority_metrics_interval = positive_int(
            "RESEARCH_PRIORITY_METRICS_INTERVAL_SECONDS", 300, 30
        )
        self.priority_metrics_signature = None
        self.next_priority_metrics_at = 0.0
        self.body_probe_urls = set()
        self.body_probe_eligible_at = {}
        self.stop_event = threading.Event()
        self.backup_initial_complete = threading.Event()
        self.db_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.state = {
            "ready": False,
            "startedAt": utc_now(),
            "lastCycleAt": None,
            "lastCycleDurationMs": None,
            "lastCycleCompanies": 0,
            "lastChangeAt": None,
            "cycles": 0,
            "newSources": 0,
            "sourceChecks": 0,
            "sourceFetchErrors": 0,
            "sourceNotModified": 0,
            "discoveryCache": {
                "persistedSources": 0, "invalidatedSources": 0,
                "conditionalRequests": 0, "notModifiedResponses": 0,
                "freshResponses": 0, "lastUpdatedAt": None,
            },
            "bodyFetch": {
                "lastPollAt": None, "lastBatchAt": None,
                "lastBatchDurationMs": None, "lastBatchChecks": 0,
                "lastBatchErrors": 0, "lastBatchNotModified": 0,
                "healthy": None, "consecutiveFailures": 0, "lastError": None,
                "retrySeconds": 0, "nextRetryAt": None,
            },
            "pendingBodies": 0,
            "bodyBacklog": {
                "eligible": 0, "hostDeferred": 0,
                "activeHostCircuits": 0, "nextHostProbeAt": None,
                "dueHostCircuits": 0, "scheduledHostProbes": 0,
                "retryDeferred": 0, "accessRestricted": 0, "rateLimited": 0,
                "errorKinds": {
                    "accessRestricted": 0, "rateLimited": 0, "timeout": 0,
                    "server": 0, "extraction": 0, "invalidResponse": 0,
                    "other": 0,
                },
                "invalidRetrySchedules": 0,
                "recheckDeferred": 0, "neverFetched": 0,
                "detectedNeverFetched": 0, "baselineNeverFetched": 0,
                "detectedNeverFetchedMeasured": 0, "detectedNeverFetchedUnmeasured": 0,
                "detectedNeverFetchedAgeMaxMs": None,
                "oldestDetectedNeverFetchedAt": None,
                "fairnessScheduled": False,
                "fairnessAgeMs": None,
                "fairnessSharedHost": False,
                "scheduledDetectedNeverFetched": 0,
                "scheduledBaselineNeverFetched": 0,
                "scheduledExtractionPending": 0,
                "scheduledRecheck": 0,
                "extractionPending": 0, "extracted": 0,
                "canonicalAliasRows": 0,
                "canonicalDuplicateGroups": 0,
                "canonicalDuplicateRows": 0,
                "canonicalInvalidRows": 0,
                "total": 0, "measuredAt": None,
            },
            "tickerCount": len(self.tickers),
            "generation": {
                "requested": self.auto_drafts_requested, "configured": generation_configured,
                "enabled": self.auto_drafts_enabled, "dailyLimit": self.generation_daily_limit,
                "tokenLimit": self.generation_token_limit, "maxAttempts": self.generation_max_attempts,
            },
            "backup": {
                "enabled": True, "intervalSeconds": self.backup_interval,
                "graceSeconds": self.backup_grace,
                "retention": min(self.backup_retention, 168), "lastAttemptAt": None,
                "lastSuccessAt": None, "healthy": None, "backupCount": 0,
                "lastError": None,
            },
            "incidentWatch": {
                "enabled": True, "intervalSeconds": self.incident_check_seconds,
                "lastCheckAt": None, "healthy": None, "lastError": None,
            },
            "priorityPersistence": {
                "lastAttemptAt": None, "lastSuccessAt": None,
                "healthy": None, "lastError": None,
            },
            "notification": {
                "requested": self.notification_config["requested"],
                "configured": notification_configured, "enabled": self.notification_enabled,
                "intervalSeconds": self.notification_interval,
                "maxAttempts": self.notification_max_attempts,
                "attempts": 0, "delivered": 0, "lastAttemptAt": None,
                "lastSuccessAt": None, "lastError": notification_error,
            },
            "webPush": {
                "enabled": self.web_push_enabled,
                "status": "waiting" if self.web_push_enabled else "disabled",
                "intervalSeconds": WEB_PUSH_POLL_SECONDS, "activeDevices": 0,
                "maxDevices": web_push.DEVICE_LIMIT,
                "attempted": 0, "accepted": 0, "uncertain": 0,
                "attempted24Hours": 0, "accepted24Hours": 0,
                "uncertain24Hours": 0, "expired24Hours": 0,
                "detectionToAttemptSamples24Hours": 0,
                "detectionToAttemptAverageMs24Hours": None,
                "detectionToAttemptMaxMs24Hours": None,
                "providerResponseSamples24Hours": 0,
                "providerResponseAverageMs24Hours": None,
                "providerResponseMaxMs24Hours": None,
                "detectionToOutcomeSamples24Hours": 0,
                "detectionToOutcomeAverageMs24Hours": None,
                "detectionToOutcomeMaxMs24Hours": None,
                "polls": 0, "failures": 0, "consecutiveFailures": 0,
                "recoveries": 0, "lastPollAt": None, "lastSuccessAt": None,
                "lastFailureAt": None, "lastAttemptAt": None,
                "lastPollAgeSeconds": None,
                "pollOverdueAfterSeconds": WEB_PUSH_STALE_SECONDS,
                "pollOverdue": False,
            },
            "companies": {},
        }
        self.publication_wakes = {name: threading.Event() for name in (
            "headlines", "market", "results", "official",
        )}
        self.thread = threading.Thread(target=self.run_supervised, name="research-monitor", daemon=True)
        self.generation_thread = threading.Thread(target=self.run_generation, name="brief-generator", daemon=True)
        self.backup_thread = threading.Thread(target=self.run_backup, name="database-backup", daemon=True)
        self.incident_thread = threading.Thread(
            target=self.run_incident_watch, name="incident-watch", daemon=True
        )
        self.notification_thread = threading.Thread(
            target=self.run_notification_delivery, name="incident-delivery", daemon=True
        )
        self.signals_thread = threading.Thread(target=self.run_signals, name="research-signals", daemon=True)
        self.x_stream_thread = (threading.Thread(target=self.run_x_stream, name="x-filtered-stream", daemon=True)
                                if self.x_stream_requested else None)
        self.x_preflight_thread = (threading.Thread(target=self.run_x_preflight, name="x-metadata-preflight", daemon=True)
                                   if x_preflight_service.requested() else None)
        self.x_stream_trial_thread = (threading.Thread(target=self.run_x_stream_trial, name="x-receive-only-trial", daemon=True)
                                      if x_stream_trial_service.requested() else None)
        self.push_thread = threading.Thread(target=self.run_web_push, name="web-push-pilot", daemon=True)
        self.note_translation_thread = threading.Thread(target=self.run_note_translation, name="note-translation", daemon=True)
        self.headline_translation_thread = threading.Thread(target=self.run_headline_translation, name="headline-translation", daemon=True)
        self.market_translation_thread = threading.Thread(target=self.run_market_translation, name="market-translation", daemon=True)
        self.result_thread = threading.Thread(target=self.run_results, name="result-publication", daemon=True)
        self.official_research_thread = threading.Thread(target=self.run_official_research, name="official-research", daemon=True)
        self.mu_measurement_thread = threading.Thread(target=self.run_mu_measurement, name="mu-earnings-measurement", daemon=True)
        self.news_thread = threading.Thread(target=self.run_stock_news, name="stock-news-intake", daemon=True)

    def run_x_preflight(self):
        # Startup backup may temporarily require one full extra DB-sized copy.
        # Observe the volume only after that work (or recovery) has completed.
        completed = self.backup_initial_complete.wait(30)
        with self.state_lock:
            backup_ready = completed and self.state["backup"]["healthy"] is True
        x_preflight_service.run_once(self.db_path, self.stop_event, allow_metadata=backup_ready)

    def trial_backup_readiness(self, probe_end_at, margin_seconds):
        now = datetime.now(timezone.utc)
        with self.state_lock:
            backup = dict(self.state["backup"])
        try:
            success = datetime.fromisoformat(backup["lastSuccessAt"].replace("Z", "+00:00")).astimezone(timezone.utc)
            attempted = (datetime.fromisoformat(backup["lastAttemptAt"].replace("Z", "+00:00")).astimezone(timezone.utc)
                         if backup["lastAttemptAt"] else None)
            next_due = success + timedelta(seconds=self.backup_interval)
            healthy = (self.backup_initial_complete.is_set() and backup["healthy"] is True
                       and not self.stop_event.is_set() and (attempted is None or attempted <= success)
                       and next_due > probe_end_at + timedelta(seconds=margin_seconds))
            return {"healthy": healthy, "next_backup_at": next_due.isoformat(), "verified_at": now.isoformat()}
        except (TypeError, ValueError, AttributeError):
            return {"healthy": False, "next_backup_at": None, "verified_at": now.isoformat()}

    def run_x_stream_trial(self):
        if not self.backup_initial_complete.wait(30) or self.stop_event.is_set():
            return
        x_stream_trial_service.run_once(self.db_path, self.stop_event,
                                       backup_readiness=self.trial_backup_readiness)

    def run_x_stream(self):
        if not self.x_stream_requested:
            return
        def report(state):
            with self.state_lock:
                self.x_stream_status = state
        x_stream_pilot.PilotSupervisor(self.db_path, self.tickers, self.stop_event,
                                    self.wake_publication_workers, report=report).run()

    def run_note_translation(self):
        if note_translation.configuration(os.environ) is None:
            return
        while not self.stop_event.is_set():
            try:
                note_translation.run_once(self.db_path)
                question_translation.run_once(self.db_path)
            except Exception:
                print("note-translation-unavailable", flush=True)
            self.stop_event.wait(30)

    def run_headline_translation(self):
        if headline_translation.configuration(os.environ) is None:
            return
        wake = self.publication_wakes["headlines"]
        while not self.stop_event.is_set():
            wake.clear()
            try:
                headline_translation.run_once(self.db_path)
            except Exception:
                print("headline-translation-unavailable", flush=True)
            if not self.stop_event.is_set():
                wake.wait(5)

    def run_market_translation(self):
        if headline_translation.configuration(os.environ) is None:
            return
        wake = self.publication_wakes["market"]
        while not self.stop_event.is_set():
            wake.clear()
            try:
                x_market_news.run_once(self.db_path)
            except Exception:
                print("market-translation-unavailable", flush=True)
            if not self.stop_event.is_set():
                wake.wait(5)

    def run_results(self):
        # Numerical flashes must not wait for an LLM or require an API key.
        wake = self.publication_wakes["results"]
        while not self.stop_event.is_set():
            wake.clear()
            try:
                analyst_news.run_once(self.db_path)
            except Exception:
                print("analyst-news-publication-unavailable", flush=True)
            try:
                market_results.run_once(self.db_path, signals.SOURCES)
            except Exception:
                print("result-publication-unavailable", flush=True)
            if os.environ.get("OFFICIAL_HEADLINE_TRANSLATION_ENABLED") == "true":
                try:
                    x_market_news.publish_direct_once(self.db_path)
                except Exception:
                    print("market-facts-publication-unavailable", flush=True)
            if not self.stop_event.is_set():
                wake.wait(5)

    def run_official_research(self):
        wake = self.publication_wakes["official"]
        while not self.stop_event.is_set():
            wake.clear()
            try:
                official_research.run_once(self.db_path)
            except Exception:
                print("official-research-unavailable", flush=True)
            try:
                issuer_syndication.run_once(self.db_path, datetime.now(timezone.utc))
            except Exception:
                print("issuer-syndication-unavailable", flush=True)
            if not self.stop_event.is_set():
                wake.wait(5)

    def wake_publication_workers(self):
        # Notifications are local hints, not publication approval. Every worker
        # still enforces its own source, revision, retry and spending gates.
        for wake in self.publication_wakes.values():
            wake.set()

    def run_mu_measurement(self):
        while not self.stop_event.is_set():
            try:
                mu_earnings_measurement.run_once(self.db_path, env=os.environ)
            except Exception:
                print("mu-measurement-unavailable", flush=True)
            self.stop_event.wait(5)

    def run_web_push(self):
        if not self.web_push_enabled:
            return
        while not self.stop_event.is_set():
            polled_at = utc_now()
            try:
                items = self.public_price_targets()["items"]
                with web_push.connect(self.db_path) as db:
                    result = web_push.deliver(db, items)
                with self.state_lock:
                    previous = self.state["webPush"]
                    self.state["webPush"] = {
                        **previous, **result, "enabled": True,
                        "polls": previous["polls"] + 1,
                        "recoveries": previous["recoveries"] + int(
                            previous["consecutiveFailures"] > 0),
                        "consecutiveFailures": 0, "lastPollAt": polled_at,
                        "lastSuccessAt": utc_now(),
                    }
            except Exception:
                with self.state_lock:
                    push = self.state["webPush"]
                    push.update({"status": "error", "polls": push["polls"] + 1,
                                 "failures": push["failures"] + 1,
                                 "consecutiveFailures": push["consecutiveFailures"] + 1,
                                 "lastPollAt": polled_at, "lastFailureAt": utc_now()})
            self.stop_event.wait(WEB_PUSH_POLL_SECONDS)

    def start(self):
        # Complete migrations before translation/result workers open their own
        # connections. Parallel PRAGMA checks followed by ALTER TABLE can race
        # on an existing volume and silently kill the discovery worker.
        with self.db_lock, monitor.connect(self.db_path):
            pass
        self.thread.start()
        self.generation_thread.start()
        self.backup_thread.start()
        self.incident_thread.start()
        self.notification_thread.start()
        self.signals_thread.start()
        if self.x_preflight_thread:
            self.x_preflight_thread.start()
        if self.x_stream_thread:
            self.x_stream_thread.start()
        if self.x_stream_trial_thread:
            self.x_stream_trial_thread.start()
        self.news_thread.start()
        self.note_translation_thread.start()
        self.headline_translation_thread.start()
        self.market_translation_thread.start()
        self.result_thread.start()
        self.official_research_thread.start()
        self.mu_measurement_thread.start()
        self.push_thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake_publication_workers()
        self.thread.join(timeout=15)
        self.generation_thread.join(timeout=45)
        self.backup_thread.join(timeout=15)
        self.incident_thread.join(timeout=15)
        self.notification_thread.join(timeout=15)
        self.signals_thread.join(timeout=45)
        if self.x_preflight_thread:
            self.x_preflight_thread.join(timeout=45)
        if self.x_stream_thread:
            self.x_stream_thread.join(timeout=45)
        if self.x_stream_trial_thread:
            self.x_stream_trial_thread.join(timeout=45)
        self.news_thread.join(timeout=25)
        self.note_translation_thread.join(timeout=45)
        self.headline_translation_thread.join(timeout=45)
        self.market_translation_thread.join(timeout=45)
        self.result_thread.join(timeout=15)
        self.official_research_thread.join(timeout=45)
        self.mu_measurement_thread.join(timeout=45)
        self.push_thread.join(timeout=15)

    def run_stock_news(self):
        # No schema writes or network activity until explicitly enabled.
        if os.environ.get("STOCK_NEWS_ENABLED", "").lower() != "true" or not os.environ.get("STOCK_NEWS_API_KEY", "").strip():
            return
        tickers = os.environ.get("STOCK_NEWS_TICKERS", "").split(",")
        if tickers == [""]:
            tickers = sorted(set(self.tickers) | signals.X_EXTRA_TICKERS)
        while not self.stop_event.is_set():
            try:
                # Independent connection: no shared database lock across HTTP.
                with stock_news.connect(self.db_path) as db:
                    result = stock_news.poll(db, tickers)
                with self.state_lock:
                    self.state["stockNewsIntake"] = {**result, "checkedAt": utc_now()}
            except Exception:
                with self.state_lock:
                    self.state["stockNewsIntake"] = {"status": "error", "error": "stock-news-worker-failed"}
            self.stop_event.wait(60)

    def stock_news_queue(self, limit=20):
        with stock_news.connect(self.db_path) as db:
            return stock_news.queue(db, limit)

    def official_research_queue(self, limit=20, view="pending"):
        return official_research_diagnostics.queue(self.db_path, limit, view)

    def generate_news_draft(self, payload):
        with stock_news.connect(self.db_path) as db:
            return news_drafts.generate(db, payload.get("articleId"), payload.get("revision"))

    def retry_news_draft(self, payload):
        with stock_news.connect(self.db_path) as db:
            return news_drafts.retry(db, payload)

    def review_news_draft(self, payload):
        with stock_news.connect(self.db_path) as db:
            return news_drafts.review(
                db, payload.get("articleId"), payload.get("revision"), payload.get("fingerprint"),
                payload.get("decision"), payload.get("reviewer"), payload.get("reason"),
                payload.get("verification"),
            )

    def save_news_draft(self, payload):
        with stock_news.connect(self.db_path) as db:
            return news_drafts.save_manual(db, payload)

    def public_news(self):
        with stock_news.connect(self.db_path) as db:
            return news_history.bounded({**news_drafts.public_feed(db),
                "officialUpdates": signals.public_official_updates(db, limit=500),
                "marketUpdates": x_market_news.public_feed(db),
                "analystUpdates": analyst_news.public_feed(db),
                "resultBriefs": market_results.public_feed(db),
                "officialResearch": official_research.feed(db)})

    def posts_queue(self, limit=20, published=False, offset=0):
        with editorial_posts.connect(self.db_path) as db:
            return editorial_posts.queue(db, limit, published, offset)

    def save_post(self, payload, review=False):
        with editorial_posts.connect(self.db_path) as db:
            return editorial_posts.review(db, payload) if review else editorial_posts.save(db, payload)

    def submit_question(self, payload):
        with questions.connect(self.db_path) as db:
            return questions.submit(db, payload)

    def member_questions(self, owner_key, limit=20, board=False):
        with questions.connect(self.db_path) as db:
            return questions.board_queue(db, owner_key, 50) if board else questions.member_queue(db, owner_key, limit)

    def question_queue(self, view="pending", limit=50):
        # Ensure the answer-candidate table exists even on a fresh database.
        with editorial_posts.connect(self.db_path):
            pass
        with questions.connect(self.db_path) as db:
            return questions.moderation_queue(db, view, limit)

    def review_question(self, payload):
        with editorial_posts.connect(self.db_path):
            pass
        with questions.connect(self.db_path) as db:
            return questions.review(db, payload)

    def answer_question(self, payload):
        with editorial_posts.connect(self.db_path):
            pass
        with questions.connect(self.db_path) as db:
            return questions.answer(db, payload)

    def signal_queue(self, limit=30, view="all", ticker=None):
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = signals.queue(db, limit=limit, view=view, ticker=ticker)
            result["priceTargetReconciliation"] = price_target_reconciliation.report(db)
        return {**result, "enabled": self.signals_enabled, "tickers": self.tickers,
                "workerAlive": self.signals_thread.is_alive()}

    def signal_source_detail(self, event_id):
        return signal_source_detail.detail(self.db_path, event_id)

    def public_price_targets(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return signals.public_price_targets(db)

    def run_signals(self):
        if not self.signals_enabled:
            return
        try:
            import x_replay
            with self.db_lock, monitor.connect(self.db_path) as db:
                replay = x_replay.replay_acquired(db, signals.enabled_sources(), self.tickers)
            if replay['recovered'] or replay['invalidated']:
                self.wake_publication_workers()
        except Exception:
            # A replay problem must not stop fresh intake. Retained evidence
            # remains available for diagnosis and a later repaired restart.
            print('{"event":"signal-replay-error"}', flush=True)
        workers = 3
        # Do not wait for a whole batch: one slow publisher must not postpone
        # every other route's next due check. Keep only one request per source
        # in flight and no executor backlog, with the existing concurrency cap.
        in_flight = {}
        last_dispatched = {}
        dispatch_order = 0
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="signal-source") as pool:
            while not self.stop_event.is_set():
                for source_id, (future, _source) in list(in_flight.items()):
                    if not future.done():
                        continue
                    del in_flight[source_id]
                    try:
                        future.result()
                    except Exception:
                        print('{"event":"signal-worker-error"}', flush=True)
                try:
                    with self.db_lock, monitor.connect(self.db_path) as db:
                        pending = signals.due(db)
                    pending = [source for source in pending if source["id"] not in in_flight
                               and not (self.x_stream_requested and source.get("format") == "x-api")]
                    # Oldest-dispatched first prevents frequent routes at the
                    # start of the config from starving the remaining routes.
                    pending.sort(key=lambda source: last_dispatched.get(source["id"], 0))
                    x_due_ids = [source["id"] for source in pending if source.get("format") == "x-api"]
                    x_enabled = not self.x_stream_requested and any(source.get('format') == 'x-api' for source in signals.enabled_sources())
                    selected = pending[:workers - len(in_flight)]
                    if x_enabled:
                        # Reserve one of the existing three slots for X, even
                        # while it is not yet due. Two slow article publishers
                        # cannot consume the lane needed by the next X poll.
                        active_x = sum(source.get('format') == 'x-api'
                                       for _future, source in in_flight.values())
                        active_other = len(in_flight) - active_x
                        selected = [s for s in pending if s.get('format') != 'x-api'][:max(0, 2-active_other)]
                        if not active_x and x_due_ids:
                            # Match the reservation layer's least-served choice;
                            # a source not dispatched must not block the chosen
                            # lane merely because it appears earlier in config.
                            current = datetime.now(timezone.utc)
                            with self.db_lock, monitor.connect(self.db_path) as db:
                                usage = {r['source_id']: r for r in db.execute('''
                                  SELECT source_id,count(*) AS attempts,max(attempted_at) AS latest
                                  FROM signal_x_request_attempts
                                  WHERE datetime(attempted_at)>datetime(?) AND datetime(attempted_at)<=datetime(?)
                                  GROUP BY source_id''',
                                  ((current-timedelta(hours=24)).isoformat(), current.isoformat()))}
                            x_choice = min(x_due_ids, key=lambda source_id: (
                                usage.get(source_id, {'attempts': 0})['attempts'],
                                usage.get(source_id, {'latest': ''})['latest'] or '',
                                x_due_ids.index(source_id),
                            ))
                            selected.insert(0, next(s for s in pending if s['id'] == x_choice))
                    for source in selected:
                        if self.stop_event.is_set():
                            break
                        in_flight[source["id"]] = (pool.submit(self.check_signal_source, source, x_due_ids), source)
                        dispatch_order += 1
                        last_dispatched[source["id"]] = dispatch_order
                except Exception:
                    print('{"event":"signal-worker-error"}', flush=True)
                self.stop_event.wait(1)

    def check_signal_source(self, source, x_due_ids=None):
        if self.x_stream_requested and source.get('format') == 'x-api':
            return  # Supervisor owns guarded stream/reconciliation/fallback.
        if self.stop_event.is_set():
            return
        # Network I/O and article parsing must not hold the shared database lock.
        reservation_error = None
        with self.db_lock, monitor.connect(self.db_path) as db:
            validators = {}
            try:
                signals.prepare_x_query_window(db, source)
                signals.require_x_polling_storage(db, source)
                validators = signals.validators_for(db, source, self.tickers)
                signals.reserve_x_api_request(db, source, eligible_source_ids=x_due_ids)
            except Exception as exc:
                reservation_error = exc
        started = time.monotonic()
        try:
            if reservation_error:
                raise reservation_error
            response = signals.acquire(source, validators, self.tickers)
            if not response.get("not_modified") and "_items" not in response:
                response["_items"] = signals.parse(source, response.pop("body"), self.tickers)
            failure = None
        except Exception as exc:
            response, failure = None, exc
        def cached_transport(_source, _validators):
            if failure:
                raise failure
            return response
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = signals.check(db, source, self.tickers, transport=cached_transport)
            if result["status"] != "deferred":
                db.execute("UPDATE signal_routes SET last_duration_ms=? WHERE id=?",
                           (round((time.monotonic() - started) * 1000), source["id"]))
        if result.get("events", 0) > 0:
            # Wake only after the transaction has committed and released the
            # shared lock; no worker should see an uncommitted source revision.
            self.wake_publication_workers()

    def interval_for(self, ticker):
        provider = monitor.PROVIDERS[ticker]
        if provider.get("pollSeconds"):
            return max(3, int(provider["pollSeconds"]))
        if provider["format"] == "rss" or provider.get("automaticSource") == "fallback":
            return self.fast_seconds
        return self.standard_seconds

    def collect_discovery_timed(self, ticker, cached_sources=None):
        """Measure one official-source request separately from its polling interval."""
        started = time.monotonic()
        result, links = monitor.collect_discovery(
            ticker, monitor.fetch, True, cached_sources
        )
        return result, links, max(0, round((time.monotonic() - started) * 1000))

    def derive_health(self, state):
        """Add computed health fields to a private state copy and return issue codes."""
        priority_coverage = self.current_priority_source_coverage(state)
        state["prioritySources"] = priority_coverage
        cycle_age = timestamp_age_seconds(state["lastCycleAt"])
        state["lastCycleAgeSeconds"] = cycle_age
        backup = state["backup"]
        success_age = timestamp_age_seconds(backup["lastSuccessAt"])
        backup["lastSuccessAgeSeconds"] = success_age
        reference_age = success_age
        if reference_age is None:
            reference_age = timestamp_age_seconds(state["startedAt"])
        overdue_after = self.backup_interval + self.backup_grace
        backup["overdueAfterSeconds"] = overdue_after
        backup["overdue"] = reference_age is None or reference_age > overdue_after
        if backup["healthy"] is False:
            backup["status"] = "failed"
        elif backup["overdue"]:
            backup["status"] = "overdue"
        elif backup["healthy"] is True:
            backup["status"] = "ok"
        else:
            backup["status"] = "waiting"
        issues = []
        if state["ready"] and (cycle_age is None or cycle_age > self.monitor_stale_seconds):
            issues.append("monitor-stale")
        if state["ready"] and state.get("lastCycleCompanies", 0) > 0:
            if priority_coverage["pending"]:
                issues.append("priority-source-pending")
            if priority_coverage["degraded"]:
                issues.append("priority-source-degraded")
        if backup["status"] == "failed":
            issues.append("backup-failed")
        elif backup["status"] == "overdue":
            issues.append("backup-overdue")
        if state["incidentWatch"]["healthy"] is False:
            issues.append("incident-watch-failed")
        if state["priorityPersistence"]["healthy"] is False:
            issues.append("priority-source-metrics-failed")
        push = state["webPush"]
        push_poll_age = timestamp_age_seconds(push["lastPollAt"])
        if push_poll_age is None and push["enabled"]:
            push_poll_age = timestamp_age_seconds(state["startedAt"])
        push["lastPollAgeSeconds"] = push_poll_age
        push["pollOverdueAfterSeconds"] = WEB_PUSH_STALE_SECONDS
        push["pollOverdue"] = bool(
            push["enabled"]
            and push_poll_age is not None
            and push_poll_age > WEB_PUSH_STALE_SECONDS
        )
        if state["ready"] and push["pollOverdue"] and "monitor-stale" not in issues:
            issues.append("web-push-stale")
        if state["bodyFetch"]["healthy"] is False:
            issues.append("body-fetch-failed")
        durable_body_fetch = state["bodyFetch"].get("durable") or {}
        durable_body_fetch["polledSinceStart"] = timestamp_at_or_after(
            durable_body_fetch.get("lastPolledAt"), state.get("startedAt")
        )
        durable_body_fetch["completedSinceStart"] = timestamp_at_or_after(
            durable_body_fetch.get("lastCompletedAt"), state.get("startedAt")
        )
        if (
            state["ready"] and durable_body_fetch.get("pollOverdue")
            and "monitor-stale" not in issues
        ):
            issues.append("body-fetch-stale")
        durable_discovery = state.get("discoveryRuns") or {}
        durable_discovery["completedSinceStart"] = timestamp_at_or_after(
            durable_discovery.get("lastCompletedAt"), state.get("startedAt")
        )
        if (
            state["ready"] and durable_discovery.get("lastCompletedAt")
            and durable_discovery.get("pollOverdue")
            and "monitor-stale" not in issues
        ):
            issues.append("discovery-poll-stale")
        state["health"] = {
            "status": "degraded" if issues else ("ready" if state["ready"] else "starting"),
            "issues": issues,
            "monitorStaleAfterSeconds": self.monitor_stale_seconds,
        }
        return issues

    def current_priority_source_coverage(self, state, remember_completion=False):
        """Keep the first complete post-start measurement stable across repolls."""
        coverage = priority_source_coverage(state, self.tickers)
        measured = coverage["completionLatencyMs"]
        if measured is not None:
            if remember_completion and self.priority_completion_latency_ms is None:
                self.priority_completion_latency_ms = measured
            if self.priority_completion_latency_ms is not None:
                coverage["completionLatencyMs"] = self.priority_completion_latency_ms
        return coverage

    def sync_health_incidents(self):
        """Persist health transitions independently of traffic to the HTTP API."""
        with self.state_lock:
            state = json.loads(json.dumps(self.state))
        with self.db_lock, monitor.connect(self.db_path) as db:
            state["discoveryRuns"] = monitor.discovery_poll_summary(
                db, poll_overdue_after_seconds=self.monitor_stale_seconds
            )
            state["bodyFetch"]["durable"] = monitor.body_fetch_batch_summary(
                db, poll_overdue_after_seconds=max(360, self.body_interval * 2 + 60)
            )
            issues = self.derive_health(state)
            if "monitor-stale" in issues:
                monitor.record_operational_incident(
                    db, "monitor:cycle", "monitor", "cycle", "critical", "monitor-stale"
                )
            else:
                monitor.resolve_operational_incident(db, "monitor:cycle")
            backup_issue = next((issue for issue in issues if issue.startswith("backup-")), None)
            if backup_issue:
                monitor.record_operational_incident(
                    db, "backup:database", "backup", "database", "critical", backup_issue
                )
            else:
                monitor.resolve_operational_incident(db, "backup:database")
            if "incident-watch-failed" in issues:
                monitor.record_operational_incident(
                    db, "monitor:incident-watch", "monitor", "incident-watch",
                    "critical", "incident-watch-failed"
                )
            else:
                monitor.resolve_operational_incident(db, "monitor:incident-watch")
            if "discovery-poll-stale" in issues:
                monitor.record_operational_incident(
                    db, "discovery:worker", "official-discovery", "worker",
                    "warning", "discovery-poll-stale"
                )
            else:
                monitor.resolve_operational_incident(db, "discovery:worker")
            priority_issue = next((issue for issue in issues if issue in {
                "priority-source-pending", "priority-source-degraded",
            }), None)
            if priority_issue:
                monitor.record_operational_incident(
                    db, "discovery:priority-sources", "official-discovery",
                    "priority-five", "warning", priority_issue
                )
            else:
                monitor.resolve_operational_incident(db, "discovery:priority-sources")
            if "priority-source-metrics-failed" in issues:
                monitor.record_operational_incident(
                    db, "discovery:priority-metrics", "official-discovery",
                    "priority-metrics", "warning", "priority-source-metrics-failed"
                )
            else:
                monitor.resolve_operational_incident(db, "discovery:priority-metrics")
            if "web-push-stale" in issues:
                monitor.record_operational_incident(
                    db, "push:worker", "web-push", "worker",
                    "warning", "web-push-stale"
                )
            else:
                monitor.resolve_operational_incident(db, "push:worker")
            body_issue = next(
                (issue for issue in issues if issue.startswith("body-fetch-")), None
            )
            if body_issue:
                monitor.record_operational_incident(
                    db, "body:worker", "article-body", "worker", "warning",
                    body_issue
                )
            else:
                monitor.resolve_operational_incident(db, "body:worker")
            publication_issue = headline_translation.sync_incident(db)
            if publication_issue:
                issues.append(publication_issue)
            research_issue = official_research.sync_incident(db)
            if research_issue:
                issues.append(research_issue)
        return issues

    def check_incident_watch_once(self):
        checked_at = utc_now()
        with self.state_lock:
            recovering = self.state["incidentWatch"]["healthy"] is False
        try:
            self.sync_health_incidents()
        except Exception:
            with self.state_lock:
                self.state["incidentWatch"].update({
                    "lastCheckAt": checked_at, "healthy": False,
                    "lastError": "incident-watch-failed",
                })
            return False
        with self.state_lock:
            self.state["incidentWatch"].update({
                "lastCheckAt": checked_at, "healthy": True, "lastError": None,
            })
        if recovering:
            # The successful pass above records the watch failure that could not be
            # written while storage was unavailable. A second pass closes it.
            try:
                self.sync_health_incidents()
            except Exception:
                with self.state_lock:
                    self.state["incidentWatch"].update({
                        "healthy": False, "lastError": "incident-watch-failed",
                    })
                return False
        return True

    def run_incident_watch(self):
        while not self.stop_event.is_set():
            self.check_incident_watch_once()
            self.stop_event.wait(self.incident_check_seconds)

    def process_incident_notification(self, transport=incident_delivery.send_webhook):
        if not self.notification_enabled:
            return None
        attempted_at = utc_now()
        with self.db_lock, monitor.connect(self.db_path) as db:
            claim = monitor.claim_incident_notification(
                db, self.notification_config["startAt"], attempted_at
            )
        if not claim:
            return None
        error_code = None
        try:
            transport(self.notification_config, claim)
        except incident_delivery.DeliveryUnavailable:
            error_code = "notification-not-configured"
        except incident_delivery.DeliveryFailed:
            error_code = "notification-delivery-failed"
        except Exception:
            error_code = "notification-worker-failed"
        with self.db_lock, monitor.connect(self.db_path) as db:
            outcome = monitor.finish_incident_notification(
                db, claim, error_code=error_code,
                max_attempts=self.notification_max_attempts,
            )
        with self.state_lock:
            notification = self.state["notification"]
            notification["attempts"] += 1
            notification["lastAttemptAt"] = attempted_at
            notification["lastError"] = error_code
            if outcome == "delivered":
                notification["delivered"] += 1
                notification["lastSuccessAt"] = utc_now()
        return outcome

    def run_notification_delivery(self):
        while not self.stop_event.is_set():
            try:
                self.process_incident_notification()
            except Exception:
                with self.state_lock:
                    self.state["notification"]["lastError"] = "notification-worker-failed"
            self.stop_event.wait(self.notification_interval)

    def record_priority_source_run_safely(
        self, process_started_at, observed_at, coverage,
    ):
        """Persist optional coverage telemetry without stopping source polling."""
        attempted_at = utc_now()
        try:
            with self.db_lock, monitor.connect(self.db_path) as db:
                monitor.record_priority_source_run(
                    db, process_started_at, observed_at,
                    coverage["targetCount"], coverage["configuredCount"],
                    coverage["healthy"], coverage["degraded"],
                    coverage["completionLatencyMs"],
                )
        except Exception:
            with self.state_lock:
                self.state["priorityPersistence"].update({
                    "lastAttemptAt": attempted_at, "healthy": False,
                    "lastError": "priority-source-metrics-failed",
                })
            return False
        with self.state_lock:
            self.state["priorityPersistence"].update({
                "lastAttemptAt": attempted_at, "lastSuccessAt": attempted_at,
                "healthy": True, "lastError": None,
            })
        return True

    def persist_priority_source_coverage_if_due(
        self, process_started_at, observed_at, coverage, monotonic_now=None,
    ):
        """Refresh bounded durable coverage after changes and on a heartbeat."""
        if coverage["completionLatencyMs"] is None:
            return False
        current = time.monotonic() if monotonic_now is None else monotonic_now
        signature = (coverage["healthy"], coverage["degraded"])
        if (
            signature == self.priority_metrics_signature
            and current < self.next_priority_metrics_at
        ):
            return False
        if not self.record_priority_source_run_safely(
            process_started_at, observed_at, coverage
        ):
            return False
        self.priority_metrics_signature = signature
        self.next_priority_metrics_at = current + self.priority_metrics_interval
        return True

    def public_state(self):
        with self.state_lock:
            state = json.loads(json.dumps(self.state))
        state["fetchCache"] = monitor.fetch_cache_stats()
        with self.db_lock, monitor.connect(self.db_path) as db:
            state["generation"].update(monitor.generation_queue_stats(
                db, self.generation_daily_limit, self.generation_token_limit
            ))
            state["bodyFetch"]["durable"] = monitor.body_fetch_batch_summary(
                db, poll_overdue_after_seconds=max(360, self.body_interval * 2 + 60)
            )
            state["discoveryRuns"] = monitor.discovery_poll_summary(
                db, poll_overdue_after_seconds=self.monitor_stale_seconds
            )
            state["prioritySourceRuns"] = monitor.priority_source_run_summary(db)
            state["bodyHostProbes"] = monitor.body_host_probe_summary(db)
            state["secEvidence"] = monitor.sec_evidence_summary(db, PRIORITY_SEC_TICKERS)
            state["muEarningsMeasurement"] = mu_earnings_measurement.diagnostics(db)
            state["signalIntake"] = signals.operational_summary(db)
            state["signalIntake"]["xIntake"] = signals.x_operational_summary(db)
            if self.x_stream_requested:
                with self.state_lock:
                    state["signalIntake"]["xStream"] = dict(self.x_stream_status)
            state["signalIntake"]["xMarketNews"] = x_market_news.diagnostics(db)
            state["signalIntake"]["analystNews"] = analyst_news.diagnostics(db)
            state["signalIntake"]["businessNews"] = general_source_news.diagnostics(db,datetime.now(timezone.utc))
            state["signalIntake"]["headlineTranslation"] = (
                headline_translation.diagnostics(db, env=os.environ)
            )
            state["signalIntake"]["resultPublication"] = market_results.diagnostics(db)
            state["signalIntake"]["officialResearch"] = official_research.diagnostics(db)
            state["signalIntake"]["issuerSyndication"] = issuer_syndication.diagnostics(db)
            state["signalIntake"]["issuerBusinessNews"] = issuer_business_news.diagnostics(db,datetime.now(timezone.utc))
            state["incidents"] = monitor.operational_incident_summary(
                db, delivery_enabled=self.notification_enabled
            )
        self.derive_health(state)
        return state

    def public_snapshot(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.snapshot(db, recent_per_item=20)

    def editorial_queue(self, limit=20, review_filter="all"):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.private_brief_queue(db, limit, review_filter)

    def annual_editorial_queue(self, limit=20, review_filter="all"):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.annual_filing_brief_queue(db, limit, review_filter)

    def public_annual_brief(self, ticker, accession, source_sha):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.approved_annual_filing_brief(db, ticker, accession, source_sha)

    def save_annual_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.save_annual_filing_brief_draft(db, payload)

    def decide_annual_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.review_annual_filing_brief(
                db, payload.get("ticker", ""), payload.get("accessionNumber", ""),
                payload.get("sourceSha256", ""), payload.get("decision", ""),
                payload.get("reviewer", ""), payload.get("reason", ""),
                payload.get("validationSha256", ""),
                payload.get("sourceBusiness", ""), payload.get("sourceRisks", ""),
            )

    def save_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.save_brief_draft(
                db, payload.get("url", ""), payload.get("sha256", ""),
                payload.get("summaryJa", ""), payload.get("impactLabel", ""),
                payload.get("impactJa", ""), payload.get("confidence", ""),
                payload.get("evidence", {}),
            )
            monitor.write_snapshot(db, self.snapshot_path)
            return result

    def generate_brief(self, payload, transport=brief_generator.request_response):
        url, expected_sha = payload.get("url", ""), payload.get("sha256", "")
        with self.db_lock, monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            if not row or row["sha256"] != expected_sha or row["error"] or not row["extracted_text"]:
                raise ValueError("Source is missing, changed, failed, or has no extracted evidence")
            source = dict(row)
        generated = brief_generator.generate_draft(source, transport=transport)
        draft, audit = generated["draft"], generated["audit"]
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.save_brief_draft(
                db, url, expected_sha, draft["summaryJa"], draft["impactLabel"],
                draft["impactJa"], draft["confidence"], draft["evidence"],
            )
            db.execute("""
              UPDATE briefs SET generation_provider=?,generation_model=?,generation_response_id=?,
                                generation_source_truncated=?,generation_input_tokens=?,
                                generation_output_tokens=?,generation_total_tokens=? WHERE url=?
            """, (audit["provider"], audit["model"], audit["responseId"], int(audit["sourceTruncated"]),
                  audit.get("inputTokens"), audit.get("outputTokens"), audit.get("totalTokens"), url))
            db.commit()
            monitor.write_snapshot(db, self.snapshot_path)
        return {**result, "generatedBy": audit["provider"], "model": audit["model"],
                "sourceTruncated": audit["sourceTruncated"], "usage": {
                    "inputTokens": audit.get("inputTokens"), "outputTokens": audit.get("outputTokens"),
                    "totalTokens": audit.get("totalTokens"),
                }}

    def generate_brief_budgeted(self, payload, transport=brief_generator.request_response):
        """Apply the same rolling budgets to authenticated manual generation."""
        brief_generator.configuration()
        url, expected_sha = payload.get("url", ""), payload.get("sha256", "")
        with self.db_lock, monitor.connect(self.db_path) as db:
            source = db.execute("SELECT extracted_text FROM sources WHERE url=?", (url,)).fetchone()
            reservation = brief_generator.token_reservation(source["extracted_text"] if source else "")
            claim = monitor.claim_manual_generation(
                db, url, expected_sha, reservation, self.generation_daily_limit, self.generation_token_limit
            )
        error_code = None
        usage = None
        try:
            result = self.generate_brief(payload, transport=transport)
            usage = result.get("usage")
            return result
        except brief_generator.GenerationUnavailable:
            error_code = "generation-not-configured"
            raise
        except brief_generator.GenerationFailed:
            error_code = "generation-failed"
            raise
        except ValueError:
            error_code = "validation-failed"
            raise
        except Exception:
            error_code = "worker-error"
            raise
        finally:
            with self.db_lock, monitor.connect(self.db_path) as db:
                monitor.finish_manual_generation(db, claim, error_code=error_code, usage=usage)

    def decide_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.review_brief(
                db, payload.get("url", ""), payload.get("sha256", ""),
                payload.get("decision", ""), payload.get("reviewer", ""), payload.get("reason", ""),
                payload.get("validationSha256", ""),
                payload.get("aiVerification") is True,
                payload.get("fullSourceVerification") is True,
            )
            monitor.write_snapshot(db, self.snapshot_path)
            return result

    def body_candidates(self, polled_at=None, *, excluded_urls=(),
                        excluded_tickers=(), excluded_hosts=(), max_candidates=None):
        """Prioritize unseen releases, then missing evidence, then routine rechecks."""
        batch_limit = self.body_batch if max_candidates is None else min(
            self.body_batch, max(0, int(max_candidates))
        )
        due = utc_now()
        polled_at = polled_at or due
        with self.db_lock, monitor.connect(self.db_path) as db:
            backlog = db.execute("""
              SELECT
                count(*) AS total,
                sum(CASE WHEN sha256 IS NULL THEN 1 ELSE 0 END) AS never_fetched,
                sum(CASE WHEN sha256 IS NULL AND EXISTS (
                  SELECT 1 FROM release_events e WHERE e.url=sources.url
                ) THEN 1 ELSE 0 END) AS detected_never_fetched,
                sum(CASE WHEN sha256 IS NULL AND NOT EXISTS (
                  SELECT 1 FROM release_events e WHERE e.url=sources.url
                ) THEN 1 ELSE 0 END) AS baseline_never_fetched,
                sum(CASE WHEN sha256 IS NOT NULL AND coalesce(extracted_chars,0)=0
                         THEN 1 ELSE 0 END) AS extraction_pending,
                sum(CASE WHEN sha256 IS NOT NULL AND coalesce(extracted_chars,0)>0
                         THEN 1 ELSE 0 END) AS extracted
              FROM sources WHERE source_mode='remote'
            """).fetchone()
            identity_audit = monitor.canonical_source_identity_audit(db)
            schedule_rows = db.execute("""
              SELECT url,next_fetch_at,error
              FROM sources WHERE source_mode='remote'
            """).fetchall()
            schedule_states = [
                (row, *bounded_retry_schedule(row["next_fetch_at"], due))
                for row in schedule_rows
            ]
            deferred_rows = [
                row for row, state, _scheduled in schedule_states
                if state == "deferred"
            ]
            deferred_urls = {row["url"] for row in deferred_rows}
            invalid_retry_schedules = sum(
                1 for _row, state, _scheduled in schedule_states if state == "invalid"
            )
            deferred_with_error = [row for row in deferred_rows if row["error"] is not None]
            eligible_count = len(schedule_rows) - len(deferred_rows)
            retry_deferred = len(deferred_with_error)
            error_kinds = {
                "accessRestricted": 0, "rateLimited": 0, "timeout": 0,
                "server": 0, "extraction": 0, "invalidResponse": 0,
                "other": 0,
            }
            for row in deferred_with_error:
                error_kinds[body_error_kind(row["error"])] += 1
            access_restricted = error_kinds["accessRestricted"]
            rate_limited = error_kinds["rateLimited"]
            recheck_deferred = sum(1 for row in deferred_rows if row["error"] is None)
            detected_waits = []
            for detected in db.execute("""
              SELECT e.detected_at
              FROM sources s JOIN release_events e ON e.url=s.url
              WHERE s.source_mode='remote' AND s.sha256 IS NULL
              LIMIT 10000
            """).fetchall():
                age_ms = timestamp_latency_ms(detected["detected_at"], due)
                if age_ms is not None:
                    detected_waits.append((age_ms, detected["detected_at"]))
            oldest_detected_wait = max(detected_waits, default=None)
            blocked_host_state, next_host_probe_at = active_body_host_backoff_state(db, due)
            blocked_hosts = set(blocked_host_state)
            probe_host_state = due_body_host_backoff_state(db, due)
            probe_hosts = set(probe_host_state)
            ordered = db.execute("""
              SELECT s.url,s.ticker,s.sha256,s.next_fetch_at,e.detected_at
              FROM sources s LEFT JOIN release_events e ON e.url=s.url
              WHERE s.source_mode='remote'
              ORDER BY CASE
                         WHEN e.detected_at IS NOT NULL AND s.sha256 IS NULL THEN 0
                         WHEN s.sha256 IS NOT NULL AND s.extracted_chars=0 THEN 1
                         WHEN e.detected_at IS NOT NULL THEN 2
                         WHEN s.sha256 IS NULL THEN 3
                         ELSE 4
                       END,
                       s.fetch_failures,
                       CASE WHEN s.url LIKE 'https://www.sec.gov/Archives/edgar/data/%'
                            THEN 1 ELSE 0 END,
                       e.detected_at IS NULL, e.detected_at DESC,
                       s.checked_at IS NOT NULL, s.checked_at, s.discovered_at, s.url
            """).fetchall()
            host_deferred = 0
            eligible_candidates = []
            for candidate in ordered:
                if candidate["url"] in deferred_urls:
                    continue
                hostname = monitor.source_hostname(candidate["url"])
                if hostname and hostname in blocked_hosts:
                    host_deferred += 1
                    continue
                if (candidate["url"] in excluded_urls
                        or candidate["ticker"] in excluded_tickers
                        or hostname in excluded_hosts):
                    continue
                eligible_candidates.append(candidate)
            eligible_hosts = {
                monitor.source_hostname(candidate["url"])
                for candidate in eligible_candidates
            }
            due_probe_hosts = probe_hosts.intersection(eligible_hosts)

            # Keep the highest-priority evidence candidate first, then reserve
            # spare capacity for expired host circuits and the oldest valid
            # unfetched release. Without the latter fairness slot, a steady
            # stream of newer releases could postpone an older release
            # indefinitely. Recovery probes keep precedence over fairness.
            candidate_order = eligible_candidates
            fairness_applied = False
            fairness_age_ms = None
            fairness_shared_host = False
            oldest_release = None
            if batch_limit > 1 and eligible_candidates:
                probe_candidates = []
                seen_probe_hosts = set()
                for candidate in eligible_candidates:
                    hostname = monitor.source_hostname(candidate["url"])
                    if hostname in probe_hosts and hostname not in seen_probe_hosts:
                        probe_candidates.append(candidate)
                        seen_probe_hosts.add(hostname)
                pinned = [eligible_candidates[0]]
                pinned_urls = {eligible_candidates[0]["url"]}
                for candidate in probe_candidates:
                    if len(pinned) >= batch_limit:
                        break
                    if candidate["url"] not in pinned_urls:
                        pinned.append(candidate)
                        pinned_urls.add(candidate["url"])
                if len(pinned) < batch_limit:
                    valid_unfetched_releases = []
                    for candidate in eligible_candidates:
                        if candidate["sha256"] is not None or candidate["detected_at"] is None:
                            continue
                        age_ms = timestamp_latency_ms(candidate["detected_at"], due)
                        if age_ms is not None:
                            valid_unfetched_releases.append((age_ms, candidate))
                    fairness_age_ms, oldest_release = max(
                        valid_unfetched_releases,
                        key=lambda item: item[0] if item[0] is not None else -1,
                        default=(None, None),
                    )
                    if oldest_release and oldest_release["url"] not in pinned_urls:
                        oldest_host = monitor.source_hostname(oldest_release["url"])
                        shared_host_index = next((
                            index for index, candidate in enumerate(pinned)
                            if oldest_host
                            and monitor.source_hostname(candidate["url"]) == oldest_host
                        ), None)
                        if shared_host_index is not None:
                            displaced = pinned[shared_host_index]
                            pinned[shared_host_index] = oldest_release
                            pinned_urls.remove(displaced["url"])
                            pinned_urls.add(oldest_release["url"])
                            fairness_applied = True
                            fairness_shared_host = True
                        else:
                            pinned.append(oldest_release)
                            pinned_urls.add(oldest_release["url"])
                            fairness_applied = True
                candidate_order = pinned + [
                    candidate for candidate in eligible_candidates
                    if candidate["url"] not in pinned_urls
                ]

            selected_urls = []
            selected_hosts = set()
            for candidate in candidate_order:
                hostname = monitor.source_hostname(candidate["url"])
                if hostname and hostname in selected_hosts:
                    continue
                if len(selected_urls) < batch_limit:
                    selected_urls.append(candidate["url"])
                    if hostname:
                        selected_hosts.add(hostname)
            pending = max(0, eligible_count - host_deferred)
            monitor.record_body_fetch_poll(db, polled_at, pending)
            rows = []
            if selected_urls:
                placeholders = ",".join("?" for _ in selected_urls)
                selected = db.execute(f"""
                  SELECT s.*,e.detected_at AS release_detected_at
                  FROM sources s LEFT JOIN release_events e ON e.url=s.url
                  WHERE s.url IN ({placeholders})
                """, selected_urls).fetchall()
                by_url = {row["url"]: row for row in selected}
                rows = [by_url[url] for url in selected_urls if url in by_url]
            probe_urls = {
                url for url in selected_urls
                if monitor.source_hostname(url) in due_probe_hosts
            }
            fairness_scheduled = bool(
                fairness_applied
                and oldest_release
                and oldest_release["url"] in selected_urls
            )
            scheduled_detected_never_fetched = sum(
                1 for row in rows
                if row["sha256"] is None and row["release_detected_at"] is not None
            )
            scheduled_baseline_never_fetched = sum(
                1 for row in rows
                if row["sha256"] is None and row["release_detected_at"] is None
            )
            scheduled_extraction_pending = sum(
                1 for row in rows
                if row["sha256"] is not None and int(row["extracted_chars"] or 0) == 0
            )
            scheduled_recheck = sum(
                1 for row in rows
                if row["sha256"] is not None and int(row["extracted_chars"] or 0) > 0
            )
        self.body_probe_urls = probe_urls
        self.body_probe_eligible_at = {
            url: probe_host_state[monitor.source_hostname(url)].isoformat(
                timespec="milliseconds"
            )
            for url in probe_urls
        }
        with self.state_lock:
            self.state["bodyBacklog"] = {
                "eligible": pending,
                "hostDeferred": host_deferred,
                "activeHostCircuits": len(blocked_hosts),
                "nextHostProbeAt": next_host_probe_at,
                "dueHostCircuits": len(due_probe_hosts),
                "scheduledHostProbes": len(probe_urls),
                "retryDeferred": retry_deferred,
                "accessRestricted": access_restricted,
                "rateLimited": rate_limited,
                "errorKinds": error_kinds,
                "invalidRetrySchedules": invalid_retry_schedules,
                "recheckDeferred": recheck_deferred,
                "neverFetched": int(backlog["never_fetched"] or 0),
                "detectedNeverFetched": int(backlog["detected_never_fetched"] or 0),
                "baselineNeverFetched": int(backlog["baseline_never_fetched"] or 0),
                "detectedNeverFetchedMeasured": len(detected_waits),
                "detectedNeverFetchedUnmeasured": max(
                    0, int(backlog["detected_never_fetched"] or 0) - len(detected_waits)
                ),
                "detectedNeverFetchedAgeMaxMs": (
                    oldest_detected_wait[0] if oldest_detected_wait else None
                ),
                "oldestDetectedNeverFetchedAt": (
                    oldest_detected_wait[1] if oldest_detected_wait else None
                ),
                "fairnessScheduled": fairness_scheduled,
                "fairnessAgeMs": fairness_age_ms if fairness_scheduled else None,
                "fairnessSharedHost": fairness_shared_host if fairness_scheduled else False,
                "scheduledDetectedNeverFetched": scheduled_detected_never_fetched,
                "scheduledBaselineNeverFetched": scheduled_baseline_never_fetched,
                "scheduledExtractionPending": scheduled_extraction_pending,
                "scheduledRecheck": scheduled_recheck,
                "extractionPending": int(backlog["extraction_pending"] or 0),
                "extracted": int(backlog["extracted"] or 0),
                **identity_audit,
                "total": int(backlog["total"] or 0),
                "measuredAt": polled_at,
            }
        return rows, pending

    def begin_body_batch(self, **selection):
        """Select one bounded batch without occupying a network worker."""
        cycle_started = time.monotonic()
        polled_at = utc_now()
        rows, pending = self.body_candidates(polled_at, **selection)
        probe_urls = set(self.body_probe_urls)
        probe_eligible_at = dict(self.body_probe_eligible_at)
        with self.state_lock:
            self.state["pendingBodies"] = pending
            self.state["bodyFetch"]["lastPollAt"] = polled_at
        if not rows:
            with self.state_lock:
                self.state["pendingBodies"] = pending
                self.state["bodyFetch"].update({
                    "lastPollAt": polled_at, "healthy": True,
                    "consecutiveFailures": 0, "lastError": None,
                    "retrySeconds": 0, "nextRetryAt": None,
                })
            return
        return {
            "cycle_started": cycle_started, "polled_at": polled_at,
            "rows": rows, "pending": pending, "probe_urls": probe_urls,
            "probe_eligible_at": probe_eligible_at, "completed": [],
            "saved_outcomes": {}, "saved_at": {}, "failed": False,
        }

    @staticmethod
    def collect_body_timed(row):
        attempted_at = utc_now()
        request_started = time.monotonic()
        try:
            result = monitor.collect_source(row, monitor.fetch)
            error = None
        except Exception as exc:
            result = None
            error = exc
        request_duration_ms = max(
            0, round((time.monotonic() - request_started) * 1000)
        )
        return attempted_at, request_duration_ms, result, error

    def save_body_completion(self, batch, completed):
        """Commit and publish one body without waiting for its batch peers."""
        row, _attempted_at, _request_duration_ms, result, error = completed
        with self.db_lock, monitor.connect(self.db_path) as db:
            if error is None:
                outcome = monitor.save_source_check(db, row, result)["status"]
                if not result.get("notModified"):
                    monitor.activate_generation_job(
                        db, row["url"], brief_generator.token_reservation(result["extractedText"])
                    )
            else:
                monitor.save_source_error(db, row, error)
                outcome = None
            if row["url"] in batch["probe_urls"]:
                if error is None:
                    probe_outcome = "recovered"
                elif monitor.source_error_code(error) in monitor.ACCESS_RESTRICTED_ERRORS:
                    probe_outcome = "restricted"
                else:
                    probe_outcome = "failed"
                monitor.record_body_host_probe(
                    db, batch["probe_eligible_at"].get(row["url"]), batch["polled_at"],
                    utc_now(), probe_outcome,
                )
            remaining = db.execute("""
              SELECT error FROM sources
              WHERE ticker=? AND source_mode='remote' AND error IS NOT NULL
              ORDER BY checked_at DESC LIMIT 1
            """, (row["ticker"],)).fetchone()
            if remaining:
                monitor.record_operational_incident(
                    db, f"body:{row['ticker']}", "article-body", row["ticker"], "warning",
                    monitor.public_error(remaining["error"]) or "body-fetch-failed",
                )
            else:
                monitor.resolve_body_incident_if_recovered(db, row["ticker"])
            monitor.write_snapshot(db, self.snapshot_path)
        batch["completed"].append(completed)
        batch["saved_outcomes"][row["url"]] = outcome
        batch["saved_at"][row["url"]] = utc_now()
        with self.state_lock:
            self.state["sourceChecks"] += 1
            self.state["sourceFetchErrors"] += int(error is not None)
            self.state["sourceNotModified"] += int(error is None and bool(result.get("notModified")))
            self.state["pendingBodies"] = max(0, self.state["pendingBodies"] - 1)
        if outcome in {"first-fetched", "changed"}:
            self.wake_publication_workers()

    def finish_body_batch(self, batch):
        """Record aggregate metrics; source evidence is already committed."""
        cycle_started = batch["cycle_started"]
        polled_at = batch["polled_at"]
        completed = batch["completed"]
        errors = sum(error is not None for _row, _at, _ms, _result, error in completed)
        not_modified = sum(
            error is None and bool(result.get("notModified"))
            for _row, _at, _ms, result, error in completed
        )
        detection_latencies_ms = []
        eligibility_waits_ms = []
        request_durations_ms = [entry[2] for entry in completed]
        request_success_durations_ms = [entry[2] for entry in completed if entry[4] is None]
        request_error_durations_ms = [entry[2] for entry in completed if entry[4] is not None]
        saved_outcomes = batch["saved_outcomes"]
        with self.db_lock, monitor.connect(self.db_path) as db:
            completed_at = utc_now()
            duration_ms = max(0, round((time.monotonic() - cycle_started) * 1000))
            selection_partitions = {
                "detectedNeverFetched": 0,
                "baselineNeverFetched": 0,
                "extractionPending": 0,
                "recheck": 0,
            }
            selection_errors = dict.fromkeys(selection_partitions, 0)
            selection_not_modified = dict.fromkeys(selection_partitions, 0)
            selection_fetched = dict.fromkeys(selection_partitions, 0)
            selection_updated = dict.fromkeys(selection_partitions, 0)
            for row, attempted_at, request_duration_ms, result, error in completed:
                eligibility_wait = timestamp_latency_ms(
                    row["next_fetch_at"], attempted_at
                )
                if eligibility_wait is not None:
                    eligibility_waits_ms.append(eligibility_wait)
                if row["sha256"] is None:
                    partition = (
                        "detectedNeverFetched"
                        if row["release_detected_at"] is not None
                        else "baselineNeverFetched"
                    )
                elif int(row["extracted_chars"] or 0) == 0:
                    partition = "extractionPending"
                else:
                    partition = "recheck"
                selection_partitions[partition] += 1
                if error is not None:
                    selection_errors[partition] += 1
                elif result.get("notModified"):
                    selection_not_modified[partition] += 1
                else:
                    selection_fetched[partition] += 1
                    if saved_outcomes.get(row["url"]) in {"first-fetched", "changed"}:
                        selection_updated[partition] += 1
                if error is not None or result.get("notModified") or row["sha256"] is not None:
                    continue
                latency = timestamp_latency_ms(
                    row["release_detected_at"], batch["saved_at"][row["url"]]
                )
                if latency is not None:
                    detection_latencies_ms.append(latency)
            monitor.record_body_fetch_batch(
                db, polled_at, completed_at, duration_ms,
                len(completed), errors, not_modified, detection_latencies_ms,
                selection_partitions, selection_errors, selection_not_modified,
                selection_fetched, selection_updated,
                eligibility_waits_ms=eligibility_waits_ms,
                request_durations_ms=request_durations_ms,
                request_success_durations_ms=request_success_durations_ms,
                request_error_durations_ms=request_error_durations_ms,
            )
        with self.state_lock:
            self.state["bodyFetch"].update({
                "lastPollAt": max(self.state["bodyFetch"]["lastPollAt"] or polled_at, polled_at),
                "lastBatchAt": completed_at,
                "lastBatchDurationMs": duration_ms,
                "lastBatchChecks": len(completed),
                "lastBatchErrors": errors,
                "lastBatchNotModified": not_modified,
                "healthy": True,
                "consecutiveFailures": 0,
                "lastError": None,
                "retrySeconds": 0,
                "nextRetryAt": None,
            })

    def fetch_bodies(self, pool):
        """Synchronous entry point retained for manual callers and diagnostics."""
        batch = self.begin_body_batch()
        if batch is None:
            return
        futures = {pool.submit(self.collect_body_timed, row): row for row in batch["rows"]}
        for future in as_completed(futures):
            self.save_body_completion(batch, (futures[future], *future.result()))
        self.finish_body_batch(batch)

    def record_body_fetch_failure(self):
        """Apply the same retry policy to selection, collection, and save faults."""
        with self.state_lock:
            body_fetch = self.state["bodyFetch"]
            failures = body_fetch["consecutiveFailures"] + 1
            retry_seconds = min(300, self.body_interval * (2 ** min(failures, 5)))
            body_fetch.update({
                "lastPollAt": utc_now(),
                "healthy": False,
                "consecutiveFailures": failures,
                "lastError": "body-fetch-failed",
                "retrySeconds": retry_seconds,
                "nextRetryAt": (
                    datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)
                ).isoformat(timespec="milliseconds"),
            })
        return retry_seconds

    def fetch_bodies_safely(self, pool):
        """Keep a body-queue fault from stopping official-source discovery."""
        try:
            self.fetch_bodies(pool)
        except Exception:
            self.record_body_fetch_failure()
            return False
        return True

    def process_generation_job(self):
        if not self.auto_drafts_enabled:
            return None
        with self.db_lock, monitor.connect(self.db_path) as db:
            claim = monitor.claim_generation_job(
                db, self.generation_daily_limit, self.generation_max_attempts, self.generation_token_limit
            )
        if not claim:
            return None
        error_code = None
        usage = None
        retry_after_seconds = None
        try:
            generated = self.generate_brief({"url": claim["url"], "sha256": claim["sha256"]})
            usage = generated.get("usage")
        except brief_generator.GenerationUnavailable:
            error_code = "generation-not-configured"
        except brief_generator.GenerationFailed as exc:
            error_code = "generation-failed"
            retry_after_seconds = exc.retry_after_seconds
        except ValueError:
            error_code = "validation-failed"
        except Exception:
            error_code = "worker-error"
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.finish_generation_job(
                db, claim, error_code=error_code, max_attempts=self.generation_max_attempts,
                usage=usage, retry_after_seconds=retry_after_seconds
            )

    def run_generation(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            monitor.recover_generation_jobs(db)
        while not self.stop_event.is_set():
            self.process_generation_job()
            self.stop_event.wait(self.generation_interval)

    def perform_backup(self):
        attempted_at = utc_now()
        with self.state_lock:
            self.state["backup"]["lastAttemptAt"] = attempted_at
        try:
            with self.db_lock:
                result = persistence.create_backup(
                    self.db_path, self.backup_dir, self.backup_retention
                )
        except Exception:
            with self.state_lock:
                self.state["backup"].update({
                    "healthy": False, "lastError": "backup-failed",
                })
            with self.db_lock, monitor.connect(self.db_path) as db:
                monitor.record_operational_incident(
                    db, "backup:database", "backup", "database", "critical", "backup-failed"
                )
            return False
        with self.state_lock:
            self.state["backup"].update({
                "healthy": True, "lastSuccessAt": result["createdAt"],
                "backupCount": result["backupCount"], "lastError": None,
            })
        with self.db_lock, monitor.connect(self.db_path) as db:
            monitor.resolve_operational_incident(db, "backup:database")
        return True

    def run_backup(self):
        # The monitor initializes the schema under this same lock. Waiting for the
        # database file keeps a new deployment from reporting a false backup fault.
        while not self.stop_event.is_set() and not self.db_path.is_file():
            self.stop_event.wait(1)
        if self.stop_event.is_set():
            self.backup_initial_complete.set()
            return
        try:
            recent = persistence.recover_latest_backup(self.backup_dir, self.backup_interval)
        except Exception:
            recent = None
        if recent:
            with self.state_lock:
                self.state["backup"].update({"healthy": True, "lastSuccessAt": recent["createdAt"],
                    "backupCount": recent["backupCount"], "lastError": None})
            self.backup_initial_complete.set()
            remaining = max(0, self.backup_interval - (timestamp_age_seconds(recent["createdAt"]) or 0))
            if self.stop_event.wait(remaining):
                return
        while not self.stop_event.is_set():
            try:
                self.perform_backup()
            finally:
                self.backup_initial_complete.set()
            self.stop_event.wait(self.backup_interval)

    def run_supervised(self):
        failures = 0
        while not self.stop_event.is_set():
            try:
                self.run()
                return
            except Exception as exc:
                failures += 1
                with self.state_lock:
                    self.state["ready"] = False
                # Exception messages can contain source data; log only type.
                print("research-monitor-restarting " + type(exc).__name__, flush=True)
                self.stop_event.wait(min(30, 2 ** min(failures, 5)))

    def run(self):
        next_due = {ticker: 0.0 for ticker in self.tickers}
        signatures = {}
        known = {}
        discovery_caches = {}
        baseline_ready = {}
        failure_streak = {ticker: 0 for ticker in self.tickers}
        next_body_fetch = 0.0
        body_admission_due = 0.0
        with self.db_lock, monitor.connect(self.db_path) as db:
            invalidated_sources = 0
            for ticker in self.tickers:
                known[ticker] = {row[0] for row in db.execute("SELECT url FROM sources WHERE ticker=?", (ticker,))}
                discovery_caches[ticker], cache_stats = monitor.load_discovery_source_cache(
                    db, ticker, include_stats=True
                )
                invalidated_sources += cache_stats["invalidatedSources"]
                baseline_ready[ticker] = db.execute(
                    """SELECT 1 FROM discovery_runs
                       WHERE ticker=? AND (
                         status IN ('ok','fallback')
                         OR (status='degraded' AND route IS NOT NULL AND route!='none')
                       ) LIMIT 1""",
                    (ticker,),
                ).fetchone() is not None
            monitor.write_snapshot(db, self.snapshot_path)
        with self.state_lock:
            self.state["discoveryCache"].update({
                "persistedSources": sum(len(cache) for cache in discovery_caches.values()),
                "invalidatedSources": invalidated_sources,
            })

        # Retain the existing telemetry row budget: source evidence is saved
        # immediately, but URL-free polling metrics are grouped independently.
        # The bounded list also matches record_discovery_poll_batch's ceiling.
        pending_metrics = []
        next_metrics_flush = time.monotonic() + DISCOVERY_METRICS_FLUSH_SECONDS

        def flush_discovery_metrics(force=False):
            nonlocal next_metrics_flush
            if not pending_metrics or (not force and time.monotonic() < next_metrics_flush):
                return
            first = min(pending_metrics, key=lambda metric: metric[0])
            last = pending_metrics[-1]
            with self.db_lock, monitor.connect(self.db_path) as db:
                monitor.record_discovery_poll_batch(
                    db, first[1], last[3], max(0, round((last[2] - first[0]) * 1000)),
                    len(pending_metrics), sum(metric[5] for metric in pending_metrics),
                    sum(metric[6] for metric in pending_metrics),
                    (metric[4] for metric in pending_metrics),
                )
            pending_metrics.clear()
            next_metrics_flush = time.monotonic() + DISCOVERY_METRICS_FLUSH_SECONDS

        def persist_completion(ticker, future, cycle_started, cycle_started_at):
            try:
                result, links, request_duration_ms = future.result()
            except Exception as exc:
                request_duration_ms = max(0, round((time.monotonic() - cycle_started) * 1000))
                result = {
                    "ticker": ticker, "status": "degraded", "route": "none",
                    "sourceUrl": monitor.INDEXES[ticker], "candidates": 0,
                    "error": monitor.source_error_code(exc),
                }
                links = {}
            failure_streak[ticker] = (
                failure_streak[ticker] + 1 if discovery_requires_backoff(result) else 0
            )
            delay = min(300, self.interval_for(ticker) * (2 ** min(failure_streak[ticker], 6)))
            next_due[ticker] = time.monotonic() + delay
            result["nextPollSeconds"] = delay
            collected = [(ticker, result, links, request_duration_ms)]
            changed = False
            new_count = 0
            checked_at = utc_now()
            company_states = {}
            cache_metrics = {
                "conditionalRequests": 0, "notModifiedResponses": 0,
                "freshResponses": 0,
            }
            with self.db_lock, monitor.connect(self.db_path) as db:
                for ticker, result, links, request_duration_ms in collected:
                    source_cache = result.get("_sourceCache", discovery_caches[ticker])
                    result_cache_metrics = result.pop("_cacheMetrics", {})
                    for metric in cache_metrics:
                        cache_metrics[metric] += int(result_cache_metrics.get(metric, 0))
                    cache_changed = source_cache != discovery_caches[ticker]
                    signature = discovery_signature(result, links)
                    new_urls = set(links) - known[ticker]
                    if signatures.get(ticker) != signature or new_urls:
                        inserted = monitor.save_discovery(db, ticker, result, links)
                        known[ticker].update(inserted)
                        if baseline_ready[ticker]:
                            events = monitor.add_release_events(db, ticker, inserted)
                            if self.auto_drafts_enabled:
                                for url in events:
                                    source = db.execute("SELECT extracted_text FROM sources WHERE url=?", (url,)).fetchone()
                                    reservation = brief_generator.token_reservation(source["extracted_text"] if source else "")
                                    monitor.queue_generation_job(db, url, reservation)
                            new_count += len(events)
                        elif discovery_has_verified_route(result):
                            baseline_ready[ticker] = True
                        changed = True
                    elif cache_changed:
                        monitor.save_discovery_source_cache(db, ticker, source_cache)
                    discovery_caches[ticker] = source_cache
                    result.pop("_sourceCache", None)
                    signatures[ticker] = signature
                    incident_key = f"source:{ticker}"
                    if result["status"] == "degraded":
                        monitor.record_operational_incident(
                            db, incident_key, "official-source", ticker, "warning",
                            monitor.public_error(result["error"]) or "source-fetch-failed",
                            checked_at,
                        )
                    else:
                        monitor.resolve_operational_incident(db, incident_key, checked_at)
                    company_states[ticker] = {
                        "status": result["status"],
                        "route": result["route"],
                        "candidates": result["candidates"],
                        "checkedAt": checked_at,
                        "pollSeconds": result["nextPollSeconds"],
                        "basePollSeconds": self.interval_for(ticker),
                        "nextPollSeconds": result["nextPollSeconds"],
                        "requestDurationMs": request_duration_ms,
                        "error": monitor.public_error(result["error"]),
                    }
                if changed:
                    monitor.write_snapshot(db, self.snapshot_path)

                cycle_duration_ms = max(
                    0, round((time.monotonic() - cycle_started) * 1000)
                )
                completed_at = utc_now()

            pending_metrics.append((
                cycle_started, cycle_started_at, time.monotonic(), completed_at,
                request_duration_ms, int(result["status"] == "degraded"), new_count,
            ))
            if len(pending_metrics) >= DISCOVERY_METRICS_MAX_CHECKS:
                flush_discovery_metrics(force=True)

            with self.state_lock:
                self.state["ready"] = True
                self.state["lastCycleAt"] = completed_at
                self.state["lastCycleDurationMs"] = cycle_duration_ms
                self.state["lastCycleCompanies"] = 1
                self.state["cycles"] += 1
                self.state["newSources"] += new_count
                self.state["companies"].update(company_states)
                discovery_cache = self.state["discoveryCache"]
                discovery_cache["persistedSources"] = sum(
                    len(cache) for cache in discovery_caches.values()
                )
                for metric, count in cache_metrics.items():
                    discovery_cache[metric] += count
                discovery_cache["lastUpdatedAt"] = checked_at
                if new_count:
                    self.state["lastChangeAt"] = checked_at
                priority_coverage = self.current_priority_source_coverage(
                    self.state, remember_completion=True
                )
                process_started_at = self.state["startedAt"]

            self.persist_priority_source_coverage_if_due(
                process_started_at, completed_at, priority_coverage
            )

            if changed:
                # Publication workers must only see committed source evidence.
                self.wake_publication_workers()

        # Discovery and bodies share the configured network-worker budget. One
        # slot is reserved for each lane, without a second executor or an
        # executor backlog. A single-worker installation alternates due lanes.
        lane_limit = max(1, self.workers - 1)
        discovery_hosts = {
            ticker: {
                monitor.source_hostname(source["url"])
                for source in monitor.monitoring_sources(ticker, automatic=True)
                # Shared SEC endpoints use the actual-request rate gate. An
                # unused SEC fallback must not reserve a host for every issuer.
                if monitor.source_hostname(source["url"]) not in {"www.sec.gov", "data.sec.gov"}
            } for ticker in next_due
        }
        in_flight = {}
        body_futures = {}
        body_batches = []
        last_lane = "body"
        pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="source")
        try:
            while not self.stop_event.is_set():
                # Save each completed issuer independently, before dispatching
                # more work or waiting for a different issuer/body request.
                for ticker, (future, started, started_at) in list(in_flight.items()):
                    if future.done():
                        persist_completion(ticker, future, started, started_at)
                        del in_flight[ticker]

                for future, (batch, row) in list(body_futures.items()):
                    if future.done():
                        try:
                            self.save_body_completion(batch, (row, *future.result()))
                        except Exception:
                            batch["failed"] = True
                        batch["in_flight"] -= 1
                        del body_futures[future]
                for batch in list(body_batches):
                    if batch["remaining"] or batch["in_flight"]:
                        continue
                    try:
                        if batch["failed"]:
                            next_body_fetch = max(
                                next_body_fetch, time.monotonic() + self.record_body_fetch_failure()
                            )
                        else:
                            self.finish_body_batch(batch)
                            # Successful persistence clears the global worker
                            # fault; clear its matching scheduler hold too.
                            # Source/host retry schedules remain in the DB.
                            next_body_fetch = body_admission_due
                    except Exception:
                        next_body_fetch = max(
                            next_body_fetch, time.monotonic() + self.record_body_fetch_failure()
                        )
                    body_batches.remove(batch)

                body_rows = [row for batch in body_batches for row in batch["remaining"]]
                body_rows += [row for _batch, row in body_futures.values()]
                capacity = self.body_batch - len(body_rows)
                if capacity > 0 and time.monotonic() >= next_body_fetch:
                    try:
                        batch = self.begin_body_batch(
                            excluded_urls={row["url"] for row in body_rows},
                            excluded_tickers={row["ticker"] for row in body_rows},
                            excluded_hosts={monitor.source_hostname(row["url"]) for row in body_rows},
                            max_candidates=capacity,
                        )
                        if batch is not None:
                            batch["remaining"] = list(batch["rows"])
                            batch["in_flight"] = 0
                            body_batches.append(batch)
                            body_rows += batch["remaining"]
                        # Cadence is admission-based: a slow previous body does
                        # not defer a newly eligible source's next selection.
                        # Across batches, queued plus running rows never exceed
                        # the existing configured body-batch allowance.
                        body_admission_due = time.monotonic() + self.body_interval
                        next_body_fetch = body_admission_due
                    except Exception:
                        next_body_fetch = time.monotonic() + self.record_body_fetch_failure()

                # Pending bodies reserve their ticker/host before another
                # discovery starts there. Existing requests drain naturally;
                # unrelated discovery continues and host courtesy is retained.
                body_tickers = {row["ticker"] for row in body_rows}
                body_hosts = {monitor.source_hostname(row["url"]) for row in body_rows}
                active_hosts = set().union(*(discovery_hosts[ticker] for ticker in in_flight))
                current = time.monotonic()
                due = sorted(
                    (ticker for ticker in next_due
                     if ticker not in in_flight and next_due[ticker] <= current
                     and ticker not in body_tickers
                     and not discovery_hosts[ticker].intersection(body_hosts)),
                    key=lambda ticker: next_due[ticker],
                )
                while len(in_flight) + len(body_futures) < self.workers and not self.stop_event.is_set():
                    active_body_tickers = {row["ticker"] for _batch, row in body_futures.values()}
                    body_choice = next(((batch, row) for batch in body_batches
                                        for row in batch["remaining"]
                                        if row["ticker"] not in in_flight
                                        and row["ticker"] not in active_body_tickers
                                        and monitor.source_hostname(row["url"]) not in active_hosts), None)
                    can_discover = bool(due) and len(in_flight) < lane_limit
                    # Give an idle body lane first use of the reserved slot.
                    # With one worker, alternating prevents either lane from
                    # consuming every newly free slot indefinitely.
                    choose_body = body_choice is not None and len(body_futures) < lane_limit and (
                        not can_discover or (self.workers > 1 and not body_futures)
                        or (self.workers == 1 and last_lane == "discovery")
                    )
                    if choose_body:
                        batch, body_row = body_choice
                        future = pool.submit(self.collect_body_timed, body_row)
                        body_futures[future] = (batch, body_row)
                        batch["remaining"].remove(body_row)
                        batch["in_flight"] += 1
                        last_lane = "body"
                    elif can_discover:
                        ticker = due.pop(0)
                        started, started_at = time.monotonic(), utc_now()
                        future = pool.submit(self.collect_discovery_timed, ticker, discovery_caches[ticker])
                        in_flight[ticker] = (future, started, started_at)
                        active_hosts.update(discovery_hosts[ticker])
                        last_lane = "discovery"
                    else:
                        break
                flush_discovery_metrics()
                # Short interruptible waits bound completion/publication latency
                # and stop responsiveness, independent of network timeouts.
                self.stop_event.wait(0.05)
        finally:
            # Running requests cannot be forcibly interrupted, but they perform
            # no DB writes. Do not let shutdown wait for a slow publisher. On a
            # recoverable loop failure drain before supervised restart, avoiding
            # overlapping same-ticker requests across executor generations.
            try:
                flush_discovery_metrics(force=True)
            finally:
                pool.shutdown(wait=not self.stop_event.is_set(), cancel_futures=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "TechPhaseMonitor/1.0"

    @property
    def app(self):
        return self.server.app

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        compressed = "gzip" in self.headers.get("Accept-Encoding", "").lower()
        if compressed:
            payload = gzip.compress(payload, compresslevel=5)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if compressed:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self):
        token = os.environ.get("RESEARCH_API_TOKEN")
        if not token:
            return True
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + token)

    def editor_authorized(self):
        token = os.environ.get("RESEARCH_EDITOR_TOKEN")
        if not token:
            return False
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + token)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid-content-length") from exc
        if not 1 <= length <= 64 * 1024:
            raise ValueError("invalid-request-size")
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid-json") from exc
        if not isinstance(value, dict):
            raise ValueError("invalid-json-object")
        return value

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == "/push/config":
            if not self.authorized():
                self.send_json(401, {"ok": False})
                return
            self.send_json(200, {"ok": True, **web_push.configuration(),
                                "tickers": sorted(set(self.app.tickers) | signals.X_EXTRA_TICKERS)})
            return
        if path == "/livez":
            self.send_json(200, {"ok": True, "status": "alive"})
            return
        if path in {"/health", "/readyz"}:
            state = self.app.public_state()
            self.send_json(200 if path == "/health" or state["ready"] else 503, state)
            return
        if path in {"/admin/briefs", "/admin/annual-briefs", "/admin/signals", "/admin/news", "/admin/posts", "/admin/questions", "/admin/official-research"}:
            if not self.editor_authorized():
                self.send_json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                if "eventId" in query:
                    if path != "/admin/signals" or len(query["eventId"]) != 1:
                        raise ValueError("invalid-event-id")
                    detail = self.app.signal_source_detail(query["eventId"][0])
                    self.send_json(200 if detail else 404, {"ok": bool(detail),
                                   **({"detail": detail} if detail else {"error": "source-not-found"})})
                    return
                limit = int(parse_qs(parsed.query).get("limit", ["20"])[0])
                view = parse_qs(parsed.query).get("view", ["pending" if path == "/admin/official-research" else "all"])[0]
                queue = (self.app.official_research_queue(limit, view) if path == "/admin/official-research" else
                         self.app.question_queue(view, limit) if path == "/admin/questions" else
                         self.app.posts_queue(limit, offset=int(parse_qs(parsed.query).get("offset", ["0"])[0])) if path == "/admin/posts" else
                         self.app.stock_news_queue(limit) if path == "/admin/news" else
                         self.app.signal_queue(limit, view, parse_qs(parsed.query).get("ticker", [None])[0])
                         if path == "/admin/signals" else
                         self.app.annual_editorial_queue(limit, view) if path == "/admin/annual-briefs"
                         else self.app.editorial_queue(
                             limit, view
                         ))
                self.send_json(200, {"ok": True, **queue})
            except (TypeError, ValueError):
                self.send_json(400, {"ok": False, "error": "invalid-request"})
            except Exception:
                self.send_json(503, {"ok": False, "error": "editorial-queue-unavailable"})
            return
        if path == "/annual-brief":
            if not self.authorized():
                self.send_json(401, {"ok": False, "error": "unauthorized"})
                return
            query = parse_qs(parsed.query)
            try:
                brief = self.app.public_annual_brief(
                    query.get("ticker", [""])[0], query.get("accession", [""])[0],
                    query.get("sha256", [""])[0],
                )
                self.send_json(200, {"ok": True, "brief": brief,
                                     "status": "approved" if brief else "pending"})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except Exception:
                self.send_json(503, {"ok": False, "error": "annual-brief-unavailable"})
            return
        if path == "/questions":
            if not self.authorized():
                self.send_json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                owner_key = self.headers.get("X-Question-Owner", "")
                limit = int(parse_qs(parsed.query).get("limit", ["20"])[0])
                self.send_json(200, {"ok": True, **self.app.member_questions(owner_key, limit, self.headers.get("X-Question-Audience") == "pro-board")})
            except (TypeError, ValueError) as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except Exception:
                self.send_json(503, {"ok": False, "error": "question-list-unavailable"})
            return
        if path not in {"/snapshot", "/live", "/price-targets", "/news", "/posts"}:
            self.send_json(404, {"ok": False, "error": "not-found"})
            return
        if not self.authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            if path == "/posts":
                self.send_json(200, {"ok": True, **self.app.posts_queue(published=True)})
                return
            if path == "/news":
                self.send_json(200, self.app.public_news())
                return
            if path == "/price-targets":
                self.send_json(200, self.app.public_price_targets())
                return
            snapshot = self.app.public_snapshot()
            if path == "/snapshot":
                self.send_json(200, snapshot)
            else:
                self.send_json(200, {"ok": True, "mode": "automatic", "monitor": self.app.public_state(), "snapshot": snapshot})
        except Exception:
            self.send_json(503, {"ok": False, "error": "snapshot-unavailable"})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/questions":
            if not self.authorized():
                self.send_json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                self.send_json(200, {"ok": True, **self.app.submit_question(self.read_json())})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except Exception:
                self.send_json(503, {"ok": False, "error": "question-submit-unavailable"})
            return
        if path in {"/push/register", "/push/remove", "/push/status", "/push/test", "/push/member/register", "/push/member/remove", "/push/member/status", "/push/member/test", "/push/member/revoke"}:
            if not self.authorized():
                self.send_json(401, {"ok": False})
                return
            if not web_push.configuration()["enabled"]:
                self.send_json(503, {"ok": False})
                return
            try:
                payload = self.read_json()
                with web_push.connect(self.app.db_path) as db:
                    if path == "/push/member/register":
                        result = web_push.register_member(db, payload, set(self.app.tickers) | signals.X_EXTRA_TICKERS)
                    elif path == "/push/member/revoke":
                        result = web_push.revoke_member(db, payload)
                    elif path.startswith("/push/member/"):
                        result = web_push.member_action(db, payload, path.rsplit("/", 1)[1])
                    elif path == "/push/status":
                        result = web_push.device_status(db, payload)
                    elif path == "/push/test":
                        result = web_push.test_notification(db, payload)
                    elif path == "/push/remove":
                        result = web_push.remove(db, payload)
                    else:
                        result = web_push.register(db, payload, set(self.app.tickers) | signals.X_EXTRA_TICKERS)
                self.send_json(200, {"ok": True, **result})
            except ValueError:
                self.send_json(400, {"ok": False, "error": "invalid-registration"})
            except Exception:
                self.send_json(503, {"ok": False})
            return
        if path not in {
            "/admin/posts/draft", "/admin/posts/review", "/admin/questions/review", "/admin/questions/answer",
            "/admin/news/generate", "/admin/news/retry", "/admin/news/review", "/admin/news/draft",
            "/admin/briefs/generate", "/admin/briefs/draft", "/admin/briefs/review",
            "/admin/annual-briefs/draft", "/admin/annual-briefs/review",
        }:
            self.send_json(404, {"ok": False, "error": "not-found"})
            return
        if not self.editor_authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            payload = self.read_json()
            if path == "/admin/questions/answer":
                result = self.app.answer_question(payload)
            elif path == "/admin/questions/review":
                result = self.app.review_question(payload)
            elif path in {"/admin/posts/draft", "/admin/posts/review"}:
                result = self.app.save_post(payload, review=path.endswith("/review"))
            elif path == "/admin/news/generate":
                result = self.app.generate_news_draft(payload)
            elif path == "/admin/news/retry":
                result = self.app.retry_news_draft(payload)
            elif path == "/admin/news/review":
                result = self.app.review_news_draft(payload)
            elif path == "/admin/news/draft":
                result = self.app.save_news_draft(payload)
            elif path == "/admin/annual-briefs/draft":
                result = self.app.save_annual_brief(payload)
            elif path == "/admin/annual-briefs/review":
                result = self.app.decide_annual_brief(payload)
            elif path.endswith("/generate"):
                result = self.app.generate_brief_budgeted(payload)
            elif path.endswith("/draft"):
                result = self.app.save_brief(payload)
            else:
                result = self.app.decide_brief(payload)
            self.send_json(200, {"ok": True, **result})
        except brief_generator.GenerationUnavailable:
            self.send_json(503, {"ok": False, "error": "generation-not-configured"})
        except brief_generator.GenerationFailed:
            self.send_json(502, {"ok": False, "error": "generation-failed"})
        except ValueError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception:
            self.send_json(503, {"ok": False, "error": "editorial-write-unavailable"})

    def log_message(self, message, *args):
        print("%s - %s" % (self.address_string(), message % args), flush=True)


def main():
    root = Path(__file__).resolve().parents[2]
    data_dir = Path(os.environ.get("RESEARCH_DATA_DIR", root / ".research-private"))
    db_path = os.environ.get("RESEARCH_DB_PATH", data_dir / "automatic.sqlite")
    snapshot_path = os.environ.get("RESEARCH_SNAPSHOT_PATH", data_dir / "automatic-snapshot.json")
    host = os.environ.get("HOST", "0.0.0.0")
    port = positive_int("PORT", 8080, 1)
    app = AutomaticMonitor(db_path, snapshot_path)
    streaming = os.environ.get("RESEARCH_STREAM_ENABLED", "true").lower() == "true"
    server = ThreadingHTTPServer(("127.0.0.1", 0) if streaming else (host, port), Handler)
    server.app = app

    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    if not streaming:
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
    app.start()
    print(json.dumps({"event": "listening", "host": host, "port": port}), flush=True)
    try:
        if streaming:
            from aiohttp import web
            from stream_gateway import create_gateway
            gateway, _ = create_gateway(app.public_price_targets, os.environ.get("RESEARCH_API_TOKEN", ""),
                                       f"http://127.0.0.1:{server.server_port}")
            threading.Thread(target=server.serve_forever, daemon=True).start()
            web.run_app(gateway, host=host, port=port, access_log=None, shutdown_timeout=5)
        else:
            server.serve_forever(poll_interval=0.5)
    finally:
        if streaming:
            server.shutdown()
        app.stop()
        server.server_close()


if __name__ == "__main__":
    main()
