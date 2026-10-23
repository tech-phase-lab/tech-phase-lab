"""Package installed npm dependencies only, with hashes and platform constraints.

Private local staging, not encrypted/offsite storage. Never includes env files,
application data, npm credentials, install scripts execution or live API access.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(repo, output):
    repo, output = Path(repo).resolve(), Path(output).absolute()
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(repo):
        raise ValueError('new output outside repository required')
    modules = repo / 'node_modules'
    if modules.is_symlink() or not modules.is_dir():
        raise ValueError('installed dependency directory required')
    locked = json.loads((repo / 'package-lock.json').read_text())['packages']
    installed = json.loads((modules / '.package-lock.json').read_text())['packages']
    for name, value in installed.items():
        if name not in locked or value.get('version') != locked[name].get('version'):
            raise ValueError('installed package differs from lockfile')
    runtime = json.loads(subprocess.check_output(
        ['node', '-p', 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules})'], text=True))
    files = []
    for path in sorted(modules.rglob('*')):
        relative = path.relative_to(repo).as_posix()
        if path.name in ('.env', '.npmrc', 'id_rsa', 'id_ed25519') or path.name.startswith('.env.') and path.name not in ('.env.example', '.env.sample', '.env.template'):
            raise ValueError('credential-like filename found; inspect privately')
        if path.is_symlink():
            if os.path.isabs(os.readlink(path)) or not path.resolve().is_relative_to(modules) or not path.resolve().exists():
                raise ValueError('dependency symlink leaves package or is broken')
            files.append({'path': relative, 'link': os.readlink(path)})
        elif path.is_file():
            files.append({'path': relative, 'size': path.stat().st_size, 'sha256': digest(path)})
        elif not path.is_dir():
            raise ValueError('unsupported dependency entry')
    output.mkdir(parents=True, mode=0o700)
    archive = output / 'dependencies.tar.gz'
    with tarfile.open(archive, 'w:gz', dereference=False, compresslevel=1) as tar:
        # Explicit reviewed entries; never follows a directory symlink.
        for entry in files:
            tar.inodes.clear()  # Store hard-linked regular files independently.
            tar.add(repo / entry['path'], arcname=entry['path'], recursive=False)
    archive.chmod(0o600)
    expected = {entry['path']: entry for entry in files}
    seen = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            if member.name in seen or member.name not in expected:
                raise ValueError('unexpected archive member')
            seen.add(member.name)
            entry = expected[member.name]
            if 'link' in entry:
                if not member.issym() or member.linkname != entry['link']:
                    raise ValueError('archive link mismatch')
            else:
                if not member.isfile() or member.size != entry['size']:
                    raise ValueError('archive file mismatch')
                with tar.extractfile(member) as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                        raise ValueError('archive checksum mismatch')
    if seen != set(expected):
        raise ValueError('incomplete archive')
    report = {'version': 1, 'runtime': runtime, 'libc': platform.libc_ver(),
              'lock_sha256': digest(repo / 'package-lock.json'),
              'archive_sha256': digest(archive), 'archive_bytes': archive.stat().st_size,
              'files': files, 'encrypted': False, 'offsite_verified': False,
              'includes_node_runtime': False, 'fresh_install_verified': False}
    manifest = output / 'manifest.json'
    manifest.write_text(json.dumps(report, indent=2) + '\n')
    manifest.chmod(0o600)
    return {k: v for k, v in report.items() if k != 'files'} | {'entries': len(files)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.repo, args.output)))
