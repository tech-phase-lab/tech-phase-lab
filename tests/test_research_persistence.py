import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


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
        with monitor.connect(self.db_path) as db:
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
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/second")
        restored = self.root / "restored.sqlite"
        self.assertFalse(persistence.restore_backup(backup, restored)["applied"])
        self.assertFalse(restored.exists())
        Path(str(restored) + "-wal").write_bytes(b"stale")
        Path(str(restored) + "-shm").write_bytes(b"stale")
        self.assertTrue(persistence.restore_backup(backup, restored, apply=True)["applied"])
        self.assertFalse(Path(str(restored) + "-wal").exists())
        self.assertFalse(Path(str(restored) + "-shm").exists())
        with monitor.connect(restored) as db:
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


if __name__ == "__main__":
    unittest.main()
