"""Read-only, bounded R2 listing. Presence is never restoration or freshness proof."""
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from urllib.parse import urlsplit

PREFIXES = {
    'source': 'tech-phase/source/v1/',
    'dependencies': 'tech-phase/dependencies/v1/',
    'runtime': 'tech-phase/runtime/v1/',
    'research_database': 'tech-phase/research/v1/dumps/',
    'resolute_database': 'resolute/v1/external/',
    'billing_sandbox_database': 'tech-phase/sandbox/v1/external/',
    'protection_history': 'resolute/protection/external-v1/',
}
MAX_OBJECTS = 10000
MAX_PAGES = 20


def configuration(env):
    if env.get('TECH_PHASE_EXTERNAL_INVENTORY_ENABLED') != 'true':
        raise ValueError('inventory disabled')
    config = {name: env.get('MIRROR_DESTINATION_' + name, '') for name in
              ('ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')}
    url = urlsplit(config['ENDPOINT'])
    if (not all(config.values()) or url.scheme != 'https' or
            not re.fullmatch(r'[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com', url.hostname or '') or
            url.username or url.password or url.port not in (None, 443) or
            url.path not in ('', '/') or url.query or url.fragment or
            config['BUCKET'] != 'resolute-backup-external' or config['REGION'] != 'auto'):
        raise ValueError('explicit existing R2 destination required')
    return config


def inventory(client, bucket):
    found = {}
    for scope, prefix in PREFIXES.items():
        token, seen_tokens = None, set()
        for _ in range(MAX_PAGES):
            args = {'Bucket': bucket, 'Prefix': prefix, 'MaxKeys': 1000}
            if token is not None:
                args['ContinuationToken'] = token
            page = client.list_objects_v2(**args)
            if not isinstance(page, dict) or type(page.get('IsTruncated')) is not bool:
                raise ValueError('invalid listing')
            items = page.get('Contents', [])
            if not isinstance(items, list) or len(items) > 1000:
                raise ValueError('invalid listing entries')
            for item in items:
                if not isinstance(item, dict):
                    raise ValueError('invalid listing entry')
                key, size, etag, modified = (item.get(k) for k in ('Key', 'Size', 'ETag', 'LastModified'))
                if (not isinstance(key, str) or not key.startswith(prefix) or len(key) > 1024 or key in found or
                        type(size) is not int or size < 0 or not isinstance(etag, str) or not etag or
                        len(etag) > 256 or not isinstance(modified, datetime) or modified.utcoffset() is None):
                    raise ValueError('invalid object metadata')
                found[key] = {'scope': scope, 'bytes': size, 'etag': etag,
                              'modified': modified.astimezone(timezone.utc).isoformat()}
                if len(found) > MAX_OBJECTS:
                    raise ValueError('inventory limit exceeded')
            if not page['IsTruncated']:
                if page.get('NextContinuationToken'):
                    raise ValueError('unexpected continuation')
                break
            token = page.get('NextContinuationToken')
            if not isinstance(token, str) or not token or token in seen_tokens or len(token) > 4096:
                raise ValueError('incomplete listing')
            seen_tokens.add(token)
        else:
            raise ValueError('page limit exceeded')
    return found


def audit(client, bucket):
    before = inventory(client, bucket)
    if inventory(client, bucket) != before:
        raise ValueError('inventory changed during observation')
    scopes = {}
    for scope in PREFIXES:
        items = {k: v for k, v in before.items() if v['scope'] == scope}
        scopes[scope] = {
            'objects': len(items), 'bytes': sum(x['bytes'] for x in items.values()),
            'latest_object_modified_utc': max((x['modified'] for x in items.values()), default=None),
            'presence': 'objects-observed' if items else 'no-objects-in-listed-prefix',
        }
    # Keys/ETags remain in memory; never print identities, endpoint or credentials.
    digest = hashlib.sha256(json.dumps(before, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'event': 'EXTERNAL_INVENTORY_OBSERVED', 'observed_at_utc': datetime.now(timezone.utc).isoformat(),
            'read_only': True, 'listed_prefixes': PREFIXES, 'scopes': scopes,
            'listed_objects': len(before), 'inventory_sha256': digest, 'two_listings_equal': True,
            'whole_bucket_inventory': False, 'writer_fence_verified': False,
            'source_data_freshness_verified': False, 'ciphertext_verified': False,
            'manifest_verified': False, 'restore_verified': False, 'saving_activation_allowed': False}


def main():
    config = configuration(os.environ)
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=config['ENDPOINT'], region_name=config['REGION'],
                          aws_access_key_id=config['ACCESS_KEY_ID'],
                          aws_secret_access_key=config['SECRET_ACCESS_KEY'],
                          config=Config(s3={'addressing_style': 'path'}, connect_timeout=10,
                                        read_timeout=30, retries={'total_max_attempts': 2}))
    print(json.dumps(audit(client, config['BUCKET'])), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'EXTERNAL_INVENTORY_FAILED', 'read_only': True,
                          'inventory_complete': False, 'restore_verified': False}), flush=True)
        raise SystemExit(1)
