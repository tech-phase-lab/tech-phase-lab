"""Committed V4 launcher (scripts/resolute/dist) and the start command that fetches it."""
import ast
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'scripts' / 'resolute' / 'dist' / 'protected-launcher-v4.py'
BUILDER = ROOT / 'scripts' / 'resolute' / 'build-protected-launcher.py'
MODULE_COMMIT = 'a638c88fd06e25ec5b043cf3346e0c2a02a8d947'
MODULES_SHA256 = '4656f8ba2d584965d15be6f22501796f435875a0a18231f1f9c6dc603c365ff6'
DIST_SHA256 = 'c5bec004131fcd0e0941fc51ba286ff535852c16271a970fa65eabce5b408dc9'


def load_builder():
    spec = importlib.util.spec_from_file_location('build_protected_launcher_dist', BUILDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def constants(text):
    return {node.targets[0].id: node.value.value for node in ast.parse(text).body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in ('COMMIT', 'EXPECTED_MODE', 'MODULES_SHA256', 'PAYLOAD')}


class DistLauncherCase(unittest.TestCase):
    def setUp(self):
        self.builder = load_builder()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dist = DIST.read_bytes()
        self.values = constants(self.dist.decode('utf-8'))

    def test_pinned_digests(self):
        self.assertEqual(hashlib.sha256(self.dist).hexdigest(), DIST_SHA256)
        self.assertEqual(self.values['COMMIT'], MODULE_COMMIT)
        self.assertEqual(self.values['EXPECTED_MODE'], 'restore')
        self.assertEqual(self.values['MODULES_SHA256'], MODULES_SHA256)
        self.assertEqual(hashlib.sha256(self.values['PAYLOAD'].encode('ascii')).hexdigest(), MODULES_SHA256)

    def test_builder_reproduces_committed_file_byte_for_byte(self):
        # Works on a shallow clone: the modules come from the committed payload itself.
        source = Path(self.tmp.name) / 'src'
        source.mkdir()
        for name, text in json.loads(self.values['PAYLOAD']).items():
            (source / name).write_text(text, encoding='utf-8')
        out = Path(self.tmp.name) / 'out'
        report = self.builder.build(MODULE_COMMIT, 'restore', out, source=source)
        self.assertEqual((out / 'launcher.py').read_bytes(), self.dist)
        self.assertEqual(report['launcher_sha256'], DIST_SHA256)

    def test_payload_matches_module_commit_when_history_is_available(self):
        probe = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', MODULE_COMMIT + '^{commit}'],
                               capture_output=True)
        if probe.returncode:
            self.skipTest('module commit not in this clone')
        out = Path(self.tmp.name) / 'git'
        self.builder.build(MODULE_COMMIT, 'restore', out)
        self.assertEqual((out / 'launcher.py').read_bytes(), self.dist)


FAKE_APT = '#!/bin/sh\necho "$@" >> "$APT_LOG"\nexit "${APT_EXIT:-0}"\n'


class Handler(http.server.BaseHTTPRequestHandler):
    files = {}

    def do_GET(self):
        body = self.files.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class FetchStartCommandCase(unittest.TestCase):
    def setUp(self):
        self.builder = load_builder()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        bin_dir = self.base / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'apt-get').write_text(FAKE_APT)
        (bin_dir / 'apt-get').chmod(0o755)
        self.path = f"{bin_dir}:{os.environ['PATH']}"
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.commit = 'b' * 40
        self.route = f'/repo/{self.commit}/scripts/resolute/dist/protected-launcher-v4.py'
        self.launcher = (b'import json, sys\nprint(json.dumps({"event": "FAKE_LAUNCHER", "argv": sys.argv}))\n'
                         b'raise SystemExit(7)\n')
        self.target = self.base / 'job' / 'resolute_backup.py'
        self.target.parent.mkdir()

    def command(self, sha256=None):
        return self.builder.fetch_start_command(
            self.commit, sha256 or hashlib.sha256(self.launcher).hexdigest(),
            base=f'http://127.0.0.1:{self.server.server_port}/repo', target=str(self.target))

    def run_command(self, command, files, apt_exit='0'):
        Handler.files = files
        # Railway runs the start command through a shell-less exec of /bin/bash -c.
        argv = ['/bin/bash', '-c', command[len("/bin/bash -c '"):-1]]
        env = {'PATH': self.path, 'APT_LOG': str(self.base / 'apt.log'), 'APT_EXIT': apt_exit}
        return subprocess.run(argv, env=env, capture_output=True, text=True, timeout=60)

    def test_matching_launcher_is_installed_and_run_with_its_exit_code(self):
        result = self.run_command(self.command(), {self.route: self.launcher})
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'event': 'FAKE_LAUNCHER', 'argv': [str(self.target)]})
        self.assertEqual(self.target.read_bytes(), self.launcher)
        apt = (self.base / 'apt.log').read_text().splitlines()
        self.assertEqual(apt, ['update -qq', 'install -y -qq python3 python3-boto3 python3-cryptography '
                               'age ca-certificates'])

    def test_sha256_mismatch_refuses_and_prints_only_the_failure_event(self):
        self.target.write_bytes(b'stale launcher from an earlier run\n')
        result = self.run_command(self.command(), {self.route: self.launcher + b'# tampered\n'})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '{"event":"RESOLUTE_JOB_FAILED","reason":"launcher-fetch"}\n')
        self.assertEqual(result.stderr, '')
        self.assertFalse(self.target.exists())

    def test_download_failure_refuses(self):
        result = self.run_command(self.command(), {})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '{"event":"RESOLUTE_JOB_FAILED","reason":"launcher-fetch"}\n')
        self.assertFalse(self.target.exists())

    def test_apt_failure_stops_before_fetch(self):
        result = self.run_command(self.command(), {self.route: self.launcher}, apt_exit='100')
        self.assertEqual(result.returncode, 100)
        self.assertNotIn('FAKE_LAUNCHER', result.stdout)
        self.assertFalse(self.target.exists())

    def test_production_template(self):
        template = self.builder.fetch_start_command('<COMMIT>', DIST_SHA256)
        self.assertIn('https://raw.githubusercontent.com/tech-phase-lab/tech-phase-lab/<COMMIT>/'
                      'scripts/resolute/dist/protected-launcher-v4.py', template)
        self.assertIn(DIST_SHA256, template)
        self.assertTrue(template.startswith("/bin/bash -c 'set -euo pipefail; f=/tmp/resolute_backup.py;"))
        self.assertTrue(template.endswith("exec timeout 900 python3 $f'"))
        self.assertEqual(template.count("'"), 2)
        self.assertLess(len(template.replace('<COMMIT>', 'c' * 40)), 760)
        doc = (ROOT / 'docs' / 'RESOLUTE-PROTECTION-CHAIN.md').read_text(encoding='utf-8')
        self.assertIn(template, doc)
        self.assertIn(DIST_SHA256, doc)
        for bad in ('abc', 'C' * 40, 'c' * 40 + ';'):
            with self.assertRaises(ValueError):
                self.builder.fetch_start_command(bad, DIST_SHA256)
        with self.assertRaises(ValueError):
            self.builder.fetch_start_command('c' * 40, 'x' * 64)


if __name__ == '__main__':
    unittest.main()
