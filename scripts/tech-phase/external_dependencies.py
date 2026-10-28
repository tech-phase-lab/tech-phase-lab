"""Encrypted npm dependency custody and isolated downloaded-byte restoration.

Never executes archived files or installs packages. No database, runtime binary,
provider export, deployment, schedule, or new key. Supply a trusted lock hash.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import posixpath
import re
import shutil
import subprocess
import tarfile
import tempfile

from external_research_backup import encrypt, readback
from prepare_offline_dependencies import digest
from upload_source_recovery import configuration, download

MAX_CIPHER = 1024 ** 3
MAX_EXPANDED = 4 * 1024 ** 3
NAMES = {'manifest.json', 'dependencies.tar.gz'}


def context(lock):
    if not isinstance(lock, str) or not re.fullmatch('[a-f0-9]{64}', lock):
        raise ValueError('trusted lock hash required')
    return 'tech-phase/dependencies/v1/' + lock


def safe_path(name):
    if not isinstance(name, str) or '\\' in name or '\x00' in name:
        raise ValueError('invalid dependency path')
    path = PurePosixPath(name)
    if (path.as_posix() != name or path.is_absolute() or '..' in path.parts
            or len(path.parts) < 2 or path.parts[0] != 'node_modules'):
        raise ValueError('dependency path escapes root')
    if any(part in ('.env', '.npmrc', 'id_rsa', 'id_ed25519') or
           part.startswith('.env.') and part not in ('.env.example', '.env.sample', '.env.template')
           for part in path.parts):
        raise ValueError('credential-like filename')
    return path


def restore_package(package, output, expected_lock):
    """Validate fully, then extract manually into private staging; no extractall."""
    context(expected_lock)
    package, output = Path(package), Path(output).absolute()
    if (package.is_symlink() or not package.is_dir()
            or {p.name for p in package.iterdir()} != NAMES
            or any(p.is_symlink() or not p.is_file() for p in package.iterdir())
            or output.exists() or output.is_symlink()):
        raise ValueError('invalid package or existing output')
    manifest = package / 'manifest.json'
    archive = package / 'dependencies.tar.gz'
    if manifest.stat().st_size > 32 * 1024 ** 2 or archive.stat().st_size > MAX_CIPHER:
        raise ValueError('package too large')
    report = json.loads(manifest.read_text())
    runtime = json.loads(subprocess.check_output(['node', '-p',
        'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules})'], text=True))
    if (report.get('version') != 1 or report.get('lock_sha256') != expected_lock
            or report.get('runtime') != runtime or report.get('libc') != list(platform.libc_ver())
            or report.get('archive_bytes') != archive.stat().st_size
            or report.get('archive_sha256') != digest(archive)):
        raise ValueError('lock, platform or archive mismatch')
    entries = report['files']
    if not isinstance(entries, list) or not 0 < len(entries) <= 100000:
        raise ValueError('invalid dependency inventory')
    expected, total = {}, 0
    for entry in entries:
        name = entry['path']
        safe_path(name)
        if name in expected:
            raise ValueError('duplicate inventory path')
        if 'link' in entry:
            link = entry['link']
            if not isinstance(link, str) or not link or posixpath.isabs(link) or '\\' in link or '\x00' in link:
                raise ValueError('invalid link')
            safe_path(posixpath.normpath(posixpath.join(posixpath.dirname(name), link)))
        else:
            if (type(entry.get('size')) is not int or entry['size'] < 0
                    or not re.fullmatch('[a-f0-9]{64}', entry.get('sha256', ''))):
                raise ValueError('invalid file record')
            total += entry['size']
        expected[name] = entry
    if total > MAX_EXPANDED:
        raise ValueError('expanded archive too large')
    for name in expected:
        if any(str(parent) in expected for parent in PurePosixPath(name).parents):
            raise ValueError('file or link used as parent')
    with tempfile.TemporaryDirectory(prefix='dependency-restore-', dir=output.parent) as temp:
        restored = Path(temp) / 'restored'
        restored.mkdir(mode=0o700)
        seen, links = set(), []
        with tarfile.open(archive, 'r:gz') as tar:
            for member in tar:
                if member.name not in expected or member.name in seen:
                    raise ValueError('unexpected archive member')
                seen.add(member.name)
                entry = expected[member.name]
                target = restored / member.name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if 'link' in entry:
                    if not member.issym() or member.linkname != entry['link'] or member.size != 0:
                        raise ValueError('link mismatch')
                    links.append((target, entry['link']))
                else:
                    if not member.isfile() or member.size != entry['size']:
                        raise ValueError('file mismatch')
                    with tar.extractfile(member) as src, target.open('xb') as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
                    target.chmod(0o600 | (member.mode & 0o111))
                    if digest(target) != entry['sha256']:
                        raise ValueError('restored file checksum mismatch')
        if seen != set(expected):
            raise ValueError('incomplete dependency archive')
        for target, link in links:
            target.symlink_to(link)
        for target, _ in links:
            resolved = target.resolve(strict=True)
            if not resolved.is_relative_to(restored / 'node_modules'):
                raise ValueError('resolved link escapes root')
        # Recheck after verification. Output is always private and must be new.
        if output.exists() or output.is_symlink():
            raise ValueError('output appeared during verification')
        restored.rename(output)
    return {'lock_sha256': expected_lock, 'runtime': runtime, 'libc': report['libc'],
            'entries': len(entries), 'dependency_restore_verified': True,
            'includes_node_runtime': False, 'runtime_build_verified': False}


def restore(archive, key, expected_lock, output):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    aad = context(expected_lock)
    archive = Path(archive)
    if (len(key) != 32 or archive.is_symlink() or not archive.is_file()
            or not 28 < archive.stat().st_size <= MAX_CIPHER + 28):
        raise ValueError('invalid encrypted archive')
    with tempfile.TemporaryDirectory(prefix='dependency-decrypt-') as temp:
        plain = Path(temp) / 'payload.tar'
        with archive.open('rb') as src, plain.open('xb') as dst:
            nonce = src.read(12)
            src.seek(-16, 2)
            tag = src.read(16)
            remaining = src.tell() - 28
            src.seek(12)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(aad.encode())
            while remaining:
                chunk = src.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('truncated archive')
                remaining -= len(chunk)
                dst.write(decryptor.update(chunk))
            dst.write(decryptor.finalize())
        # Do not parse unauthenticated plaintext.
        package = Path(temp) / 'package'
        package.mkdir(mode=0o700)
        seen, total = set(), 0
        with tarfile.open(plain, 'r:') as tar:
            for member in tar:
                if member.name not in NAMES or member.name in seen or not member.isfile():
                    raise ValueError('unexpected sealed package member')
                total += member.size
                if member.size < 0 or total > MAX_CIPHER:
                    raise ValueError('sealed package too large')
                seen.add(member.name)
                with tar.extractfile(member) as src, (package / member.name).open('xb') as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
        if seen != NAMES:
            raise ValueError('incomplete sealed package')
        return restore_package(package, output, expected_lock)


def seal(package, output, key, expected_lock):
    package, output = Path(package), Path(output).absolute()
    aad = context(expected_lock)
    if output.exists() or output.is_symlink():
        raise ValueError('existing encrypted output')
    with tempfile.TemporaryDirectory(prefix='dependency-seal-', dir=output.parent) as temp:
        root = Path(temp)
        restore_package(package, root / 'checked', expected_lock)
        shutil.rmtree(root / 'checked')
        plain, cipher = root / 'payload.tar', root / 'dependencies.aesgcm'
        with tarfile.open(plain, 'w', format=tarfile.USTAR_FORMAT) as tar:
            for name in sorted(NAMES):
                tar.add(package / name, arcname=name, recursive=False)
        if plain.stat().st_size > MAX_CIPHER:
            raise ValueError('sealed package too large')
        encrypt(plain, cipher, key, aad)
        os.link(cipher, output)
    return {'sha256': digest(output), 'bytes': output.stat().st_size}


def upload(package, client, bucket, key, expected_lock, output):
    with tempfile.TemporaryDirectory(prefix='dependency-upload-') as temp:
        archive = Path(temp) / 'dependencies.aesgcm'
        sealed = seal(package, archive, key, expected_lock)
        object_key = context(expected_lock) + '/' + sealed['sha256'] + '.aesgcm'
        with archive.open('rb') as body:
            client.put_object(Bucket=bucket, Key=object_key, Body=body, IfNoneMatch='*')
        retrieved = Path(temp) / 'download.aesgcm'
        download(client, bucket, object_key, retrieved, sealed['bytes'], sealed['sha256'])
        recovered = restore(retrieved, key, expected_lock, output)
        report = {**sealed, **recovered, 'key': object_key, 'encrypted': True,
                  'external_storage_verified': True, 'scope': 'npm-dependencies-only',
                  'aad': context(expected_lock), 'format': 'nonce12-aes256gcm-ciphertext-tag16'}
        raw = json.dumps(report, sort_keys=True).encode()
        client.put_object(Bucket=bucket, Key=object_key + '.json', Body=raw, IfNoneMatch='*')
        readback(client, bucket, object_key + '.json', len(raw), hashlib.sha256(raw).hexdigest())
        return {**report, 'event': 'DEPENDENCIES_EXTERNAL_RESTORE_OK'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--package')
    group.add_argument('--archive', help='offline restore of an already downloaded ciphertext')
    parser.add_argument('--expected-lock', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.archive:
        raw = os.environ.get('TECH_PHASE_EXTERNAL_KEY_HEX', '')
        if not re.fullmatch('[a-f0-9]{64}', raw):
            raise ValueError('independently retained encryption key required')
        print(json.dumps(restore(args.archive, bytes.fromhex(raw), args.expected_lock, args.output)), flush=True)
        return
    values, key = configuration(os.environ, scope='dependencies')
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=values['ENDPOINT'], region_name=values['REGION'],
        aws_access_key_id=values['ACCESS_KEY_ID'], aws_secret_access_key=values['SECRET_ACCESS_KEY'],
        config=Config(s3={'addressing_style': 'path'}, connect_timeout=15,
                      read_timeout=120, retries={'max_attempts': 3}))
    print(json.dumps(upload(args.package, client, values['BUCKET'], key,
                            args.expected_lock, args.output)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'DEPENDENCIES_EXTERNAL_FAILED'}), flush=True)
        raise SystemExit(1)
