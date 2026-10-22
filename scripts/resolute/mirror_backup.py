"""Explicit, one-shot encrypted dump copy. No DB access, decryption or deletion.

Copies an immutable dump/manifest pair, NOT latest.json or protection history.
Run only after approving the external destination and its storage cost.
"""
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

PREFIX = 'resolute/v1/'
MAX_BYTES = 1024 ** 3


def read_bounded(client, bucket, key, limit):
    body = client.get_object(Bucket=bucket, Key=key)['Body']
    try:
        data = body.read(limit + 1)
        if len(data) > limit:
            raise ValueError('object exceeds limit')
        return data
    finally:
        body.close()


def copy_backup(source, source_bucket, destination, destination_bucket):
    manifest_bytes = read_bounded(source, source_bucket, PREFIX + 'latest.json', 65536)
    manifest = json.loads(manifest_bytes)
    key = manifest.get('key', '')
    if not re.fullmatch(r'resolute/v1/dumps/\d{8}T\d{12}Z\.dump\.age', key):
        raise ValueError('invalid dump key')
    size = manifest.get('bytes')
    digest = manifest.get('cipher_sha256', '')
    if type(size) is not int or not 0 < size <= MAX_BYTES or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('invalid encrypted dump metadata')
    with tempfile.TemporaryDirectory(prefix='resolute-mirror-') as temp:
        path = Path(temp) / 'encrypted.age'
        body = source.get_object(Bucket=source_bucket, Key=key)['Body']
        actual = hashlib.sha256()
        count = 0
        try:
            with path.open('wb') as output:
                while chunk := body.read(1024 * 1024):
                    count += len(chunk)
                    if count > size:
                        raise ValueError('dump exceeds declared size')
                    actual.update(chunk)
                    output.write(chunk)
        finally:
            body.close()
        if count != size or actual.hexdigest() != digest:
            raise ValueError('source checksum mismatch')
        # The content-addressed namespace cannot replace an earlier valid dump.
        target = PREFIX + 'external/' + digest + '/backup.dump.age'
        with path.open('rb') as encrypted:
            destination.put_object(Bucket=destination_bucket, Key=target, Body=encrypted)
        body = destination.get_object(Bucket=destination_bucket, Key=target)['Body']
        actual = hashlib.sha256()
        count = 0
        try:
            while chunk := body.read(1024 * 1024):
                count += len(chunk)
                if count > size:
                    raise ValueError('readback exceeds declared size')
                actual.update(chunk)
        finally:
            body.close()
        if count != size or actual.hexdigest() != digest:
            raise ValueError('destination checksum mismatch')
        manifest_key = target + '.json'
        destination.put_object(Bucket=destination_bucket, Key=manifest_key, Body=manifest_bytes)
        if read_bounded(destination, destination_bucket, manifest_key, 65536) != manifest_bytes:
            raise ValueError('manifest readback mismatch')
        return {'event': 'RESOLUTE_EXTERNAL_DUMP_COPY_OK', 'bytes': size,
                'cipher_sha256': digest, 'restore_verified': False,
                'protection_history_copied': False}


def configuration(env):
    if env.get('RESOLUTE_EXTERNAL_COPY_ENABLED') != 'true':
        raise ValueError('external copy is not enabled')
    configs = []
    for prefix in ('MIRROR_SOURCE_', 'MIRROR_DESTINATION_'):
        values = {name: env.get(prefix + name, '') for name in
                  ('ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')}
        url = urlsplit(values['ENDPOINT'])
        if (not all(values.values()) or url.scheme != 'https' or not url.hostname
                or url.username or url.password or url.query or url.fragment
                or url.path not in ('', '/')):
            raise ValueError('invalid mirror configuration')
        configs.append(values)
    if urlsplit(configs[0]['ENDPOINT']).hostname == urlsplit(configs[1]['ENDPOINT']).hostname:
        raise ValueError('external destination must use a different endpoint')
    return configs


def main():
    source, destination = configuration(os.environ)
    import boto3
    from botocore.config import Config
    def client(config):
        return boto3.client('s3', endpoint_url=config['ENDPOINT'],
                            region_name=config['REGION'],
                            aws_access_key_id=config['ACCESS_KEY_ID'],
                            aws_secret_access_key=config['SECRET_ACCESS_KEY'],
                            config=Config(s3={'addressing_style': 'path'},
                                          connect_timeout=15, read_timeout=120,
                                          retries={'max_attempts': 3}))
    report = copy_backup(client(source), source['BUCKET'], client(destination), destination['BUCKET'])
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # SDK exceptions can expose endpoints and credential-related details.
        print(json.dumps({'event': 'RESOLUTE_EXTERNAL_DUMP_COPY_FAILED'}), flush=True)
        raise SystemExit(1)
