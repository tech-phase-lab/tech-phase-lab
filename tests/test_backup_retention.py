import errno
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import persistence
import service

def snapshot_names(directory): return sorted(p.name for p in Path(directory).glob('research-*.sqlite') if persistence.BACKUP_NAME.fullmatch(p.name))

class Retention(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.db=Path(self.tmp.name)/'automatic.sqlite'; self.dir=Path(self.tmp.name)/'backups'
        with monitor.connect(self.db): pass
        for _ in range(15):
            persistence.create_backup(self.db,self.dir,retain=24); time.sleep(0.002)
        self.size=next(self.dir.glob('research-*.sqlite')).stat().st_size
    def volume(self,snapshots):
        """A volume that holds `snapshots` generations under the 45% budget. The live database is left out of the sum (the tests pass no database path):
        its size is about one snapshot and its WAL moves, which made the count off by one under load."""
        total=int((snapshots*self.size+self.size//2)/persistence.VOLUME_BUDGET)
        usage=persistence.shutil.disk_usage(self.dir)._replace(total=total)
        return mock.patch.object(persistence.shutil,'disk_usage',return_value=usage)
    def test_the_nov_13_state_is_cleaned_to_what_the_volume_holds_and_nothing_else_is_touched(self):
        before=snapshot_names(self.dir); self.assertEqual(len(before),15)             # 15 snapshots, each with a manifest
        for i in range(1000): (self.dir/f'research-20260101T0000{i%60:02d}.{i:06d}Z.json.tmp').write_text('')   # what a full disk left behind
        (self.dir/'research-20250101T000000.000000Z.sqlite').write_bytes(b'x'*50)           # a snapshot whose manifest never got written
        (self.dir/'research-20250102T000000.000000Z.json').write_text('{}')                  # a manifest without its snapshot
        (self.dir/'research-notes.sqlite').write_text('kept: not our name'); (self.dir/'README.txt').write_text('kept')
        with self.volume(4):
            result=persistence.enforce_retention(self.dir,24)
        self.assertEqual(snapshot_names(self.dir)[-4:],before[-4:])                           # the newest four are kept...
        self.assertEqual(len([n for n in snapshot_names(self.dir) if n.startswith('research-2')]),4)
        self.assertTrue((self.dir/'research-notes.sqlite').exists())                           # ...and the file that is not ours
        self.assertEqual(len(list(self.dir.glob('*.tmp'))),0)
        for name in before[-4:]: self.assertTrue((self.dir/name).with_suffix('.json').exists())
        self.assertFalse((self.dir/'research-20250101T000000.000000Z.sqlite').exists())
        self.assertFalse((self.dir/'research-20250102T000000.000000Z.json').exists())
        self.assertTrue((self.dir/'README.txt').exists() and self.db.exists())                 # the database and unknown files are never touched
        persistence.verify_backup(self.dir/before[-1])                                         # the newest backup still verifies
        self.assertGreater(result['freedBytes'],0); self.assertEqual(result['kept'],4)
    def test_never_fewer_than_two_and_never_more_than_asked(self):
        with self.volume(0): persistence.enforce_retention(self.dir,24)
        self.assertEqual(len(snapshot_names(self.dir)),persistence.MIN_KEPT)
        with self.volume(500): persistence.enforce_retention(self.dir,5)             # a big volume: the count (5) rules... but only 2 are left
        self.assertEqual(len(snapshot_names(self.dir)),2)
    def test_nothing_is_deleted_when_no_kept_generation_verifies(self):
        names=snapshot_names(self.dir)
        for name in names[-4:]: (self.dir/name).write_bytes(b'd'*self.size)                   # same size, wrong content: the manifest alone cannot tell
        (self.dir/'research-20260101T000000.000001Z.sqlite.tmp').write_text('x')
        with self.volume(4): result=persistence.enforce_retention(self.dir,24)
        self.assertEqual(snapshot_names(self.dir),names)                                        # no snapshot removed on a guess (the 11 older ones are not deleted either)
        self.assertFalse((self.dir/'research-20260101T000000.000001Z.sqlite.tmp').exists())    # only the temporary went
    def test_without_any_valid_snapshot_even_an_unlabelled_one_stays(self):
        for path in self.dir.glob('research-*.json'): path.unlink()                           # every manifest gone
        names=snapshot_names(self.dir)
        with self.volume(1): persistence.enforce_retention(self.dir,24)
        self.assertEqual(snapshot_names(self.dir),names)
    def test_sqlite_sidecars_of_interrupted_copies_are_leftovers_too(self):
        # Nov 13, second look: ~1,000 files remained after the first cleanup, one per 30-second restart, with names the cleanup did not know
        for i in range(200):
            stamp=f'research-20261101T000000.{i:06d}Z'
            for suffix in ('.sqlite.tmp-journal','.sqlite.tmp-wal','.sqlite.tmp-shm','.sqlite-journal','.sqlite.tmp'):
                (self.dir/(stamp+suffix)).write_text('partial')
        (self.dir/'research-notes.sqlite-journal').write_text('not ours')                        # no timestamp: never touched
        before=snapshot_names(self.dir)
        with self.volume(500): result=persistence.enforce_retention(self.dir,24)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir() if 'T000000' in p.name),[])
        self.assertTrue((self.dir/'research-notes.sqlite-journal').exists())
        self.assertEqual([n for n in snapshot_names(self.dir) if n.startswith('research-2026111')],[n for n in before if n.startswith('research-2026111')][-15:])   # all 15 real snapshots stay
        self.assertGreaterEqual(result['deleted'],1000)
        for name in before[-2:]: persistence.verify_backup(self.dir/name)
    def test_the_health_report_names_the_shapes_of_the_files_without_names(self):
        (self.dir/'research-20261101T000000.000001Z.sqlite.tmp-journal').write_text('x')
        (self.dir/'weird name \u3042.bin').write_text('x')
        report=service.backup_disk(self.dir,self.db)
        self.assertEqual(report['backupKinds']['research-STAMP.sqlite'],15)
        self.assertEqual(report['backupKinds']['research-STAMP.sqlite.tmp-journal'],1)
        self.assertTrue(all(isinstance(k,str) and len(k)<=60 for k in report['backupKinds']))
        self.assertEqual(report['backupKinds']['other.bin'],1)                                      # a name that is not ours shows only its extension
        self.assertNotIn('weird',' '.join(report['backupKinds']))
    def test_a_full_disk_leaves_no_manifest_temporary(self):
        target=self.dir/'research-20260102T000000.000000Z.json'
        with mock.patch.object(Path,'write_text',side_effect=OSError(errno.ENOSPC,'no space')):
            with self.assertRaises(OSError): persistence._write_manifest(target,{'a':1})
        self.assertEqual(list(self.dir.glob('*.tmp')),[])
    def test_the_monitor_cleans_up_before_it_starts(self):
        app=service.AutomaticMonitor(self.db,Path(self.tmp.name)/'snapshot.json')
        app.backup_dir=self.dir; app.backup_retention=24; app.db_path=Path(self.tmp.name)/'no-live-db-in-this-test.sqlite'
        for i in range(50): (self.dir/f'research-20260101T000000.{i:06d}Z.json.tmp').write_text('')
        with self.volume(3), mock.patch('builtins.print') as logged: app.enforce_backup_retention()
        self.assertEqual(len(snapshot_names(self.dir)),3); self.assertEqual(list(self.dir.glob('*.tmp')),[])
        [(line,),_]=logged.call_args; self.assertRegex(line,r'^backup-retention deleted=\d+ kept=3 freedBytes=\d+$')
        self.assertTrue(self.db.exists())

if __name__=='__main__': unittest.main()
