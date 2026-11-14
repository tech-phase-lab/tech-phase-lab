"""Verified local SQLite backups for the private research monitor database."""

import argparse
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3


REQUIRED_TABLES = {
    "sources", "history", "source_revisions", "discovery_runs", "release_events", "briefs",
    "brief_evidence", "brief_generation_jobs", "brief_generation_attempts",
}


BACKUP_NAME = re.compile(r"research-([0-9]{8}T[0-9]{6}\.[0-9]{6}Z)\.sqlite\Z")
MAX_MANIFEST_BYTES = 4096
MAX_RECOVERY_DIRECTORY_ENTRIES = 4096
MAX_RECOVERY_CANDIDATES = 8


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def validate_database(path, expected_sha256=None):
    """Verify a standalone snapshot without creating or replaying WAL sidecars."""
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("backup-file-unavailable")
    path = path.resolve()
    # Snapshot digests cover the main file only. Never silently ignore pending
    # writes in a WAL or rollback journal when opening it as immutable.
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(path) + suffix)
        if sidecar.is_symlink() or (sidecar.exists() and (
            not sidecar.is_file() or sidecar.stat().st_size
        )):
            raise ValueError("backup-not-standalone")
    actual_sha256 = digest(path)
    if expected_sha256 and actual_sha256 != expected_sha256:
        raise ValueError("backup-hash-mismatch")
    uri = path.as_uri() + "?mode=ro&immutable=1"
    try:
        with closing(sqlite3.connect(uri, uri=True)) as db:
            integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
            if integrity != ["ok"]:
                raise ValueError("backup-integrity-check-failed")
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
            missing = sorted(REQUIRED_TABLES - tables)
            if missing:
                raise ValueError("backup-schema-incomplete")
    except sqlite3.DatabaseError as exc:
        raise ValueError("backup-invalid-sqlite") from exc
    return {"ok": True, "bytes": path.stat().st_size, "sha256": actual_sha256}


def _read_manifest(backup_path, now):
    """Read only this snapshot's bounded manifest; reject inconsistent metadata."""
    match = BACKUP_NAME.fullmatch(backup_path.name)
    if not match or not backup_path.is_file() or backup_path.is_symlink():
        raise ValueError("backup-file-unavailable")
    manifest_path = backup_path.with_suffix(".json")
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ValueError("backup-manifest-unavailable")
    try:
        with manifest_path.open("rb") as handle:
            raw = handle.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            raise ValueError("backup-manifest-invalid")
        manifest = json.loads(raw)
        if not isinstance(manifest, dict):
            raise ValueError("backup-manifest-invalid")
        created = datetime.fromisoformat(manifest["createdAt"])
        started = datetime.strptime(match[1], "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=timezone.utc)
        if (type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1
                or manifest.get("filename") != backup_path.name
                or type(manifest.get("bytes")) is not int or manifest["bytes"] <= 0
                or manifest.get("integrity") != "ok"
                or not isinstance(manifest.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"])
                or created.tzinfo is None or created.utcoffset() != timedelta(0)
                or created > now or started > now
                # createdAt is recorded at millisecond precision, the filename at
                # microsecond precision, so tolerate only that rounding difference.
                or created < started - timedelta(milliseconds=1)):
            raise ValueError("backup-manifest-invalid")
    except (OSError, KeyError, TypeError, UnicodeError, ValueError, RecursionError) as exc:
        raise ValueError("backup-manifest-invalid") from exc
    if manifest["bytes"] != backup_path.stat().st_size:
        raise ValueError("backup-hash-mismatch")
    return manifest, created


def verify_backup(backup_path):
    """Require a valid creation manifest and verify its digest plus SQLite data."""
    backup_path = Path(backup_path)
    manifest, _ = _read_manifest(backup_path, datetime.now(timezone.utc))
    return validate_database(backup_path, expected_sha256=manifest["sha256"])


def recover_latest_backup(backup_dir, max_age_seconds, *, now=None):
    """Return recent verified success metadata, or None so a new backup is due.

    Read-only and bounded: inspect at most 4096 directory entries and verify at
    most the newest eight exactly named snapshots. backupCount counts snapshot
    files (as create_backup does), not sidecars or independently verified copies.
    Any scan failure/overflow fails closed; invalid, future, or stale candidates
    never postpone a required backup. No existing file is changed or pruned.
    """
    now = now if now is not None else datetime.now(timezone.utc)
    if (not isinstance(now, datetime) or now.tzinfo is None
            or isinstance(max_age_seconds, bool)
            or not isinstance(max_age_seconds, (int, float))
            or not math.isfinite(max_age_seconds) or max_age_seconds <= 0):
        raise ValueError("backup-recovery-arguments-invalid")
    backup_dir = Path(backup_dir)
    try:
        if not backup_dir.is_dir() or backup_dir.is_symlink():
            return None
        backups = []
        with os.scandir(backup_dir) as entries:
            for index, entry in enumerate(entries):
                if index >= MAX_RECOVERY_DIRECTORY_ENTRIES:
                    return None
                if BACKUP_NAME.fullmatch(entry.name) and entry.is_file(follow_symlinks=False):
                    backups.append(backup_dir / entry.name)
        backups.sort(reverse=True)
        for backup in backups[:MAX_RECOVERY_CANDIDATES]:
            try:
                manifest, created = _read_manifest(backup, now)
                if (now - created).total_seconds() >= max_age_seconds:
                    continue
                validate_database(backup, expected_sha256=manifest["sha256"])
                return {"createdAt": manifest["createdAt"], "backupCount": len(backups)}
            except (OSError, ValueError):
                continue
    except OSError:
        return None
    return None


def _write_manifest(path, value):
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)   # a full disk used to leave an empty .json.tmp behind on every attempt (1,000+ files, Nov 13)


# Anything named after one of our snapshots' timestamps that is not that snapshot or its manifest is a leftover of an interrupted attempt:
# *.sqlite.tmp, *.json.tmp, and SQLite's own sidecars of a half-written copy (*.sqlite.tmp-journal, -wal, -shm). Nov 13: after the first cleanup
# ~1,000 files were still there, one per 30-second restart; their names did not match the two temporaries this used to know.
STAMP = r"research-[0-9]{8}T[0-9]{6}\.[0-9]{6}Z"
TEMPORARY = re.compile(STAMP + r"\.(?!(?:sqlite|json)\Z).+")
# The share of the volume the retained snapshots (plus the live database) may use. A count alone (24) cannot work on a small volume:
# 24 x a 27 MB database is more than a 500 MB volume (Nov 13: disk full, every write failed, the monitor restarted every 30 s).
VOLUME_BUDGET = 0.45
MIN_KEPT = 2


def retention_plan(backup_dir, retain, database_bytes=0, volume_bytes=None, *, reserve=False):
    """What to keep and what to delete. Pure: reads names, manifests and sizes, deletes nothing.

    Keeps the newest `retain` snapshots that have a valid manifest, but no more than fit in VOLUME_BUDGET of the volume after the live database
    (always at least MIN_KEPT; one fewer when `reserve` makes room for the snapshot about to be written). Deletes: leftover temporaries, a
    snapshot without a valid manifest and a manifest without its snapshot (only while a valid snapshot exists), and the valid snapshots
    beyond that number. Files with any other name are never touched."""
    backup_dir = Path(backup_dir)
    now = datetime.now(timezone.utc)
    valid, orphans, delete_files = [], [], []
    names = {}
    for entry in backup_dir.iterdir():
        if entry.is_symlink() or not entry.is_file():
            continue
        names[entry.name] = entry
    for name, entry in names.items():
        if TEMPORARY.fullmatch(name):
            delete_files.append(entry)
        elif BACKUP_NAME.fullmatch(name):
            try:
                _read_manifest(entry, now)
                valid.append(entry)
            except (OSError, ValueError):
                orphans.append(entry)
    valid.sort(key=lambda path: path.name, reverse=True)
    size = valid[0].stat().st_size if valid else 0
    keep = max(1, int(retain))
    if volume_bytes and size:
        fit = int((volume_bytes * VOLUME_BUDGET - database_bytes) // size)
        keep = min(keep, max(MIN_KEPT, fit))
    if reserve:
        keep = max(1, keep - 1)
    kept, dropped = valid[:keep], valid[keep:]
    if valid:
        delete_files.extend(orphans)
        for name, entry in names.items():
            if name.endswith(".json") and BACKUP_NAME.fullmatch(name[:-5] + ".sqlite") and name[:-5] + ".sqlite" not in names:
                delete_files.append(entry)
    for old in dropped:
        delete_files.extend([old, old.with_suffix(".json")])
    return {"kept": kept, "delete": [path for path in delete_files if path.exists()], "validSnapshots": len(valid)}


def enforce_retention(backup_dir, retain, database_path=None, *, reserve=False):
    """Apply retention_plan. The kept generations are verified first: if none of them passes the full check (manifest digest and SQLite
    integrity) no snapshot is deleted at all (only leftover temporaries), so the last good backup can never be removed on a guess.
    Returns counts only."""
    backup_dir = Path(backup_dir)
    if not backup_dir.is_dir() or backup_dir.is_symlink():
        return {"deleted": 0, "kept": 0, "freedBytes": 0}
    database_bytes = 0
    if database_path is not None:
        for suffix in ("", "-wal", "-shm"):
            candidate = Path(str(database_path) + suffix)
            if candidate.is_file():
                database_bytes += candidate.stat().st_size
    try:
        volume = shutil.disk_usage(backup_dir).total
    except OSError:
        volume = None
    plan = retention_plan(backup_dir, retain, database_bytes, volume, reserve=reserve)
    verified = False
    for snapshot in plan["kept"]:
        try:
            verify_backup(snapshot)
            verified = True
            break
        except (OSError, ValueError):
            continue
    deleting = plan["delete"] if verified else [path for path in plan["delete"] if TEMPORARY.fullmatch(path.name)]
    kept_paths = {path for snapshot in plan["kept"] for path in (snapshot, snapshot.with_suffix(".json"))}
    freed = deleted = 0
    for path in deleting:
        if path in kept_paths or path.is_symlink():
            continue
        try:
            freed += path.stat().st_size
            path.unlink(missing_ok=True)
            deleted += 1
        except OSError:
            continue
    return {"deleted": deleted, "kept": len(plan["kept"]) if verified else plan["validSnapshots"], "freedBytes": freed}


def _prune(backup_dir, retain):
    """Kept for compatibility: the size-aware retention."""
    return enforce_retention(backup_dir, retain)["kept"]


def create_backup(database_path, backup_dir, retain=24):
    """Create, verify, checksum, and atomically publish one online backup."""
    database_path, backup_dir = Path(database_path), Path(backup_dir)
    retain = max(2, min(int(retain), 168))
    if not database_path.is_file():
        raise ValueError("database-file-unavailable")
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_dir.chmod(0o700)
    # Leftover temporaries and generations beyond what the volume can hold go first (Nov 13: 24 x 27 MB did not fit a 500 MB volume).
    # When the new copy still cannot fit, make room for it by keeping one generation fewer.
    enforce_retention(backup_dir, retain, database_path)
    if shutil.disk_usage(backup_dir).free < database_path.stat().st_size * 1.1 + 16 * 1024 * 1024:
        enforce_retention(backup_dir, retain, database_path, reserve=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    final = backup_dir / f"research-{stamp}.sqlite"
    temporary = final.with_name(final.name + ".tmp")
    try:
        with closing(sqlite3.connect(database_path)) as source, closing(sqlite3.connect(temporary)) as destination:
            source.execute("PRAGMA busy_timeout = 5000")
            source.backup(destination)
            # The online copy inherits WAL mode. Make only our new destination a
            # standalone snapshot, then close both handles before verification or
            # rename; sqlite3's transaction context manager does not close them.
            destination.execute("PRAGMA journal_mode = DELETE")
        checked = validate_database(temporary)
        temporary.chmod(0o600)
        os.replace(temporary, final)
        manifest = {
            "schemaVersion": 1, "createdAt": utc_now(), "filename": final.name,
            "bytes": checked["bytes"], "sha256": checked["sha256"], "integrity": "ok",
        }
        _write_manifest(final.with_suffix(".json"), manifest)
        count = enforce_retention(backup_dir, retain, database_path)["kept"]
        return {**manifest, "backupCount": count}
    finally:
        temporary.unlink(missing_ok=True)


def restore_backup(backup_path, database_path, apply=False):
    """Validate by default; replace a stopped service database only with explicit apply."""
    backup_path, database_path = Path(backup_path), Path(database_path)
    checked = verify_backup(backup_path)
    if not apply:
        return {**checked, "applied": False}
    database_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = database_path.with_name(database_path.name + ".restore.tmp")
    temporary.unlink(missing_ok=True)
    try:
        source_uri = backup_path.resolve().as_uri() + "?mode=ro&immutable=1"
        with closing(sqlite3.connect(source_uri, uri=True)) as source, closing(sqlite3.connect(temporary)) as destination:
            source.backup(destination)
            destination.execute("PRAGMA journal_mode = DELETE")
        restored = validate_database(temporary)
        temporary.chmod(0o600)
        os.replace(temporary, database_path)
        # Restores are intentionally offline. Removing stale sidecars prevents an old
        # WAL from being replayed over the verified replacement on the next startup.
        Path(str(database_path) + "-wal").unlink(missing_ok=True)
        Path(str(database_path) + "-shm").unlink(missing_ok=True)
        return {**restored, "applied": True}
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("--db", required=True)
    backup.add_argument("--dir", required=True)
    backup.add_argument("--retain", type=int, default=24)
    verify = commands.add_parser("verify")
    verify.add_argument("--backup", required=True)
    restore = commands.add_parser("restore")
    restore.add_argument("--backup", required=True)
    restore.add_argument("--db", required=True)
    restore.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.command == "backup":
        result = create_backup(args.db, args.dir, args.retain)
    elif args.command == "verify":
        result = verify_backup(args.backup)
    else:
        result = restore_backup(args.backup, args.db, apply=args.apply)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
