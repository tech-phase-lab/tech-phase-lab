import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('source_recovery', Path(__file__).resolve().parents[1] / 'scripts/tech-phase/prepare_source_recovery.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceRecoveryTests(unittest.TestCase):
    def fixture(self, root):
        repo = root / 'repo'
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL).decode().strip()
        git('init', '-b', 'codex/research-preview')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        (repo / 'app').mkdir()
        (repo / 'public').mkdir()
        (repo / 'public/logo.bin').write_bytes(b'\x00\xffbinary-image')
        (repo / 'app/config.ts').write_text('const x = process.env.EXAMPLE_API_KEY;\nconst y = env.get("BACKUP_BUCKET");\n')
        (repo / '.gitignore').write_text('.env\n')
        git('add', '.')
        git('commit', '-m', 'fixture')
        (repo / '.env').write_text('EXAMPLE_API_KEY=never-include-this-value\n')
        return repo, git, git('rev-parse', 'HEAD')

    def test_bundle_restores_assets_and_config_names_without_local_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, git, commit = self.fixture(root)
            output = root / 'package'
            report = module.prepare(repo, output, commit)
            self.assertEqual(report['files'], 3)
            self.assertEqual(report['configuration_names'], 2)
            self.assertFalse(report['external_storage_verified'])
            self.assertFalse(report['encrypted'])
            config = (output / 'configuration-names.json').read_text()
            self.assertNotIn('never-include-this-value', config)
            self.assertIn('EXAMPLE_API_KEY', config)
            self.assertEqual(module.verify(output)['tree'], git('rev-parse', 'HEAD^{tree}'))
            self.assertEqual(git('status', '--porcelain'), '')
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertIn('public/logo.bin', [f['path'] for f in manifest['files']])
            self.assertNotIn('.env', [f['path'] for f in manifest['files']])

    def test_dirty_checkout_and_wrong_revision_never_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, git, commit = self.fixture(root)
            with self.assertRaises(ValueError):
                module.prepare(repo, root / 'package', 'a' * 40)
            (repo / 'public/logo.bin').write_bytes(b'edited')
            with self.assertRaises(ValueError):
                module.prepare(repo, root / 'package', commit)
            self.assertFalse((root / 'package').exists())

    def test_modified_bundle_and_settings_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, git, commit = self.fixture(root)
            output = root / 'package'
            module.prepare(repo, output, commit)
            original = (output / 'configuration-names.json').read_bytes()
            (output / 'configuration-names.json').write_bytes(b'{}')
            with self.assertRaises(ValueError):
                module.verify(output)
            (output / 'configuration-names.json').write_bytes(original)
            with (output / 'source.bundle').open('ab') as file:
                file.write(b'corruption')
            with self.assertRaises(ValueError):
                module.verify(output)

    def test_lfs_pointer_cannot_count_as_asset_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, git, commit = self.fixture(root)
            (repo / 'public/logo.bin').write_text('version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a' * 64 + '\nsize 32\n')
            git('add', '.')
            git('commit', '-m', 'lfs pointer')
            with self.assertRaises(ValueError):
                module.prepare(repo, root / 'package', git('rev-parse', 'HEAD'))

    def test_symlink_and_existing_destination_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, git, commit = self.fixture(root)
            with self.assertRaises(ValueError):
                module.prepare(repo, repo / 'backup', commit)
            output = root / 'package'
            output.mkdir()
            with self.assertRaises(ValueError):
                module.prepare(repo, output, commit)
            (repo / 'public/external').symlink_to('/outside/asset')
            git('add', '.')
            git('commit', '-m', 'symlink')
            with self.assertRaises(ValueError):
                module.prepare(repo, root / 'other', git('rev-parse', 'HEAD'))
