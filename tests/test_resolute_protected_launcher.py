"""Protected job launcher: fail-closed bundle checks, READY log, run, cleanup."""
import base64
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
BUILDER = ROOT / 'scripts' / 'resolute' / 'build-protected-launcher.py'
TEMPLATE = ROOT / 'scripts' / 'resolute' / 'protected-launcher.py'
COMMIT = 'a' * 40

# The fake backup.py records where it ran, then behaves according to FAKE_BEHAVIOUR.
FAKE_BACKUP = r'''
import json, os, stat, sys
from pathlib import Path
here = Path(__file__).resolve().parent
print(json.dumps({'event': 'FAKE_RAN', 'dir': str(here), 'argv': sys.argv,
                  'dir_mode': stat.S_IMODE(here.stat().st_mode),
                  'file_modes': sorted(stat.S_IMODE(p.stat().st_mode) for p in here.iterdir()),
                  'siblings': sorted(p.name for p in here.iterdir()),
                  'name': __name__, 'mode': os.environ.get('RESOLUTE_BACKUP_MODE')}), flush=True)
behaviour = os.environ.get('FAKE_BEHAVIOUR', 'ok')
if behaviour == 'exit1':
    print(json.dumps({'event': 'RESOLUTE_JOB_FAILED', 'error_type': 'RuntimeError'}), flush=True)
    raise SystemExit(1)
if behaviour == 'crash':
    raise ImportError('module level failure')
'''
FAKE_MODULES = {'backup.py': FAKE_BACKUP, 'protection.py': 'VALUE = 1\n',
                'protection_events.py': 'REASONS = frozenset()\n'}


def load_builder():
    spec = importlib.util.spec_from_file_location('build_protected_launcher', BUILDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def body_of(mapping):
    return json.dumps(mapping, sort_keys=True, separators=(',', ':')).encode()


class LauncherCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.source = self.base / 'src'
        self.source.mkdir()
        for name, text in FAKE_MODULES.items():
            (self.source / name).write_text(text, encoding='utf-8')
        self.jobtmp = self.base / 'jobtmp'
        self.jobtmp.mkdir()
        self.builder = load_builder()
        self.report = self.builder.build(COMMIT, 'restore', self.base / 'out', source=self.source,
                                         variable='RESOLUTE_PROTECTED_JOB_V4_B64')
        self.launcher = (self.base / 'out' / 'launcher.py').read_text(encoding='utf-8')

    def write(self, text, name='launcher.py'):
        path = self.base / name
        path.write_text(text, encoding='utf-8')
        return path

    def replace_constant(self, name, value):
        text, count = re.subn(rf"^{name} = .*$", f'{name} = {value!r}', self.launcher, flags=re.M)
        self.assertEqual(count, 1)
        return text

    def run_launcher(self, path=None, mode='restore', behaviour='ok', extra=None):
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('RESOLUTE_', 'BACKUP_', 'FAKE_'))}
        env.update({'TMPDIR': str(self.jobtmp), 'FAKE_BEHAVIOUR': behaviour})
        if mode is not None:
            env['RESOLUTE_BACKUP_MODE'] = mode
        env.update(extra or {})
        path = path or self.write(self.launcher)
        result = subprocess.run([sys.executable, '-I', str(path)], env=env, capture_output=True,
                                text=True, timeout=60, cwd=self.base)
        events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        return result, events

    def assert_failed_closed(self, result, events, reason):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(events, [{'event': 'RESOLUTE_JOB_FAILED', 'error_type': 'LauncherError',
                                   'reason': reason}])
        self.assertEqual(list(self.jobtmp.iterdir()), [])

    def test_success_logs_ready_then_runs_backup_and_cleans_up(self):
        result, events = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[0], {'event': 'RESOLUTE_PROTECTED_BUNDLE_READY', 'commit': COMMIT,
                                     'sha256': self.report['modules_sha256'], 'modules': 3,
                                     'mode': 'restore'})
        self.assertEqual(self.report['modules_sha256'],
                         hashlib.sha256(body_of(FAKE_MODULES)).hexdigest())
        ran = events[1]
        self.assertEqual(ran['event'], 'FAKE_RAN')
        self.assertEqual(ran['name'], '__main__')
        self.assertEqual(ran['argv'], [str(Path(ran['dir']) / 'backup.py')])
        self.assertEqual(ran['siblings'], sorted(FAKE_MODULES))
        self.assertEqual(ran['dir_mode'], 0o700)
        self.assertEqual(ran['file_modes'], [0o600] * 3)
        self.assertEqual(Path(ran['dir']).parent, self.jobtmp)
        self.assertFalse(Path(ran['dir']).exists())
        self.assertEqual(list(self.jobtmp.iterdir()), [])
        self.assertEqual(len(events), 2)

    def test_backup_failure_exit_code_passes_through_and_cleans_up(self):
        result, events = self.run_launcher(behaviour='exit1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual([e['event'] for e in events],
                         ['RESOLUTE_PROTECTED_BUNDLE_READY', 'FAKE_RAN', 'RESOLUTE_JOB_FAILED'])
        self.assertNotIn('reason', events[-1])  # backup.py's own report, not duplicated
        self.assertEqual(list(self.jobtmp.iterdir()), [])

    def test_module_level_crash_reports_launcher_run_and_cleans_up(self):
        result, events = self.run_launcher(behaviour='crash')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(events[-1], {'event': 'RESOLUTE_JOB_FAILED', 'error_type': 'ImportError',
                                      'reason': 'launcher-run'})
        self.assertNotIn('module level failure', result.stdout + result.stderr)
        self.assertEqual(list(self.jobtmp.iterdir()), [])

    def test_digest_mismatch_fails_closed_without_running(self):
        path = self.write(self.replace_constant('MODULES_SHA256', 'b' * 64))
        self.assert_failed_closed(*self.run_launcher(path), 'launcher-bundle')

    def test_tampered_payload_fails_closed(self):
        tampered = dict(FAKE_MODULES, **{'protection.py': 'VALUE = 2\n'})
        payload = base64.b64encode(gzip.compress(body_of(tampered), mtime=0)).decode()
        path = self.write(self.replace_constant('PAYLOAD', payload))
        self.assert_failed_closed(*self.run_launcher(path), 'launcher-bundle')

    def test_extra_or_missing_module_fails_closed_even_with_matching_digest(self):
        extra = dict(FAKE_MODULES, **{'evil.py': 'X = 1\n'})
        missing = {k: v for k, v in FAKE_MODULES.items() if k != 'protection.py'}
        for index, mapping in enumerate((extra, missing)):
            body = body_of(mapping)
            text = self.replace_constant('PAYLOAD', base64.b64encode(gzip.compress(body, mtime=0)).decode())
            text = re.sub(r"^MODULES_SHA256 = .*$", f"MODULES_SHA256 = {hashlib.sha256(body).hexdigest()!r}",
                          text, flags=re.M)
            path = self.write(text, f'launcher{index}.py')
            self.assert_failed_closed(*self.run_launcher(path), 'launcher-bundle')

    def test_wrong_or_missing_mode_fails_closed(self):
        for mode in ('backup', 'protection-export', '', None):
            self.assert_failed_closed(*self.run_launcher(mode=mode), 'launcher-mode')

    def test_unbuilt_template_refuses_to_run(self):
        self.assert_failed_closed(*self.run_launcher(TEMPLATE), 'launcher-unbuilt')

    def test_launcher_failure_sends_fail_ping_only_to_hc_ping(self):
        spec = importlib.util.spec_from_file_location('launcher_under_test', self.write(self.launcher))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cases = {'https://hc-ping.com/uuid': ['https://hc-ping.com/uuid/fail'],
                 'https://example.com/uuid': [], 'http://hc-ping.com/uuid': [], '': []}
        for url, expected in cases.items():
            sent = []
            env = {'RESOLUTE_BACKUP_MODE': 'backup', 'BACKUP_MONITOR_PING_URL': url}

            class Response:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

            def fake_urlopen(request, timeout):
                sent.append(request.full_url)
                return Response()
            with mock.patch.dict(os.environ, env, clear=True), \
                    mock.patch.object(module, 'urlopen', fake_urlopen), \
                    mock.patch('sys.stdout', new_callable=io.StringIO) as out, \
                    self.assertRaises(SystemExit) as raised:
                module.main()
            self.assertEqual(raised.exception.code, 1)
            self.assertEqual(sent, expected)
            self.assertNotIn('hc-ping', out.getvalue())


class BuilderCase(unittest.TestCase):
    def setUp(self):
        self.builder = load_builder()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'src'
        self.source.mkdir()
        for name, text in FAKE_MODULES.items():
            (self.source / name).write_text(text, encoding='utf-8')

    def test_build_is_deterministic_and_reports_digests(self):
        first = self.builder.build(COMMIT, 'restore', Path(self.tmp.name) / 'a', source=self.source)
        second = self.builder.build(COMMIT, 'restore', Path(self.tmp.name) / 'b', source=self.source)
        self.assertEqual(first, second)
        a = (Path(self.tmp.name) / 'a' / 'launcher.b64').read_bytes()
        self.assertEqual(a, (Path(self.tmp.name) / 'b' / 'launcher.b64').read_bytes())
        self.assertFalse(a.endswith(b'\n'))
        launcher = base64.b64decode(a, validate=True)
        self.assertEqual(hashlib.sha256(launcher).hexdigest(), first['launcher_sha256'])

    def test_start_command_matches_current_form_with_new_variable(self):
        out = Path(self.tmp.name) / 'c'
        self.builder.build(COMMIT, 'restore', out, source=self.source, variable='RESOLUTE_PROTECTED_JOB_V3_B64')
        self.assertEqual((out / 'start-command.txt').read_text(),
                         '/bin/bash -c \'printf "%s" "$RESOLUTE_PROTECTED_JOB_V3_B64" | base64 -d > '
                         '/tmp/resolute_backup.py; timeout 900 /bin/bash -c "apt-get update -qq && '
                         'apt-get install -y -qq python3 python3-boto3 python3-cryptography age '
                         '>/dev/null && python3 /tmp/resolute_backup.py"\'')

    def test_rejects_bad_inputs(self):
        out = Path(self.tmp.name) / 'd'
        for args in (('abc', 'restore'), (COMMIT, 'bootstrap'), ('A' * 40, 'restore')):
            with self.assertRaises(ValueError):
                self.builder.build(*args, out, source=self.source)
        with self.assertRaises(ValueError):
            self.builder.build(COMMIT, 'restore', out, source=self.source, variable='X; rm -rf /')
        (self.source / 'protection.py').write_text('def broken(:\n', encoding='utf-8')
        with self.assertRaises(SyntaxError):
            self.builder.build(COMMIT, 'restore', out, source=self.source)

    def test_template_has_exactly_one_empty_slot_per_constant(self):
        text = TEMPLATE.read_text(encoding='utf-8')
        for name in self.builder.CONSTANTS:
            self.assertEqual(text.count(f"{name} = ''\n"), 1)

    def test_recorded_production_module_digest_reproduces_from_git(self):
        commit = 'fb7c4eda6b9462931e817a6052ffe8eb086a5911'
        probe = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', commit + '^{commit}'],
                               capture_output=True)
        if probe.returncode:
            self.skipTest('fb7c4eda not in this clone')
        report = self.builder.build(commit, 'restore', Path(self.tmp.name) / 'e')
        self.assertEqual(report['modules_sha256'],
                         '8e9cae071117da8b293ea3d6c3c529b29b6ef8a7b57e3cabadecd82330590063')


if __name__ == '__main__':
    unittest.main()
