"""Authenticated custody of freshly built, compressed Docker image archives.

No image execution, Docker operations, production export, database, or new key.
Only ciphertext is uploaded. Docker load and offline probes are separate gates.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from external_research_backup import encrypt, readback
from prepare_offline_dependencies import digest
from upload_source_recovery import configuration, download

MAX_ARCHIVE = 512 * 1024 ** 2
SERVICES = frozenset({'frontend', 'api', 'billing', 'protection', 'research', 'backup', 'recovery'})


def validate_source_context(directory):
    """Review a git-archive-only build context; never read runner credentials."""
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('regular source directory required')
    private_material = re.compile(
        rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64,}'
        rb'|AGE-SECRET-KEY-[A-Z0-9]{50,}')
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise ValueError('links not allowed in source build context')
        name = path.name.lower()
        if (name in ('.git', '.npmrc', '.netrc', 'credentials', 'credentials.json',
                    'application_default_credentials.json', 'id_rsa', 'id_ed25519', '.env') or
                name.startswith('.env.') and name not in ('.env.example', '.env.sample', '.env.template') or
                path.suffix.lower() in ('.pem', '.key', '.p12', '.pfx')):
            raise ValueError('credential-like file in source context')
        if path.is_file():
            tail = b''
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    content = tail + chunk
                    if private_material.search(content):
                        raise ValueError('private key material in source context')
                    tail = content[-512:]
        elif not path.is_dir():
            raise ValueError('special file in source context')
    return {'source_context_checked': True, 'production_settings_exported': False}


def context(commit, service, image_id):
    if (not isinstance(commit, str) or not re.fullmatch('[a-f0-9]{40}', commit)
            or service not in SERVICES or not isinstance(image_id, str)
            or not re.fullmatch('sha256:[a-f0-9]{64}', image_id)):
        raise ValueError('trusted source, service and image identity required')
    return f'tech-phase/runtime/v1/{commit}/{service}/{image_id}'


def checksum(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('trusted checksum required')
    return value


def archive_file(path, limit):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('bounded regular archive required')
    return path


def restore(cipher, key, commit, service, image_id, cipher_sha, archive_sha, output):
    """Authenticate downloaded bytes before publishing a compressed image file."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    aad = context(commit, service, image_id)
    checksum(cipher_sha)
    checksum(archive_sha)
    if len(key) != 32:
        raise ValueError('AES-256 key required')
    cipher = archive_file(cipher, MAX_ARCHIVE + 28)
    output = Path(output).absolute()
    if output.exists() or output.is_symlink() or cipher.stat().st_size <= 28:
        raise ValueError('new output and complete cipher required')
    if digest(cipher) != cipher_sha:
        raise ValueError('cipher checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='runtime-decrypt-', dir=output.parent) as temp:
        plain = Path(temp) / 'image.tar.gz'
        with cipher.open('rb') as src, plain.open('xb') as dst:
            nonce = src.read(12)
            src.seek(-16, 2)
            tag = src.read(16)
            remaining = src.tell() - 28
            src.seek(12)
            decoder = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decoder.authenticate_additional_data(aad.encode())
            while remaining:
                chunk = src.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('truncated cipher')
                remaining -= len(chunk)
                dst.write(decoder.update(chunk))
            dst.write(decoder.finalize())
        plain.chmod(0o600)
        archive_file(plain, MAX_ARCHIVE)
        with plain.open('rb') as stream:
            if stream.read(2) != b'\x1f\x8b':
                raise ValueError('compressed Docker archive required')
        if digest(plain) != archive_sha:
            raise ValueError('restored archive checksum mismatch')
        os.link(plain, output)  # Exclusive publication, never replaces an existing file.
    return {'commit': commit, 'service': service, 'image_id': image_id,
            'archive_sha256': archive_sha, 'archive_bytes': output.stat().st_size,
            'archive_restored': True, 'image_loaded': False, 'runtime_boot_verified': False}


def upload(archive, client, bucket, key, commit, tree, service, image_id, output):
    aad = context(commit, service, image_id)
    if not isinstance(tree, str) or not re.fullmatch('[a-f0-9]{40}', tree):
        raise ValueError('source tree required')
    if len(key) != 32:
        raise ValueError('AES-256 key required')
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('new restore output required')
    archive = archive_file(archive, MAX_ARCHIVE)
    with archive.open('rb') as stream:
        if stream.read(2) != b'\x1f\x8b':
            raise ValueError('compressed Docker archive required')
    archive_sha = digest(archive)
    with tempfile.TemporaryDirectory(prefix='runtime-upload-') as temp:
        cipher, retrieved = Path(temp) / 'image.aesgcm', Path(temp) / 'download.aesgcm'
        encrypt(archive, cipher, key, aad)
        cipher_sha, size = digest(cipher), cipher.stat().st_size
        object_key = f'tech-phase/runtime/v1/{commit}/{service}/{cipher_sha}.aesgcm'
        with cipher.open('rb') as body:
            client.put_object(Bucket=bucket, Key=object_key, Body=body, IfNoneMatch='*')
        download(client, bucket, object_key, retrieved, size, cipher_sha)
        result = restore(retrieved, key, commit, service, image_id, cipher_sha, archive_sha, output)
        report = {**result, 'version': 1, 'tree': tree, 'key': object_key,
                  'sha256': cipher_sha, 'bytes': size, 'aad': aad,
                  'format': 'nonce12-aes256gcm-ciphertext-tag16', 'encrypted': True,
                  'scope': 'freshly-built-runtime-image', 'external_storage_verified': True,
                  'live_database_verified': False, 'deployed_image_export': False}
        raw = json.dumps(report, sort_keys=True).encode()
        client.put_object(Bucket=bucket, Key=object_key + '.json', Body=raw, IfNoneMatch='*')
        readback(client, bucket, object_key + '.json', len(raw), hashlib.sha256(raw).hexdigest())
        return {**report, 'event': 'RUNTIME_EXTERNAL_READBACK_OK'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--image-archive')
    mode.add_argument('--cipher')
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--service', required=True, choices=sorted(SERVICES))
    parser.add_argument('--expected-image-id', required=True)
    parser.add_argument('--source-tree')
    parser.add_argument('--expected-cipher-sha')
    parser.add_argument('--expected-archive-sha')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.cipher:
        raw = os.environ.get('TECH_PHASE_EXTERNAL_KEY_HEX', '')
        if not re.fullmatch('[a-f0-9]{64}', raw):
            raise ValueError('independently retained encryption key required')
        result = restore(args.cipher, bytes.fromhex(raw), args.expected_commit, args.service,
                         args.expected_image_id, args.expected_cipher_sha,
                         args.expected_archive_sha, args.output)
    else:
        values, key = configuration(os.environ, scope='runtime')
        import boto3
        from botocore.config import Config
        client = boto3.client('s3', endpoint_url=values['ENDPOINT'], region_name=values['REGION'],
            aws_access_key_id=values['ACCESS_KEY_ID'], aws_secret_access_key=values['SECRET_ACCESS_KEY'],
            config=Config(s3={'addressing_style': 'path'}, connect_timeout=15,
                          read_timeout=120, retries={'max_attempts': 3}))
        result = upload(args.image_archive, client, values['BUCKET'], key,
                        args.expected_commit, args.source_tree, args.service,
                        args.expected_image_id, args.output)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'RUNTIME_CUSTODY_FAILED', 'runtime_boot_verified': False}), flush=True)
        raise SystemExit(1)
