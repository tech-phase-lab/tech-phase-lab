import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('offline_dependencies', Path(__file__).resolve().parents[1] / 'scripts/tech-phase/prepare_offline_dependencies.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OfflineDependencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.package = self.repo / 'node_modules/pkg'
        self.package.mkdir(parents=True)
        lock = {'packages': {'node_modules/pkg': {'version': '1.0.0'}}}
        for path in [self.repo / 'package-lock.json', self.repo / 'node_modules/.package-lock.json']:
            path.write_text(json.dumps(lock))
        (self.package / 'a.js').write_text('export default 1;')

    def test_hardlinked_files_and_internal_symlinks_survive_full_readback(self):
        os.link(self.package / 'a.js', self.package / 'b.js')
        (self.package / 'alias.js').symlink_to('a.js')
        report = module.prepare(self.repo, self.root / 'output')
        self.assertEqual(report['entries'], 4)
        self.assertFalse(report['offsite_verified'])
        self.assertEqual((self.root / 'output/dependencies.tar.gz').stat().st_mode & 0o777, 0o600)

    def test_credentials_and_external_links_are_rejected_before_archive_creation(self):
        for name in ['.env', '.env.production', '.npmrc']:
            with self.subTest(name=name):
                path = self.package / name
                path.write_text('synthetic')
                with self.assertRaises(ValueError):
                    module.prepare(self.repo, self.root / 'output')
                self.assertFalse((self.root / 'output').exists())
                path.unlink()
        (self.package / 'escape').symlink_to(self.root)
        with self.assertRaises(ValueError):
            module.prepare(self.repo, self.root / 'output')
        self.assertFalse((self.root / 'output').exists())

    def test_lock_mismatch_and_existing_output_never_overwrite(self):
        (self.repo / 'package-lock.json').write_text(json.dumps({'packages': {}}))
        with self.assertRaises(ValueError):
            module.prepare(self.repo, self.root / 'output')
        target = self.root / 'retained'
        target.mkdir()
        (target / 'keep').write_text('unchanged')
        with self.assertRaises(ValueError):
            module.prepare(self.repo, target)
        self.assertEqual((target / 'keep').read_text(), 'unchanged')
