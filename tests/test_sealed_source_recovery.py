import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tech-phase'))
import seal_source_recovery as sealed
import test_source_recovery_package as fixtures


class SealedSourceTests(unittest.TestCase):
    def test_real_git_roundtrip_and_authentication_failures(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo, git, commit = fixtures.SourceRecoveryTests().fixture(root)
            package = root / 'package'
            sealed.source.prepare(repo, package, commit)
            key = os.urandom(32)
            archive = root / 'source.aesgcm'
            report = sealed.seal(package, archive, key, commit)
            self.assertEqual(report['tree'], git('rev-parse', 'HEAD^{tree}'))
            self.assertFalse(report['external_storage_verified'])
            self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
            original = archive.read_bytes()
            with self.assertRaises(Exception):
                sealed.verify(archive, os.urandom(32), commit)
            with self.assertRaises(Exception):
                sealed.verify(archive, key, '0' * 40)
            with self.assertRaises(ValueError):
                sealed.seal(package, archive, key, commit)
            self.assertEqual(archive.read_bytes(), original)
            corrupted = bytearray(original)
            corrupted[20] ^= 1
            archive.write_bytes(corrupted)
            with self.assertRaises(Exception):
                sealed.verify(archive, key, commit)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['package', 'repo', 'source.aesgcm'])

    def test_authenticated_unsafe_archives_are_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('source.bundle', tarfile.SYMTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                plain, cipher = root / 'bad.tar', root / 'bad.aesgcm'
                with tarfile.open(plain, 'w') as tar:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/tmp/escape' if kind == tarfile.SYMTYPE else ''
                    tar.addfile(member, io.BytesIO(b''))
                key = os.urandom(32)
                sealed.encrypt(plain, cipher, key, sealed.context('a' * 40))
                with self.assertRaises(ValueError):
                    sealed.verify(cipher, key, 'a' * 40)

    def test_extra_files_and_wrong_commit_prevent_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo, _, commit = fixtures.SourceRecoveryTests().fixture(root)
            package = root / 'package'
            sealed.source.prepare(repo, package, commit)
            output = root / 'output'
            with self.assertRaises(ValueError):
                sealed.seal(package, output, os.urandom(32), '0' * 40)
            (package / 'secret.env').write_text('not allowed')
            with self.assertRaises(ValueError):
                sealed.seal(package, output, os.urandom(32), commit)
            self.assertFalse(output.exists())
