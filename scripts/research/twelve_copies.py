"""Durable copies of the website's costly Twelve Data answers (POST /twelve/copies/get and /twelve/copies/put).

Production, Nov 26: the site kept these copies only in Vercel's Runtime Cache (Next.js unstable_cache), which Vercel describes as
ephemeral and regional. The comparison's daily statistics copies (50 credits each) were gone 4.6 to 7.7 hours after the warm job stored
them: ASML and AVNT at 00:21 UTC and UNFI at 03:30 were all read again at 08:00-08:05 for 50 credits each, while YUM at 05:35 and SONO at
07:51 were still there. The site then paid again on members' requests, and its refusals starved the warm job. The site now also writes
those copies here, to a small SQLite file on the monitor's volume, and reads them back when the runtime cache has lost them.

Only the kinds listed in KINDS and the latest copy per kind and key are stored. A large value (the quarterly statements, 200 credits a
company) comes gzip-compressed and base64-encoded as {"$gz": "..."}, and when even that is over the gateway's 64 KB body limit it comes in
parts (part / parts / chunk) that are put together here once all of them have arrived. Copies are only cached provider
answers, so a lost file costs credits and nothing else. The site's server token only; nothing here is logged but counts."""
import json
import re
import sqlite3
import time
from pathlib import Path

# The kinds of copies the site keeps durable (lib/research/twelve-copies.ts DURABLE_KINDS; a test keeps them equal).
KINDS = ('compare-statistics', 'compare-statements', 'md-facts-stats-v2', 'md-facts-next-earnings-v2', 'portfolio-splits')
KEY = re.compile(r'[A-Za-z0-9.\-|:/]{1,80}')
MAX_VALUE_BYTES = 48 * 1024   # one request's value or part (a /statistics answer is about 2 KB); the gateway takes 64 KB bodies
MAX_PARTS = 32                # a value in parts is at most MAX_PARTS * MAX_VALUE_BYTES (1.5 MB) once put together
PART_SECONDS = 3600           # parts of a value that never got complete are removed after this
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
    db.execute('CREATE TABLE IF NOT EXISTS parts (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, part INTEGER NOT NULL, '
               'parts INTEGER NOT NULL, chunk TEXT NOT NULL, received REAL NOT NULL, PRIMARY KEY (kind, key, at, part))')
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
    if 'part' in payload or 'parts' in payload or 'chunk' in payload:
        value = _put_part(db, kind, key, at, payload, now)
        if value is None:
            return False  # more parts to come
    else:
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


def _put_part(db, kind, key, at, payload, now):
    """Keeps one part of a compressed value; when every part has arrived, returns the whole value ({"$gz": ...}) as JSON text."""
    part, parts, chunk = payload.get('part'), payload.get('parts'), payload.get('chunk')
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (part, parts)) or not 2 <= parts <= MAX_PARTS or not 0 <= part < parts:
        raise ValueError('invalid-part')
    if not isinstance(chunk, str) or not chunk or len(chunk) > MAX_VALUE_BYTES or not re.fullmatch(r'[A-Za-z0-9+/=]+', chunk):
        raise ValueError('invalid-chunk')
    with db:
        db.execute('DELETE FROM parts WHERE received < ?', (now - PART_SECONDS,))
        db.execute('INSERT OR REPLACE INTO parts (kind, key, at, part, parts, chunk, received) VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (kind, key, at, part, parts, chunk, now))
    rows = db.execute('SELECT part, chunk FROM parts WHERE kind = ? AND key = ? AND at = ? AND parts = ? ORDER BY part',
                      (kind, key, at, parts)).fetchall()
    if [r[0] for r in rows] != list(range(parts)):
        return None
    with db:
        db.execute('DELETE FROM parts WHERE kind = ? AND key = ? AND at <= ?', (kind, key, at))
    return json.dumps({'$gz': ''.join(r[1] for r in rows)}, separators=(',', ':'))


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
