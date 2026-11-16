"""RESOLUTE protected job launcher: runs one embedded, digest-checked module set.

Template only. scripts/resolute/build-protected-launcher.py fills the four constants
below and the result is stored base64-encoded in RESOLUTE_PROTECTED_JOB_*_B64. The
unbuilt template refuses to run. Never logs environment values or exception text.
"""
import base64
import gzip
import hashlib
import json
import os
import runpy
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

COMMIT = ''
EXPECTED_MODE = ''
MODULES_SHA256 = ''
PAYLOAD = ''

MODULES = ('backup.py', 'protection.py', 'protection_events.py')
MAX_PAYLOAD = 4 * 1024 * 1024


class LauncherError(RuntimeError):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def canonical(mapping):
    return json.dumps(mapping, sort_keys=True, separators=(',', ':')).encode()


def load_modules():
    if not (COMMIT and EXPECTED_MODE and MODULES_SHA256 and PAYLOAD):
        raise LauncherError('launcher-unbuilt')
    if os.environ.get('RESOLUTE_BACKUP_MODE') != EXPECTED_MODE:
        raise LauncherError('launcher-mode')
    try:
        if len(PAYLOAD) > MAX_PAYLOAD:
            raise ValueError('payload too large')
        body = gzip.decompress(base64.b64decode(PAYLOAD, validate=True))
        if hashlib.sha256(body).hexdigest() != MODULES_SHA256:
            raise ValueError('digest mismatch')
        mapping = json.loads(body)
        if not isinstance(mapping, dict) or sorted(mapping) != sorted(MODULES):
            raise ValueError('module set')
        for name in MODULES:
            if not isinstance(mapping[name], str):
                raise ValueError('module type')
            compile(mapping[name], name, 'exec')
        if canonical(mapping) != body:
            raise ValueError('non-canonical payload')
    except Exception:
        raise LauncherError('launcher-bundle') from None
    return mapping


def extract(mapping):
    workdir = tempfile.mkdtemp(prefix='resolute-job-')
    try:
        os.chmod(workdir, 0o700)
        for name in MODULES:
            fd = os.open(os.path.join(workdir, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
                handle.write(mapping[name])
        written = {}
        for name in MODULES:
            with open(os.path.join(workdir, name), encoding='utf-8', newline='') as handle:
                written[name] = handle.read()
        if hashlib.sha256(canonical(written)).hexdigest() != MODULES_SHA256:
            raise LauncherError('launcher-bundle')
    except BaseException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    return workdir


def fail_ping():
    # Same rule as backup.py heartbeat(): https://hc-ping.com only, URL never logged.
    if os.environ.get('RESOLUTE_BACKUP_MODE') == 'protection-export':
        return
    url = os.environ.get('BACKUP_MONITOR_PING_URL', '')
    parsed = urlsplit(url)
    if not url or parsed.scheme != 'https' or parsed.hostname != 'hc-ping.com':
        return
    try:
        with urlopen(Request(url.rstrip('/') + '/fail', data=b'', method='POST'), timeout=15):
            pass
    except Exception:
        print(json.dumps({'event': 'RESOLUTE_MONITOR_PING_FAILED'}), flush=True)


def fail(exc, reason):
    fail_ping()
    print(json.dumps({'event': 'RESOLUTE_JOB_FAILED', 'error_type': type(exc).__name__,
                      'reason': reason}), flush=True)
    raise SystemExit(1)


def main():
    workdir = None
    try:
        try:
            mapping = load_modules()
            workdir = extract(mapping)
        except LauncherError as exc:
            fail(exc, exc.reason)
        except Exception as exc:
            fail(exc, 'launcher-extract')
        print(json.dumps({'event': 'RESOLUTE_PROTECTED_BUNDLE_READY', 'commit': COMMIT,
                          'sha256': MODULES_SHA256, 'modules': len(MODULES),
                          'mode': EXPECTED_MODE}), flush=True)
        script = os.path.join(workdir, 'backup.py')
        saved_argv = sys.argv[:]
        sys.argv = [script]
        try:
            # backup.py's entrypoint sends /start and /fail itself and exits 1 on
            # failure; that SystemExit passes through unchanged.
            runpy.run_path(script, run_name='__main__')
        except Exception as exc:
            # Only reached when backup.py fails before its entrypoint (e.g. import).
            fail(exc, 'launcher-run')
        finally:
            sys.argv = saved_argv
    finally:
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == '__main__':
    main()
