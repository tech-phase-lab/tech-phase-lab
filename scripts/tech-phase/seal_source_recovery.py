"""Offline authenticated source archive. No network, deployment or key creation.

The trusted commit and retained key must come from outside the archive.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile

import prepare_source_recovery as source
from external_research_backup import encrypt

NAMES = {'source.bundle', 'manifest.json', 'configuration-names.json'}
MAX_BYTES = 1024 ** 3


def context(commit):
    if not isinstance(commit, str) or not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('trusted full commit required')
    return 'tech-phase/source/v1/' + commit


def verify(archive, key, expected_commit):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    aad = context(expected_commit)
    archive = Path(archive)
    if (len(key) != 32 or archive.is_symlink() or not archive.is_file()
            or not 28 < archive.stat().st_size <= MAX_BYTES + 28):
        raise ValueError('invalid encrypted source archive')
    with tempfile.TemporaryDirectory(prefix='source-decrypt-') as temp:
        directory = Path(temp)
        plain = directory / 'payload.tar'
        with archive.open('rb') as cipher, plain.open('xb') as target:
            nonce = cipher.read(12)
            cipher.seek(-16, 2)
            tag = cipher.read(16)
            remaining = cipher.tell() - 28
            cipher.seek(12)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(aad.encode())
            while remaining:
                chunk = cipher.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('truncated archive')
                remaining -= len(chunk)
                target.write(decryptor.update(chunk))
            target.write(decryptor.finalize())
        # Authentication completes before parsing any plaintext or invoking Git.
        package = directory / 'package'
        package.mkdir(mode=0o700)
        seen = set()
        total = 0
        with tarfile.open(plain, 'r:') as tar:
            for member in tar:
                if member.name not in NAMES or member.name in seen or not member.isfile():
                    raise ValueError('unexpected archive member')
                total += member.size
                if member.size < 0 or total > MAX_BYTES:
                    raise ValueError('archive too large')
                seen.add(member.name)
                with tar.extractfile(member) as src, (package / member.name).open('xb') as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
        if seen != NAMES:
            raise ValueError('incomplete source package')
        report = source.verify(package)
        if report['commit'] != expected_commit:
            raise ValueError('source commit mismatch')
        return {**report, 'event': 'ENCRYPTED_SOURCE_RESTORE_OK', 'encrypted': True}


def seal(package, output, key, expected_commit):
    aad = context(expected_commit)
    package, output = Path(package), Path(output).absolute()
    if (len(key) != 32 or package.is_symlink() or not package.is_dir()
            or {p.name for p in package.iterdir()} != NAMES
            or any(p.is_symlink() or not p.is_file() for p in package.iterdir())
            or sum(p.stat().st_size for p in package.iterdir()) > MAX_BYTES - 65536
            or output.exists() or output.is_symlink()):
        raise ValueError('invalid source package or output')
    if source.verify(package)['commit'] != expected_commit:
        raise ValueError('source commit mismatch')
    with tempfile.TemporaryDirectory(prefix='source-seal-', dir=output.parent) as temp:
        plain, cipher = Path(temp) / 'payload.tar', Path(temp) / 'source.aesgcm'
        with tarfile.open(plain, 'w', format=tarfile.USTAR_FORMAT) as tar:
            for name in sorted(NAMES):
                tar.add(package / name, arcname=name, recursive=False)
        if plain.stat().st_size > MAX_BYTES:
            raise ValueError('archive too large')
        encrypt(plain, cipher, key, aad)
        report = verify(cipher, key, expected_commit)
        # Exclusive hard link publication: never replace an existing archive.
        os.link(cipher, output)
        return {**report, 'sha256': source.digest(output), 'bytes': output.stat().st_size}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-commit', required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--package')
    group.add_argument('--verify-archive')
    parser.add_argument('--output')
    args = parser.parse_args()
    raw = os.environ.get('TECH_PHASE_EXTERNAL_KEY_HEX', '')
    if not re.fullmatch('[a-f0-9]{64}', raw):
        raise ValueError('independently retained key required')
    key = bytes.fromhex(raw)
    if args.package:
        if not args.output:
            raise ValueError('new output required')
        report = seal(args.package, args.output, key, args.expected_commit)
    else:
        if args.output:
            raise ValueError('verification cannot publish files')
        report = verify(args.verify_archive, key, args.expected_commit)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'ENCRYPTED_SOURCE_RECOVERY_FAILED'}), flush=True)
        raise SystemExit(1)
