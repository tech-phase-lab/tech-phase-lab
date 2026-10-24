"""Read-only recovery drill for an existing, independently pinned R2 object."""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile

from upload_source_recovery import configuration, download
import seal_source_recovery as sealed


def restore(client, bucket, key, commit, digest, size, tree):
    prefix = sealed.context(commit)
    if (not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest)
            or not isinstance(tree, str) or not re.fullmatch('[a-f0-9]{40}', tree)
            or type(size) is not int or not 28 < size <= sealed.MAX_BYTES + 28
            or len(key) != 32):
        raise ValueError('invalid independent recovery pin')
    object_key = prefix + '/' + digest + '.aesgcm'
    with tempfile.TemporaryDirectory(prefix='existing-source-restore-') as temp:
        archive = Path(temp) / 'existing.aesgcm'
        download(client, bucket, object_key, archive, size, digest)
        report = sealed.verify(archive, key, commit)
        if report['tree'] != tree:
            raise ValueError('restored tree differs from independent pin')
        return {'event': 'EXISTING_SOURCE_EXTERNAL_RESTORE_OK', 'key': object_key,
                'bytes': size, 'sha256': digest, 'commit': commit, 'tree': tree,
                'source_restore_verified': True, 'runtime_restore_verified': False,
                'new_upload': False, 'promotion': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--bytes', required=True, type=int)
    parser.add_argument('--tree', required=True)
    args = parser.parse_args()
    values, key = configuration(os.environ, operation='restore')
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=values['ENDPOINT'], region_name=values['REGION'],
                          aws_access_key_id=values['ACCESS_KEY_ID'],
                          aws_secret_access_key=values['SECRET_ACCESS_KEY'],
                          config=Config(s3={'addressing_style': 'path'}, connect_timeout=15,
                                        read_timeout=120, retries={'max_attempts': 3}))
    print(json.dumps(restore(client, values['BUCKET'], key, args.commit,
                             args.sha256, args.bytes, args.tree)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'event': 'EXISTING_SOURCE_EXTERNAL_RESTORE_FAILED'}), flush=True)
        raise SystemExit(1)
