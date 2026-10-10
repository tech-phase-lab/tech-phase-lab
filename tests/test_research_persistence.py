from contextlib import closing
from datetime import datetime, timedelta, timezone
import gc
import importlib.util
import json
import os
import sqlite3
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
monitor_spec = importlib.util.spec_from_file_location("backup_test_monitor", ROOT / "scripts/research/monitor.py")
monitor = importlib.util.module_from_spec(monitor_spec)
monitor_spec.loader.exec_module(monitor)
persistence_spec = importlib.util.spec_from_file_location("backup_test_persistence", ROOT / "scripts/research/persistence.py")
persistence = importlib.util.module_from_spec(persistence_spec)
persistence_spec.loader.exec_module(persistence)


class ResearchPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "intake.sqlite"
        self.backup_dir = self.root / "backups"
        with closing(monitor.connect(self.db_path)) as db, db:
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/first")

    def tearDown(self):
        self.temp.cleanup()

    def test_online_backup_is_verified_private_and_rotated(self):
        for _ in range(3):
            result = persistence.create_backup(self.db_path, self.backup_dir, retain=2)
        backups = sorted(self.backup_dir.glob("research-*.sqlite"))
        manifests = sorted(self.backup_dir.glob("research-*.json"))
        self.assertEqual(len(backups), 2)
        self.assertEqual(len(manifests), 2)
        self.assertEqual(result["backupCount"], 2)
        self.assertEqual(persistence.validate_database(backups[-1])["sha256"], result["sha256"])
        self.assertEqual(os.stat(self.backup_dir).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(backups[-1]).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(manifests[-1]).st_mode & 0o777, 0o600)

    def test_restore_is_dry_run_by_default_and_removes_stale_wal_sidecars(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        with closing(monitor.connect(self.db_path)) as db, db:
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/second")
        restored = self.root / "restored.sqlite"
        self.assertFalse(persistence.restore_backup(backup, restored)["applied"])
        self.assertFalse(restored.exists())
        Path(str(restored) + "-wal").write_bytes(b"stale")
        Path(str(restored) + "-shm").write_bytes(b"stale")
        self.assertTrue(persistence.restore_backup(backup, restored, apply=True)["applied"])
        self.assertFalse(Path(str(restored) + "-wal").exists())
        self.assertFalse(Path(str(restored) + "-shm").exists())
        with closing(monitor.connect(restored)) as db, db:
            self.assertEqual(db.execute("SELECT count(*) FROM sources").fetchone()[0], 1)

    def test_restore_rejects_a_backup_changed_after_its_manifest(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        manifest = json.loads(backup.with_suffix(".json").read_text())
        self.assertEqual(manifest["sha256"], result["sha256"])
        with backup.open("ab") as handle:
            handle.write(b"changed")
        with self.assertRaisesRegex(ValueError, "backup-hash-mismatch"):
            persistence.restore_backup(backup, self.root / "restored.sqlite", apply=True)

    def test_restore_rejects_a_valid_database_without_its_manifest(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        backup.with_suffix(".json").unlink()
        with self.assertRaisesRegex(ValueError, "backup-manifest-unavailable"):
            persistence.restore_backup(backup, self.root / "restored.sqlite", apply=True)

    def test_validation_rejects_a_symlink_to_a_backup(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        link = self.root / "linked.sqlite"
        link.symlink_to(backup)
        with self.assertRaisesRegex(ValueError, "backup-file-unavailable"):
            persistence.validate_database(link)


    def dated_backup(self, created):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        old = self.backup_dir / result["filename"]
        stamp = created.strftime("%Y%m%dT%H%M%S.%fZ")
        target = self.backup_dir / f"research-{stamp}.sqlite"
        old.rename(target)
        old.with_suffix(".json").rename(target.with_suffix(".json"))
        manifest = json.loads(target.with_suffix(".json").read_text())
        manifest.update(filename=target.name, createdAt=created.isoformat(timespec="milliseconds"))
        target.with_suffix(".json").write_text(json.dumps(manifest))
        return target, manifest

    def test_backups_close_all_owned_handles_without_gc_or_sidecar_litter(self):
        handles = []
        connect = sqlite3.connect

        def tracked_connect(*args, **kwargs):
            handle = connect(*args, **kwargs)
            handles.append(handle)
            return handle

        enabled = gc.isenabled()
        gc.disable()
        try:
            with patch.object(persistence.sqlite3, "connect", side_effect=tracked_connect):
                for _ in range(4):
                    result = persistence.create_backup(self.db_path, self.backup_dir, retain=2)
                backup = self.backup_dir / result["filename"]
                persistence.verify_backup(backup)
                persistence.restore_backup(backup, self.root / "restored.sqlite", apply=True)
            for handle in handles:
                with self.assertRaises(sqlite3.ProgrammingError):
                    handle.execute("SELECT 1")
            self.assertEqual(len(list(self.backup_dir.iterdir())), 4)
            self.assertFalse(list(self.backup_dir.glob("*-wal")))
            self.assertFalse(list(self.backup_dir.glob("*-shm")))
            self.assertFalse(list(self.backup_dir.glob("*.tmp")))
            with closing(connect(backup)) as db:
                self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        finally:
            if enabled:
                gc.enable()

    def test_legacy_wal_snapshot_verification_does_not_create_sidecars(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        with closing(sqlite3.connect(backup)) as db:
            db.execute("PRAGMA journal_mode=WAL")
        manifest = json.loads(backup.with_suffix(".json").read_text())
        manifest["sha256"] = persistence.digest(backup)
        backup.with_suffix(".json").write_text(json.dumps(manifest))
        before = {path.name: path.read_bytes() for path in self.backup_dir.iterdir()}
        self.assertTrue(persistence.verify_backup(backup)["ok"])
        self.assertIsNotNone(persistence.recover_latest_backup(self.backup_dir, 3600))
        after = {path.name: path.read_bytes() for path in self.backup_dir.iterdir()}
        self.assertEqual(before, after)

    def test_verification_rejects_pending_wal_without_modifying_it(self):
        result = persistence.create_backup(self.db_path, self.backup_dir)
        backup = self.backup_dir / result["filename"]
        wal = Path(str(backup) + "-wal")
        wal.write_bytes(b"unverified pending writes")
        with self.assertRaisesRegex(ValueError, "backup-not-standalone"):
            persistence.verify_backup(backup)
        self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600))
        self.assertEqual(wal.read_bytes(), b"unverified pending writes")

    def test_recovery_uses_recent_verified_success_and_counts_only_snapshots(self):
        now = datetime.now(timezone.utc)
        self.dated_backup(now - timedelta(minutes=20))
        backup, manifest = self.dated_backup(now - timedelta(minutes=10))
        (self.backup_dir / "orphan.sqlite.tmp-shm").write_bytes(b"existing")
        (self.backup_dir / "research-not-a-date.sqlite").write_bytes(b"unrelated")
        link = self.backup_dir / "research-20260901T010203.000000Z.sqlite"
        link.symlink_to(backup)
        before = {path.name: path.read_bytes() for path in self.backup_dir.iterdir()}
        self.assertEqual(persistence.recover_latest_backup(self.backup_dir, 3600, now=now), {
            "createdAt": manifest["createdAt"], "backupCount": 2,
        })
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.backup_dir.iterdir()})

    def test_recovery_falls_back_from_corrupt_latest_to_recent_valid_snapshot(self):
        now = datetime.now(timezone.utc)
        _, valid = self.dated_backup(now - timedelta(minutes=20))
        backup, _ = self.dated_backup(now - timedelta(minutes=10))
        with backup.open("r+b") as handle:
            handle.write(b"corrupt!")
        result = persistence.recover_latest_backup(self.backup_dir, 3600, now=now)
        self.assertEqual(result["createdAt"], valid["createdAt"])
        self.assertEqual(result["backupCount"], 2)

    def test_recovery_does_not_defer_backup_for_stale_future_or_unmanifested_files(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        for age in (3600, 7200, -60):
            with self.subTest(age=age), tempfile.TemporaryDirectory() as directory:
                self.backup_dir = Path(directory)
                backup, _ = self.dated_backup(now - timedelta(seconds=age))
                self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
                backup.with_suffix(".json").unlink()
                self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        self.assertIsNone(persistence.recover_latest_backup(self.root / "absent", 3600))

    def test_recovery_rejects_invalid_manifests_and_symlinks(self):
        now = datetime.now(timezone.utc)
        backup, manifest = self.dated_backup(now - timedelta(minutes=10))
        manifest_path = backup.with_suffix(".json")
        changes = [
            {"createdAt": "invalid"}, {"createdAt": "2026-10-03T01:00:00"},
            {"createdAt": (now + timedelta(hours=1)).isoformat()},
            {"createdAt": (now - timedelta(hours=1)).isoformat()},
            {"filename": "../intake.sqlite"}, {"bytes": True}, {"bytes": 1},
            {"sha256": "z" * 64}, {"schemaVersion": True}, {"schemaVersion": 2},
            {"integrity": "failed"},
        ]
        for change in changes:
            with self.subTest(change=change):
                manifest_path.write_text(json.dumps({**manifest, **change}))
                self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        for raw in ("[]", "{", "[" * 1500 + "0" + "]" * 1500,
                    " " * (persistence.MAX_MANIFEST_BYTES + 1)):
            manifest_path.write_text(raw)
            self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        target = self.root / "foreign.json"
        target.write_text(json.dumps(manifest))
        manifest_path.unlink()
        manifest_path.symlink_to(target)
        self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        linked_dir = self.root / "linked-backups"
        linked_dir.symlink_to(self.backup_dir, target_is_directory=True)
        self.assertIsNone(persistence.recover_latest_backup(linked_dir, 3600, now=now))

    def test_recovery_is_bounded_and_scan_errors_fail_closed(self):
        now = datetime.now(timezone.utc)
        _, valid = self.dated_backup(now - timedelta(minutes=20))
        backup, _ = self.dated_backup(now - timedelta(minutes=10))
        backup.with_suffix(".json").write_text("{}")
        with patch.object(persistence, "MAX_RECOVERY_CANDIDATES", 1):
            self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        self.assertEqual(persistence.recover_latest_backup(self.backup_dir, 3600, now=now)["createdAt"],
                         valid["createdAt"])
        with patch.object(persistence, "MAX_RECOVERY_DIRECTORY_ENTRIES", 1):
            self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))
        with patch.object(persistence.os, "scandir", side_effect=OSError("unavailable")):
            self.assertIsNone(persistence.recover_latest_backup(self.backup_dir, 3600, now=now))

    def test_full_volume_prunes_to_retain_minus_one_before_copying(self):
        for _ in range(3):
            persistence.create_backup(self.db_path, self.backup_dir, retain=3)
        (self.backup_dir / "research-20260101T000000.000000Z.sqlite.tmp").write_bytes(b"partial")
        full = persistence.shutil.disk_usage(self.backup_dir)._replace(free=0)
        with patch.object(persistence.shutil, "disk_usage", return_value=full):
            result = persistence.create_backup(self.db_path, self.backup_dir, retain=3)
        self.assertEqual(result["backupCount"], 3)
        self.assertEqual(len(list(self.backup_dir.glob("research-*.sqlite"))), 3)
        self.assertEqual(list(self.backup_dir.glob("*.tmp")), [])

    def test_copy_failure_closes_owned_connections_and_does_not_prune(self):
        handles = []
        connect = sqlite3.connect

        class FailedCopy(sqlite3.Connection):
            def backup(self, target):
                raise sqlite3.OperationalError("copy-failed")

        def tracked_connect(*args, **kwargs):
            handle = connect(*args, **kwargs, factory=FailedCopy)
            handles.append(handle)
            return handle

        with patch.object(persistence.sqlite3, "connect", side_effect=tracked_connect), \
                patch.object(persistence, "_prune") as prune:
            with self.assertRaisesRegex(sqlite3.OperationalError, "copy-failed"):
                persistence.create_backup(self.db_path, self.backup_dir)
        prune.assert_not_called()
        for handle in handles:
            with self.assertRaises(sqlite3.ProgrammingError):
                handle.execute("SELECT 1")
        self.assertEqual(list(self.backup_dir.iterdir()), [])

    def test_verification_failure_closes_its_connection(self):
        handles = []
        connect = sqlite3.connect
        with closing(connect(self.root / "incomplete.sqlite")) as db, db:
            db.execute("CREATE TABLE incomplete (id INTEGER)")

        def tracked_connect(*args, **kwargs):
            handle = connect(*args, **kwargs)
            handles.append(handle)
            return handle

        with patch.object(persistence.sqlite3, "connect", side_effect=tracked_connect):
            with self.assertRaisesRegex(ValueError, "backup-schema-incomplete"):
                persistence.validate_database(self.root / "incomplete.sqlite")
        self.assertEqual(len(handles), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            handles[0].execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
