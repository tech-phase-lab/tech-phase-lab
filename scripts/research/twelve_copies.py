"""Durable copies of the website's costly Twelve Data answers (POST /twelve/copies/get and /twelve/copies/put).

Production, Nov 26: the site kept these copies only in Vercel's Runtime Cache (Next.js unstable_cache), which Vercel describes as
ephemeral and regional. The comparison's daily statistics copies (50 credits each) were gone 4.6 to 7.7 hours after the warm job stored
them: ASML and AVNT at 00:21 UTC and UNFI at 03:30 were all read again at 08:00-08:05 for 50 credits each, while YUM at 05:35 and SONO at
07:51 were still there. The site then paid again on members' requests, and its refusals starved the warm job. The site now also writes
those copies here, to a small SQLite file on the monitor's volume, and reads them back when the runtime cache has lost them.

Only the kinds listed in KINDS, small JSON values, and the latest copy per kind and key are stored. Copies are only cached provider
answers, so a lost file costs credits and nothing else. The site's server token only; nothing here is logged but counts."""
import json
import re
import sqlite3
import time
from pathlib import Path

# The kinds of copies the site keeps durable (lib/research/twelve-copies.ts DURABLE_KINDS; a test keeps them equal).
KINDS = ('compare-statistics', 'md-facts-stats-v2', 'md-facts-next-earnings-v2')
KEY = re.compile(r'[A-Za-z0-9.\-|:/]{1,80}')
MAX_VALUE_BYTES = 48 * 1024   # a /statistics answer is about 2 KB; the gateway takes 64 KB bodies
MAX_KEYS = 64                 # one read asks for at most this many keys
KEEP_SECONDS = 40 * 86_400    # older copies are never used (the site keeps at most 14 days) and are removed
FUTURE_SECONDS = 300


def path_for(db_path):
    """A file of its own beside the monitor's database, so these writes never wait on the monitor's own."""
    return Path(db_path).with_name('twelve-copies.sqlite')


def connect(path):
    db = sqlite3.connect(str(path), timeout=5)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS copies (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, '
               'PRIMARY KEY (kind, key))')
    return db


def _kind(value):
    if value not in KINDS:
        raise ValueError('invalid-kind')
    return value


def put(db, payload, now=None):
    """Stores one copy unless a newer one is already stored. Returns True when this copy is now the stored one."""
    now = time.time() if now is None else now
    kind, key, at = _kind(payload.get('kind')), payload.get('key'), payload.get('at')
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise ValueError('invalid-key')
    if not isinstance(at, int) or isinstance(at, bool) or not (now - KEEP_SECONDS) * 1000 <= at <= (now + FUTURE_SECONDS) * 1000:
        raise ValueError('invalid-time')
    if 'value' not in payload:
        raise ValueError('invalid-value')
    value = json.dumps(payload['value'], separators=(',', ':'), allow_nan=False)
    if len(value.encode('utf-8')) > MAX_VALUE_BYTES:
        raise ValueError('value-too-large')
    with db:
        db.execute('INSERT INTO copies (kind, key, at, value) VALUES (?, ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET '
                   'at = excluded.at, value = excluded.value WHERE excluded.at > copies.at', (kind, key, at, value))
        db.execute('DELETE FROM copies WHERE at < ?', (int((now - KEEP_SECONDS) * 1000),))
    row = db.execute('SELECT at FROM copies WHERE kind = ? AND key = ?', (kind, key)).fetchone()
    return bool(row and row[0] == at)


def get(db, payload, now=None):
    """The stored copies of up to MAX_KEYS keys of one kind: {key: {"at": ms, "value": ...}}; a key without a copy is left out."""
    now = time.time() if now is None else now
    kind, keys = _kind(payload.get('kind')), payload.get('keys')
    if not isinstance(keys, list) or not 1 <= len(keys) <= MAX_KEYS or not all(isinstance(k, str) and KEY.fullmatch(k) for k in keys):
        raise ValueError('invalid-keys')
    unique = sorted(set(keys))
    rows = db.execute(f'SELECT key, at, value FROM copies WHERE kind = ? AND at >= ? AND key IN ({",".join("?" * len(unique))})',
                      (kind, int((now - KEEP_SECONDS) * 1000), *unique)).fetchall()
    return {key: {'at': at, 'value': json.loads(value)} for key, at, value in rows}
