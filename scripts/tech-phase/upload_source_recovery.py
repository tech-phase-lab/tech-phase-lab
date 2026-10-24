"""One-shot encrypted source upload to R2, followed by downloaded-byte restore.

No database/provider exports, schedules, deletion, deployment or key generation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit

import seal_source_recovery as sealed
from external_research_backup import readback


def configuration(env, *, operation='upload', scope='source'):
    if operation not in ('upload', 'restore') or scope not in ('source', 'dependencies', 'runtime'):
        raise ValueError('invalid source operation')
    gate = 'TECH_PHASE_' + scope.upper() + '_' + operation.upper() + '_ENABLED'
    if env.get(gate) != 'true':
        raise ValueError('source operation disabled')
    names = ('ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')
    values = {name: env.get('MIRROR_DESTINATION_' + name, '') for name in names}
    url = urlsplit(values['ENDPOINT'])
    if (not all(values.values()) or url.scheme != 'https'
            or not re.fullmatch(r'[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com', url.hostname or '')
            or url.username or url.password or url.port not in (None, 443)
            or url.path not in ('', '/') or url.query or url.fragment
            or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', values['BUCKET'])):
        raise ValueError('explicit R2 destination required')
    raw = env.get('TECH_PHASE_EXTERNAL_KEY_HEX', '')
    if not re.fullmatch('[a-f0-9]{64}', raw):
        raise ValueError('independently retained encryption key required')
    return values, bytes.fromhex(raw)


def download(client, bucket, object_key, destination, size, digest):
    """Bounded full download; partial or corrupt objects never reach restoration."""
    body = client.get_object(Bucket=bucket, Key=object_key)['Body']
    count, actual = 0, hashlib.sha256()
    try:
        with Path(destination).open('xb') as output:
            while chunk := body.read(1024 * 1024):
                count += len(chunk)
                if count > size:
                    raise ValueError('download exceeds expected size')
                actual.update(chunk)
                output.write(chunk)
    finally:
        body.close()
    if count != size or actual.hexdigest() != digest:
        raise ValueError('download mismatch')


def upload(package, client, bucket, key, expected_commit):
    with tempfile.TemporaryDirectory(prefix='source-upload-') as temp:
        archive = Path(temp) / 'source.aesgcm'
        report = sealed.seal(package, archive, key, expected_commit)
        digest, size = report['sha256'], report['bytes']
        object_key = sealed.context(expected_commit) + '/' + digest + '.aesgcm'
        # Manifest published only after authenticating bytes downloaded from R2.
        # A failed run can leave an orphan cipher; it must never delete old data.
        with archive.open('rb') as body:
            client.put_object(Bucket=bucket, Key=object_key, Body=body, IfNoneMatch='*')
        restored = Path(temp) / 'download.aesgcm'
        download(client, bucket, object_key, restored, size, digest)
        recovered = sealed.verify(restored, key, expected_commit)
        manifest = {'version': 1, 'key': object_key, 'bytes': size, 'sha256': digest,
                    'commit': expected_commit, 'tree': recovered['tree'],
                    'aad': sealed.context(expected_commit),
                    'format': 'nonce12-aes256gcm-ciphertext-tag16',
                    'scope': 'git-source-only', 'runtime_restore_verified': False}
        raw = json.dumps(manifest, sort_keys=True).encode()
        client.put_object(Bucket=bucket, Key=object_key + '.json', Body=raw, IfNoneMatch='*')
        readback(client, bucket, object_key + '.json', len(raw), hashlib.sha256(raw).hexdigest())
        return {'event': 'SOURCE_EXTERNAL_UPLOAD_VERIFIED', 'key': object_key,
                'sha256': digest, 'bytes': size, 'commit': expected_commit,
                'tree': recovered['tree'], 'source_restore_verified': True,
                'external_storage_verified': True, 'runtime_restore_verified': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True)
    parser.add_argument('--expected-commit', required=True)
    args = parser.parse_args()
    values, key = configuration(os.environ)
    sealed.context(args.expected_commit)
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=values['ENDPOINT'], region_name=values['REGION'],
                          aws_access_key_id=values['ACCESS_KEY_ID'],
                          aws_secret_access_key=values['SECRET_ACCESS_KEY'],
                          config=Config(s3={'addressing_style': 'path'}, connect_timeout=15,
                                        read_timeout=120, retries={'max_attempts': 3}))
    print(json.dumps(upload(args.package, client, values['BUCKET'], key, args.expected_commit)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'SOURCE_EXTERNAL_UPLOAD_FAILED'}), flush=True)
        raise SystemExit(1)
