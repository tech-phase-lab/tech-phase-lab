"""One-shot, explicitly configured wall-clock + monotonic bound for X trials.

This wrapper only stops intake. It never resumes legacy polling, clears safety
stops, renews evidence or permits a second trial. Operational evidence stays in
the private service filesystem/database, not in source control or public health.
"""
from contextlib import suppress
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import re
import threading
import time

import monitor
import x_budget
import x_stream
import x_stream_runtime as runtime

PILOT_ENV = 'X_FILTERED_STREAM_PILOT_FILE'
MAX_PILOT_MICROS = 1_000_000


def load_pilot(env, bundle, now):
    raw_path = env.get(PILOT_ENV, '')
    if not isinstance(raw_path, str) or not raw_path or len(raw_path) > 4096:
        raise x_stream.StreamBlocked('x-pilot-config-missing')
    path = Path(raw_path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise x_stream.StreamBlocked('x-pilot-config-path-invalid')
    try:
        with path.open('rb') as handle:
            raw = handle.read(4097)
        if len(raw) > 4096:
            raise ValueError
        value = json.loads(raw)
        if (not isinstance(value, dict) or set(value) != {'version', 'pilot_id', 'approval_id', 'end_at'}
                or type(value['version']) is not int or value['version'] != 1
                or not isinstance(value['pilot_id'], str)
                or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value['pilot_id'])
                or value['approval_id'] != bundle['approval_id']):
            raise ValueError
        current, end = x_budget.utc(now), x_budget.utc(value['end_at'])
        earliest = min(x_budget.utc(bundle['verified_at']), x_budget.utc(bundle['budget']['verified_at']))
        if (current.date() != end.date()
                or not current < end <= min(current + timedelta(seconds=900), earliest + timedelta(seconds=900))):
            raise ValueError
        if bundle['budget']['daily_limit_micros'] > MAX_PILOT_MICROS:
            raise ValueError
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise x_stream.StreamBlocked('x-pilot-config-invalid') from exc
    return value, hashlib.sha256(raw).hexdigest()


class _Stop:
    def __init__(self, parent, clock, monotonic):
        self.parent, self.clock, self.monotonic = parent, clock, monotonic
        self.local = threading.Event()
        self.end = self.monotonic_end = None
        self.reason = None

    def is_set(self):
        if self.local.is_set():
            return True
        if self.parent.is_set():
            self.reason = 'service-stopped'
            return True
        if self.end is not None and (x_budget.utc(self.clock()) >= self.end or self.monotonic() >= self.monotonic_end):
            self.reason = 'deadline-reached'
            self.local.set()
            return True
        return False


class PilotSupervisor(runtime.Supervisor):
    def __init__(self, db_path, tickers, stop_event, wake, *, monotonic=None, **kwargs):
        super().__init__(db_path, tickers, stop_event, wake, **kwargs)
        self.pilot_stop = _Stop(stop_event, self.clock, monotonic or time.monotonic)
        self.stop_event = self.pilot_stop
        self.pilot = self.pilot_fingerprint = None
        self.pilot_claimed = False
        self.metadata_snapshot = None

    @staticmethod
    def metadata_exposure(db):
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_metadata_preflight_runs'").fetchone()
        if not exists:
            return (0, 0)
        row = db.execute("SELECT COALESCE(SUM(reserved_micros),0), COALESCE(SUM(cost_status='unknown'),0), COUNT(*), COALESCE(SUM(status!='verified'),0) FROM x_metadata_preflight_runs").fetchone()
        if row[1] or row[3] or type(row[0]) is not int or row[0] < 0:
            raise x_stream.StreamBlocked('x-pilot-metadata-exposure-unreconciled')
        return row[0], row[2]

    def initialize(self):
        if not runtime.requested(self.env):
            return False
        bundle, _fingerprint = runtime.load_bundle(self.env, self.clock())
        pilot, fingerprint = load_pilot(self.env, bundle, self.clock())
        # A prior claim is final, even if the process died before first I/O.
        with monitor.connect(self.db_path) as db:
            metadata_snapshot = self.metadata_exposure(db)
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_stream_pilot'").fetchone()
            if exists and db.execute('SELECT 1 FROM x_stream_pilot').fetchone():
                raise x_stream.StreamBlocked('x-pilot-already-used')
        self.pilot, self.pilot_fingerprint = pilot, fingerprint
        self.pilot_stop.end = x_budget.utc(pilot['end_at'])
        remaining = (self.pilot_stop.end - x_budget.utc(self.clock())).total_seconds()
        self.pilot_stop.monotonic_end = self.pilot_stop.monotonic() + max(0, remaining)
        if self.pilot_stop.is_set():
            raise x_stream.StreamBlocked('x-pilot-ended-before-start')
        if not super().initialize():
            return False
        # The metadata checker atomically rejects this owned supervisor. Recheck
        # after acquiring ownership to close the earlier read/claim race.
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.metadata_exposure(self.db) != metadata_snapshot:
                raise x_stream.StreamBlocked('x-pilot-metadata-changed-during-start')
        self.metadata_snapshot = metadata_snapshot
        metadata_reserve = metadata_snapshot[0]
        # Carry already-admitted metadata exposure into the same pilot budget.
        # It is never inferred to be free and never cleared on cleanup.
        if metadata_reserve:
            x_budget.reserve(self.db, 'control', metadata_reserve, self.clock())
        self.db.execute('''CREATE TABLE IF NOT EXISTS x_stream_pilot (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1), pilot_id TEXT NOT NULL,
          approved_end_at TEXT NOT NULL, started_at TEXT NOT NULL, state TEXT NOT NULL,
          ended_at TEXT, reason TEXT)''')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_pilot').fetchone():
                raise x_stream.StreamBlocked('x-pilot-already-used')
            self.db.execute('INSERT INTO x_stream_pilot VALUES(1,?,?,?,\'running\',NULL,NULL)',
                            (pilot['pilot_id'], pilot['end_at'], x_stream.stamp(self.clock())))
        self.pilot_claimed = True
        return True

    def refresh(self):
        if self.pilot_stop.is_set():
            raise x_stream.StreamBlocked('x-pilot-ended')
        super().refresh()
        if self.metadata_exposure(self.db) != self.metadata_snapshot:
            raise x_stream.StreamBlocked('x-pilot-metadata-changed')
        _pilot, fingerprint = load_pilot(self.env, self.bundle, self.clock())
        if fingerprint != self.pilot_fingerprint:
            self.pilot_stop.reason = 'configuration-changed'
            self.pilot_stop.local.set()
            raise x_stream.StreamBlocked('x-pilot-config-changed')

    async def run_async(self):
        try:
            await super().run_async()
        finally:
            # Super cleanup has awaited owned tasks and retained all money and
            # failure evidence. A terminal record never claims clean billing.
            if self.pilot_claimed:
                with suppress(Exception), monitor.connect(self.db_path) as db:
                    with db:
                        db.execute("UPDATE x_stream_pilot SET state='ended',ended_at=?,reason=? WHERE singleton=1 AND pilot_id=?",
                                   (x_stream.stamp(self.clock()), self.pilot_stop.reason or 'supervisor-stopped', self.pilot['pilot_id']))
                self.report({'mode': 'pilot-ended', 'reason': self.pilot_stop.reason or 'supervisor-stopped'})
