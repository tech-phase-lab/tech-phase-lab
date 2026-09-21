"""Verified local SQLite backups for the private research monitor database."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3


REQUIRED_TABLES = {
    "sources", "history", "source_revisions", "discovery_runs", "release_events", "briefs",
    "brief_evidence", "brief_generation_jobs", "brief_generation_attempts",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def validate_database(path, expected_sha256=None):
    """Open a database read-only and reject corruption or an incomplete schema."""
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("backup-file-unavailable")
    path = path.resolve()
    actual_sha256 = digest(path)
    if expected_sha256 and actual_sha256 != expected_sha256:
        raise ValueError("backup-hash-mismatch")
    uri = path.as_uri() + "?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True) as db:
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


def verify_backup(backup_path):
    """Require a valid creation manifest and verify its digest plus SQLite data."""
    backup_path = Path(backup_path)
    manifest_path = backup_path.with_suffix(".json")
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ValueError("backup-manifest-unavailable")
    try:
        manifest = json.loads(manifest_path.read_text())
        expected = manifest.get("sha256") if isinstance(manifest, dict) else None
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("backup-manifest-invalid") from exc
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError("backup-manifest-invalid")
    return validate_database(backup_path, expected_sha256=expected)


def _write_manifest(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def _prune(backup_dir, retain):
    backups = sorted(
        (path for path in backup_dir.glob("research-*.sqlite") if path.is_file() and not path.is_symlink()),
        reverse=True,
    )
    for old in backups[retain:]:
        old.unlink(missing_ok=True)
        old.with_suffix(".json").unlink(missing_ok=True)
    return min(len(backups), retain)


def create_backup(database_path, backup_dir, retain=24):
    """Create, verify, checksum, and atomically publish one online backup."""
    database_path, backup_dir = Path(database_path), Path(backup_dir)
    retain = max(2, min(int(retain), 168))
    if not database_path.is_file():
        raise ValueError("database-file-unavailable")
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_dir.chmod(0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    final = backup_dir / f"research-{stamp}.sqlite"
    temporary = final.with_name(final.name + ".tmp")
    try:
        with sqlite3.connect(database_path) as source, sqlite3.connect(temporary) as destination:
            source.execute("PRAGMA busy_timeout = 5000")
            source.backup(destination)
        checked = validate_database(temporary)
        temporary.chmod(0o600)
        os.replace(temporary, final)
        manifest = {
            "schemaVersion": 1, "createdAt": utc_now(), "filename": final.name,
            "bytes": checked["bytes"], "sha256": checked["sha256"], "integrity": "ok",
        }
        _write_manifest(final.with_suffix(".json"), manifest)
        count = _prune(backup_dir, retain)
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
        with sqlite3.connect(backup_path) as source, sqlite3.connect(temporary) as destination:
            source.backup(destination)
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
