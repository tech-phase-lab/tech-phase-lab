"""Offline source recovery package. No provider access or credential values.

Copies an explicit committed revision, including tracked assets and history,
into a standalone bundle and verifies it in an empty repository. This is NOT
encrypted or uploaded; keep the output private until external sealing is ready.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

BRANCH = 'refs/heads/codex/research-preview'
ENV_SYMBOL = re.compile(r'''\b(?:process\.env|os\.environ|env)(?:\.get\(\s*['"]|\[\s*['"]|\.)([A-Z][A-Z0-9_]{2,})''')


def git(repo, *args, allow_no_match=False):
    result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                             '-C', str(repo), *args], capture_output=True, timeout=180)
    if result.returncode and not (allow_no_match and result.returncode == 1):
        raise ValueError('source recovery Git command failed')
    return result.stdout


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as file:
        while block := file.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def verify(directory):
    directory = Path(directory)
    with (directory / 'manifest.json').open('rb') as file:
        raw = file.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('manifest too large')
    manifest = json.loads(raw)
    if (not isinstance(manifest, dict) or type(manifest.get('version')) is not int
            or manifest['version'] != 1 or manifest.get('branch') != BRANCH
            or not isinstance(manifest.get('commit'), str)
            or not re.fullmatch('[a-f0-9]{40}', manifest['commit'])
            or not isinstance(manifest.get('tree'), str)
            or not re.fullmatch('[a-f0-9]{40}', manifest['tree'])):
        raise ValueError('invalid source manifest')
    for name, field in (('source.bundle', 'bundle_sha256'), ('configuration-names.json', 'configuration_sha256')):
        path = directory / name
        if path.is_symlink() or not path.is_file() or digest(path) != manifest.get(field):
            raise ValueError('recovery package checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='source-recovery-check-') as temp:
        git(temp, 'init', '--bare', '.')
        git(temp, 'bundle', 'verify', str((directory / 'source.bundle').resolve()))
        git(temp, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags',
            str((directory / 'source.bundle').resolve()), BRANCH + ':' + BRANCH)
        commit = git(temp, 'rev-parse', BRANCH).decode().strip()
        tree = git(temp, 'rev-parse', BRANCH + '^{tree}').decode().strip()
        if commit != manifest['commit'] or tree != manifest['tree']:
            raise ValueError('recovered source tree mismatch')
    return {'event': 'SOURCE_BUNDLE_RESTORE_OK', 'commit': commit, 'tree': tree,
            'runtime_restore_verified': False, 'external_storage_verified': False}


def prepare(repo, output, commit):
    repo, output = Path(repo).resolve(), Path(output).absolute()
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('explicit full commit SHA required')
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(repo):
        raise ValueError('new output outside repository required')
    if git(repo, 'status', '--porcelain'):
        raise ValueError('uncommitted work must be preserved before backup')
    if git(repo, 'rev-parse', 'HEAD').decode().strip() != commit:
        raise ValueError('expected revision differs from checkout')
    tree = git(repo, 'rev-parse', commit + '^{tree}').decode().strip()
    files = []
    for raw in git(repo, 'ls-tree', '-rz', '--full-tree', commit).split(b'\0'):
        if not raw:
            continue
        metadata, path = raw.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('external links or submodules require separate backup')
        files.append({'path': path.decode(), 'mode': mode, 'git_blob': oid})
    pointers = git(repo, 'grep', '-l', '-I', '^version https://git-lfs[.]github[.]com/spec/v1$',
                   commit, '--', allow_no_match=True)
    if pointers:
        raise ValueError('LFS payloads require separate backup')
    # Read tracked source only, never os.environ values or local credential files.
    lines = git(repo, 'grep', '--no-color', '--no-heading', '--no-break', '-n', '-I', '-E', r'process\.env|os\.environ|env\.', commit,
                '--', 'app', 'lib', 'scripts', 'services', allow_no_match=True).decode()
    names = {}
    for line in lines.splitlines():
        _, path, number, content = line.split(':', 3)
        for name in ENV_SYMBOL.findall(content):
            names.setdefault(name, set()).add(path)
    configuration = {'version': 1, 'source_commit': commit, 'contains_secret_values': False,
                     'live_inventory_verified': False, 'dynamic_names_may_be_missing': True,
                     'variables': [{'name': k, 'source_files': sorted(v)} for k, v in sorted(names.items())]}
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix='source-package-', dir=output.parent))
    try:
        config_path = temp / 'configuration-names.json'
        config_path.write_text(json.dumps(configuration, ensure_ascii=False, indent=2) + '\n')
        with tempfile.TemporaryDirectory(prefix='source-bundle-') as bare:
            git(bare, 'init', '--bare', '.')
            git(bare, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', str(repo), commit + ':' + BRANCH)
            git(bare, 'bundle', 'create', str(temp / 'source.bundle'), BRANCH)
        manifest = {'version': 1, 'branch': BRANCH, 'commit': commit, 'tree': tree,
                    'bundle_sha256': digest(temp / 'source.bundle'),
                    'configuration_sha256': digest(config_path), 'files': files,
                    'encrypted': False, 'uploaded': False,
                    'excludes': ['runtime databases', 'provider settings and secrets', 'Clerk users',
                                 'PayPal state', 'external URL assets', 'browser-only data']}
        (temp / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for path in temp.iterdir():
            path.chmod(0o600)
        report = verify(temp)
        if output.exists():
            raise ValueError('output appeared while preparing')
        os.rename(temp, output)
        return {**report, 'files': len(files), 'configuration_names': len(names), 'encrypted': False}
    finally:
        if temp.exists():
            shutil.rmtree(temp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo')
    parser.add_argument('--output')
    parser.add_argument('--commit')
    parser.add_argument('--verify')
    args = parser.parse_args()
    if args.verify:
        if args.repo or args.output or args.commit:
            raise ValueError('verification does not take source arguments')
        report = verify(args.verify)
    else:
        if not all((args.repo, args.output, args.commit)):
            raise ValueError('repo, output and commit required')
        report = prepare(args.repo, args.output, args.commit)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'SOURCE_RECOVERY_PACKAGE_FAILED'}), flush=True)
        raise SystemExit(1)
