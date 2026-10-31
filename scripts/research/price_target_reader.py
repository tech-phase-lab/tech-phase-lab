"""Fresh public targets without schema initialization or the ingestion lock."""
from pathlib import Path
import sqlite3

import signals


def read(path, *, now=None, limit=20):
    # WAL readers see committed data while ingestion writes. Never use immutable=1:
    # it would ignore current WAL changes. Missing/uninitialized DBs fail closed.
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        items = signals.price_target_projection(db, now=now)[:max(1, min(limit, 30))]
        return {'ok': True, 'items': items, 'generatedAt': signals.stamp()}
    finally:
        db.close()
