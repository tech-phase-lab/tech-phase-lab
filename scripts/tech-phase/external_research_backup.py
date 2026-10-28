"""One-shot SQLite snapshot -> encrypted R2 object, with bounded readback.

Run beside the research volume, never against a downloaded main DB file without
its live WAL. No cron changes, deletions, notifications or provider API calls.
"""
from contextlib import closing, contextmanager, nullcontext
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import time

MAX_BYTES = 1024 ** 3
PREFIX = 'tech-phase/research/v1/'
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('research_persistence', ROOT / 'scripts/research/persistence.py')
persistence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(persistence)


class BackupStageError(RuntimeError):
    """A fixed diagnostic code; never expose the underlying exception text."""

    def __init__(self, stage):
        super().__init__('research backup failed')
        self.stage = stage


STAGES = frozenset({'configuration', 'client', 'snapshot', 'encrypt', 'upload',
                    'download', 'restore', 'manifest_upload', 'manifest_readback',
                    'archive_input', 'export_output'})


@contextmanager
def stage(name):
    try:
        yield
    except BackupStageError:
        raise
    except Exception as exc:
        raise BackupStageError(name) from exc


def snapshot(source, destination):
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_file() or destination.exists():
        raise ValueError('invalid snapshot path')
    deadline = time.monotonic() + 120
    def progress(status, remaining, total):
        if time.monotonic() > deadline or total * page_size > MAX_BYTES:
            raise ValueError('snapshot exceeds time or size limit')
    with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)) as src:
        page_size = src.execute('PRAGMA page_size').fetchone()[0]
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst, pages=256, progress=progress, sleep=0.1)
            dst.execute('PRAGMA journal_mode=DELETE')
    destination.chmod(0o600)
    return persistence.validate_database(destination)


def encrypt(source, target, key, object_key):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    if len(key) != 32:
        raise ValueError('invalid encryption key')
    nonce = os.urandom(12)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(object_key.encode())
    with Path(source).open('rb') as plain, Path(target).open('xb') as cipher:
        cipher.write(nonce)
        while chunk := plain.read(1024 * 1024):
            cipher.write(encryptor.update(chunk))
        cipher.write(encryptor.finalize())
        cipher.write(encryptor.tag)
    Path(target).chmod(0o600)


def readback(client, bucket, key, expected_size, expected_hash, destination=None):
    body = client.get_object(Bucket=bucket, Key=key)['Body']
    digest = hashlib.sha256()
    count = 0
    try:
        with (Path(destination).open('xb') if destination is not None else nullcontext()) as output:
            if destination is not None:
                Path(destination).chmod(0o600)
            while chunk := body.read(1024 * 1024):
                count += len(chunk)
                if count > expected_size:
                    raise ValueError('readback too large')
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
    finally:
        body.close()
    if count != expected_size or digest.hexdigest() != expected_hash:
        raise ValueError('readback mismatch')


def backup(source, client, bucket, key):
    if len(key) != 32:
        raise ValueError('invalid encryption key')
    with tempfile.TemporaryDirectory(prefix='research-external-') as directory:
        plain = Path(directory) / 'snapshot.sqlite'
        cipher = Path(directory) / 'snapshot.aesgcm'
        # A single SQLite transaction snapshot contains every table, not only
        # news or the public JSON feed. Never prune existing local backups.
        with stage('snapshot'):
            checked = snapshot(source, plain)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        object_key = PREFIX + 'dumps/' + stamp + '.aesgcm'
        with stage('encrypt'):
            encrypt(plain, cipher, key, object_key)
            digest = persistence.digest(cipher)
            size = cipher.stat().st_size
        with stage('upload'):
            with cipher.open('rb') as body:
                client.put_object(Bucket=bucket, Key=object_key, Body=body, IfNoneMatch='*')
        downloaded = Path(directory) / 'downloaded.aesgcm'
        with stage('download'):
            readback(client, bucket, object_key, size, digest, downloaded)
        manifest = {'version': 1, 'key': object_key, 'bytes': size, 'sha256': digest,
                    'plaintext_sha256': checked['sha256'], 'created_at': stamp,
                    'format': 'nonce12-aes256gcm-ciphertext-tag16',
                    'aad': object_key, 'scope': 'research-sqlite-all-tables',
                    'full_site_recovery_verified': False}
        # Verify the downloaded object, never the pre-upload local archive.
        # Publish the completion manifest only after authenticated isolated restore.
        with stage('restore'):
            verify_restore(downloaded, manifest, key)
        manifest['restore_verified'] = True
        raw = json.dumps(manifest, sort_keys=True).encode()
        with stage('manifest_upload'):
            client.put_object(Bucket=bucket, Key=object_key + '.json', Body=raw, IfNoneMatch='*')
        with stage('manifest_readback'):
            readback(client, bucket, object_key + '.json', len(raw), hashlib.sha256(raw).hexdigest())
        return {'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_OK', 'bytes': size,
                'key': object_key, 'sha256': digest, 'restore_verified': True,
                'full_site_recovery_verified': False}


def configuration(env):
    if env.get('TECH_PHASE_EXTERNAL_BACKUP_ENABLED') != 'true':
        raise ValueError('external backup disabled')
    values = {k: env.get('MIRROR_DESTINATION_' + k, '') for k in
              ('ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')}
    # This job is for the existing external R2 bucket, not an arbitrary S3 host.
    # Validate before creating a client so typos cannot receive signed requests.
    if (not all(values.values()) or not re.fullmatch(
            r'https://[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com(?::443)?/?',
            values['ENDPOINT'])
            or values['BUCKET'] != 'resolute-backup-external'
            or values['REGION'] != 'auto'):
        raise ValueError('explicit existing R2 destination required')
    key = env.get('TECH_PHASE_EXTERNAL_KEY_HEX', '')
    if not re.fullmatch('[a-f0-9]{64}', key):
        raise ValueError('independently retained encryption key required')
    source = env.get('RESEARCH_DB_PATH', '')
    if not source or not Path(source).is_absolute():
        raise ValueError('explicit research DB path required')
    return source, values, bytes.fromhex(key)


def validate_output(output):
    """Export only into an existing private directory, never over a DB/sidecar."""
    output = Path(output)
    parent = output.parent
    if (not output.is_absolute() or parent.resolve() != parent
            or not parent.is_dir() or parent.stat().st_uid != os.geteuid()
            or parent.stat().st_mode & 0o077
            or any(os.path.lexists(str(output) + suffix)
                   for suffix in ('', '-wal', '-shm', '-journal'))):
        raise ValueError('new output in a private directory required')
    return output


def verify_restore(archive, manifest, key, output=None):
    """Verify privately; optionally export a new offline DB, never promote it."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    archive = Path(archive)
    if not isinstance(manifest, dict):
        raise ValueError('invalid recovery manifest')
    object_key = manifest.get('key', '')
    if (not isinstance(object_key, str) or not re.fullmatch(
            re.escape(PREFIX) + r'dumps/\d{8}T\d{12}Z\.aesgcm', object_key)
            or type(manifest.get('version')) is not int or manifest['version'] != 1
            or manifest.get('aad') != object_key
            or manifest.get('format') != 'nonce12-aes256gcm-ciphertext-tag16'
            or manifest.get('scope') != 'research-sqlite-all-tables'
            or not isinstance(manifest.get('plaintext_sha256'), str)
            or not re.fullmatch('[a-f0-9]{64}', manifest['plaintext_sha256'])
            or type(manifest.get('bytes')) is not int or not 28 < manifest['bytes'] <= MAX_BYTES + 28
            or len(key) != 32 or archive.is_symlink()
            or archive.stat().st_size != manifest['bytes']
            or persistence.digest(archive) != manifest.get('sha256')):
        raise ValueError('invalid recovery archive')
    if output is not None:
        with stage('export_output'):
            output = validate_output(output)
    # Keep staging on the output filesystem so publication can use an atomic,
    # non-overwriting hard link only after all authentication/DB checks pass.
    with tempfile.TemporaryDirectory(prefix='research-restore-',
                                     dir=output.parent if output is not None else None) as directory:
        target = Path(directory) / 'snapshot.sqlite'
        with archive.open('rb') as encrypted, target.open('xb') as plain:
            target.chmod(0o600)
            nonce = encrypted.read(12)
            encrypted.seek(-16, 2)
            tag = encrypted.read(16)
            encrypted.seek(12)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(object_key.encode())
            remaining = manifest['bytes'] - 28
            while remaining:
                chunk = encrypted.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError('truncated archive')
                remaining -= len(chunk)
                plain.write(decryptor.update(chunk))
            plain.write(decryptor.finalize())
        checked = persistence.validate_database(target, manifest.get('plaintext_sha256'))
        if output is not None:
            with stage('export_output'):
                validate_output(output)
                with target.open('rb') as handle:
                    os.fsync(handle.fileno())
                # Unlike rename/replace, link fails if the output was created
                # concurrently. Never remove an existing output on failure.
                os.link(target, output)
            return {'event': 'TECH_PHASE_RESEARCH_RESTORE_EXPORT_OK',
                    'bytes': checked['bytes'], 'sha256': checked['sha256'],
                    'output_written': True, 'promotion': False}
        return {'event': 'TECH_PHASE_RESEARCH_ISOLATED_RESTORE_OK',
                'bytes': checked['bytes'], 'promotion': False}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-archive')
    parser.add_argument('--manifest')
    parser.add_argument('--restore-output')
    args = parser.parse_args()
    if args.verify_archive or args.manifest or args.restore_output:
        with stage('archive_input'):
            if not args.verify_archive or not args.manifest:
                raise ValueError('archive and manifest both required')
            with Path(args.manifest).open('rb') as handle:
                raw = handle.read(65537)
            if len(raw) > 65536:
                raise ValueError('manifest too large')
            manifest = json.loads(raw)
            key = bytes.fromhex(os.environ['TECH_PHASE_EXTERNAL_KEY_HEX'])
        with stage('restore'):
            report = verify_restore(args.verify_archive, manifest, key, output=args.restore_output)
        print(json.dumps(report), flush=True)
        return
    with stage('configuration'):
        source, values, key = configuration(os.environ)
    with stage('client'):
        import boto3
        from botocore.config import Config
        client = boto3.client('s3', endpoint_url=values['ENDPOINT'], region_name=values['REGION'],
                              aws_access_key_id=values['ACCESS_KEY_ID'],
                              aws_secret_access_key=values['SECRET_ACCESS_KEY'],
                              config=Config(s3={'addressing_style': 'path'}, connect_timeout=15,
                                            read_timeout=120, retries={'max_attempts': 3}))
    print(json.dumps(backup(source, client, values['BUCKET'], key)), flush=True)


def run():
    try:
        main()
    except Exception as exc:
        code = (exc.stage if isinstance(exc, BackupStageError) and isinstance(exc.stage, str)
                and exc.stage in STAGES else 'internal')
        print(json.dumps({'event': 'TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED',
                          'stage': code}), flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
