"""Copy a freshly sealed, write-fenced protection inventory without decryption.

The operator must fence all writers and drain queues BEFORE sealing the source
manifest. A boolean acknowledgement is not technical proof of that fence.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


events = load('protection_events')
mirror = load('mirror_backup')


def copy_protection(source, source_bucket, destination, destination_bucket, pin, *, writers_fenced=False):
    if writers_fenced is not True or not isinstance(pin, str) or not re.fullmatch('[a-f0-9]{64}', pin):
        raise ValueError('fresh manifest and external writer fence required')
    before = events.inventory(source, source_bucket)
    manifest_key = events.MANIFEST_PREFIX + pin + '.json'
    raw = mirror.read_bounded(source, source_bucket, manifest_key, 32 * 1024 * 1024)
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError('manifest checksum mismatch')
    manifest = json.loads(raw)
    if (not isinstance(manifest, dict) or set(manifest) != {'version', 'objects'}
            or type(manifest['version']) is not int or manifest['version'] != 1
            or not isinstance(manifest['objects'], list) or len(manifest['objects']) > events.MAX_OBJECTS):
        raise ValueError('invalid protection manifest')
    expected = {}
    for item in manifest['objects']:
        if (not isinstance(item, dict) or set(item) != {'key', 'sha256'}
                or not isinstance(item['key'], str)
                or not re.fullmatch(re.escape(events.PREFIX) + '[a-f0-9]{64}\\.bin', item['key'])
                or item['key'] in expected or not isinstance(item['sha256'], str)
                or not re.fullmatch('[a-f0-9]{64}', item['sha256'])):
            raise ValueError('invalid protection manifest entry')
        expected[item['key']] = item['sha256']
    if set(expected) != set(before):
        raise ValueError('stale or incomplete protection manifest')
    prefix = 'resolute/protection/external-v1/' + pin + '/'
    for key, digest in expected.items():
        body = mirror.read_bounded(source, source_bucket, key, 2048)
        if len(body) != before[key]['size'] or not body.startswith(b'RPE1') or hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('protection ciphertext mismatch')
        destination.put_object(Bucket=destination_bucket, Key=prefix + key, Body=body)
        if mirror.read_bounded(destination, destination_bucket, prefix + key, 2048) != body:
            raise ValueError('protection readback mismatch')
    if events.inventory(source, source_bucket) != before:
        raise ValueError('inventory changed while copying')
    # Publish the pinned source manifest only after every ciphertext readback.
    destination.put_object(Bucket=destination_bucket, Key=prefix + manifest_key, Body=raw)
    if mirror.read_bounded(destination, destination_bucket, prefix + manifest_key, 32 * 1024 * 1024) != raw:
        raise ValueError('manifest readback mismatch')
    return {'event': 'RESOLUTE_PROTECTION_EXTERNAL_COPY_OK', 'objects': len(expected),
            'manifest_sha256': pin, 'restore_verified': False,
            'writer_fence_independently_verified': False}


if __name__ == '__main__':
    try:
        source, destination = mirror.configuration(os.environ)
        report = copy_protection(mirror.client(source), source['BUCKET'],
                                 mirror.client(destination), destination['BUCKET'],
                                 os.environ.get('MIRROR_PROTECTION_MANIFEST_SHA256'),
                                 writers_fenced=os.environ.get('MIRROR_PROTECTION_WRITERS_FENCED') == 'true')
        print(json.dumps(report), flush=True)
    except Exception:
        print(json.dumps({'event': 'RESOLUTE_PROTECTION_EXTERNAL_COPY_FAILED'}), flush=True)
        raise SystemExit(1)
