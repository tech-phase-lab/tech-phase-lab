"""Dedicated RESOLUTE dump / isolated restore. Never log credentials or data."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

PREFIX = 'resolute/v1/'
PROBE = "SELECT jsonb_agg(t ORDER BY id)::text FROM resolute_backup_probe.sample t"
SQL = """CREATE SCHEMA IF NOT EXISTS resolute_backup_probe;
CREATE TABLE IF NOT EXISTS resolute_backup_probe.sample
(id integer PRIMARY KEY, payload jsonb NOT NULL);
INSERT INTO resolute_backup_probe.sample VALUES
(1,'{"text":"復元確認 RESOLUTE","value":9800,"optional":null}'),
(2,'{"text":"restore test","value":3980,"optional":true}')
ON CONFLICT (id) DO NOTHING;"""

def heartbeat(suffix=''):
    url = os.environ.get('BACKUP_MONITOR_PING_URL', '')
    if not url:
        return False
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname != 'hc-ping.com':
        raise RuntimeError('invalid monitoring endpoint')
    try:
        with urlopen(Request(url.rstrip('/') + suffix, data=b'', method='POST'), timeout=15):
            return True
    except Exception:
        print(json.dumps({'event':'RESOLUTE_MONITOR_PING_FAILED'}), flush=True)
        return False

def run(args, *, env=None, data=None):
    result = subprocess.run(args, input=data, env=env, capture_output=True, timeout=600)
    if result.returncode:
        # stderr may contain URLs, credentials, or table data. Do not log it.
        raise RuntimeError('command failed: ' + Path(args[0]).name)
    return result.stdout

def psql_env():
    e = os.environ.copy()
    if e.get('PGDATABASE') != 'resolute' or e.get('PGHOST') != 'postgres.railway.internal':
        raise RuntimeError('source is not the dedicated RESOLUTE database')
    e['PGSSLMODE'] = 'require'
    e['PGCONNECT_TIMEOUT'] = '15'
    return e

def retained_keys(objects):
    """Keep newest seven successful dumps and latest in each of four ISO weeks."""
    ordered = sorted(objects, key=lambda x: x['Key'], reverse=True)
    keep = set()
    days = set()
    for item in ordered:
        day = Path(item['Key']).name[:8]
        if day not in days and len(days) < 7:
            days.add(day)
            keep.add(item['Key'])
    weeks = set()
    for x in ordered:
        date = dt.datetime.strptime(Path(x['Key']).name[:8], '%Y%m%d').date()
        week = date.isocalendar()[:2]
        if week in weeks:
            continue
        if len(weeks) == 4:
            break
        weeks.add(week)
        keep.add(x['Key'])
    return keep

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    import boto3
    from botocore.config import Config
    started = time.monotonic()
    mode = os.environ['RESOLUTE_BACKUP_MODE']
    if mode not in ('bootstrap', 'backup', 'restore'):
        raise RuntimeError('invalid mode')
    bucket = os.environ['BACKUP_BUCKET']
    s3 = boto3.client('s3', endpoint_url=os.environ['BACKUP_ENDPOINT'],
                     aws_access_key_id=os.environ['BACKUP_ACCESS_KEY_ID'],
                     aws_secret_access_key=os.environ['BACKUP_SECRET_ACCESS_KEY'],
                     region_name=os.environ['BACKUP_REGION'],
                     config=Config(s3={'addressing_style': 'virtual'}, retries={'max_attempts': 3},
                                   connect_timeout=15, read_timeout=120))
    with tempfile.TemporaryDirectory(prefix='resolute-') as temp:
        root = Path(temp)
        dump = root / 'backup.dump'
        encrypted = root / 'backup.dump.age'
        if mode in ('bootstrap', 'backup'):
            e = psql_env()
            if mode == 'bootstrap':
                run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], env=e, data=SQL.encode())
            probe = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', PROBE], env=e).decode().strip()
            run(['pg_dump', '-Fc', '--no-owner', '--no-acl', '-f', str(dump)], env=e)
            run(['pg_restore', '--list', str(dump)])
            run(['age', '-r', os.environ['BACKUP_AGE_RECIPIENT'], '-o', str(encrypted), str(dump)])
            # Avoid silently outgrowing the approved $3/month budget.
            if encrypted.stat().st_size > 1024 ** 3:
                raise RuntimeError('backup exceeds 1 GiB planning limit; review budget')
            stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            key = PREFIX + 'dumps/' + stamp + '.dump.age'
            manifest = {'key': key, 'dump_sha256': sha(dump), 'cipher_sha256': sha(encrypted),
                        'bytes': encrypted.stat().st_size, 'probe': probe,
                        'postgres_major': 18, 'created_at': stamp}
            s3.upload_file(str(encrypted), bucket, key)
            downloaded = root / 'readback.age'
            s3.download_file(bucket, key, str(downloaded))
            if sha(downloaded) != manifest['cipher_sha256']:
                raise RuntimeError('stored backup checksum mismatch')
            s3.put_object(Bucket=bucket, Key=key + '.json', Body=json.dumps(manifest).encode())
            s3.put_object(Bucket=bucket, Key=PREFIX + 'latest.json', Body=json.dumps(manifest).encode())
            objects = []
            for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=PREFIX+'dumps/'):
                objects.extend(x for x in page.get('Contents', []) if x['Key'].endswith('.dump.age'))
            keep = retained_keys(objects)
            for item in objects:
                if item['Key'] not in keep:
                    s3.delete_object(Bucket=bucket, Key=item['Key'])
                    s3.delete_object(Bucket=bucket, Key=item['Key'] + '.json')
            report = {'event': 'RESOLUTE_BACKUP_OK', 'bytes': manifest['bytes'],
                      'dump_bytes': dump.stat().st_size, 'retained': len(keep)}
        else:
            # Production credentials must never be present in a restore container.
            if any(os.environ.get(k) for k in ('PGHOST', 'PGPASSWORD', 'DATABASE_URL', 'ENTITLEMENT_DB_URL')):
                raise RuntimeError('restore environment contains production connection variables')
            manifest = json.loads(s3.get_object(Bucket=bucket, Key=PREFIX+'latest.json')['Body'].read())
            if not manifest['key'].startswith(PREFIX+'dumps/'):
                raise RuntimeError('invalid backup key')
            s3.download_file(bucket, manifest['key'], str(encrypted))
            if sha(encrypted) != manifest['cipher_sha256']:
                raise RuntimeError('stored backup checksum mismatch')
            identity = root / 'identity.txt'
            identity.write_text(os.environ['BACKUP_AGE_IDENTITY']); identity.chmod(0o600)
            run(['age', '-d', '-i', str(identity), '-o', str(dump), str(encrypted)])
            if sha(dump) != manifest['dump_sha256']:
                raise RuntimeError('decrypted dump checksum mismatch')
            # A new independent cluster with Unix-socket-only access, no persistent volume.
            cluster = root / 'cluster'; cluster.mkdir()
            run(['chown', '-R', 'postgres:postgres', str(root)])
            run(['runuser', '-u', 'postgres', '--', 'initdb', '-D', str(cluster), '-A', 'trust', '--no-locale', '--encoding=UTF8'])
            run(['runuser', '-u', 'postgres', '--', 'pg_ctl', '-D', str(cluster), '-l', str(root/'pg.log'),
                 '-o', "-c listen_addresses='' -k " + str(root), '-w', 'start'])
            try:
                e = os.environ.copy()
                for k in list(e):
                    if k.startswith('PG'): del e[k]
                e.update(PGHOST=str(root), PGUSER='postgres', PGDATABASE='resolute_restore_test', PGSSLMODE='disable')
                run(['createdb', 'resolute_restore_test'], env=e)
                run(['pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-d', 'resolute_restore_test', str(dump)], env=e)
                restored = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', PROBE], env=e).decode().strip()
                if restored != manifest['probe']:
                    raise RuntimeError('restored probe differs from backed-up data')
                count = int(run(['psql', '-XAt', '-c', 'SELECT count(*) FROM resolute_backup_probe.sample'], env=e))
                if count != 2: raise RuntimeError('probe row count differs')
                report = {'event': 'RESOLUTE_RESTORE_OK', 'bytes': manifest['bytes'],
                          'probe_rows': count, 'checks': ['download','decrypt','checksums','pg_restore','probe_content','primary_key']}
                # Verify restored PK rejects duplicate ID, not just column presence.
                try:
                    run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
                         "INSERT INTO resolute_backup_probe.sample VALUES (1, '{}')"], env=e)
                except RuntimeError:
                    pass
                else:
                    raise RuntimeError('restored primary key not enforced')
            finally:
                run(['runuser', '-u', 'postgres', '--', 'pg_ctl', '-D', str(cluster), '-m', 'immediate', '-w', 'stop'])
        report['seconds'] = round(time.monotonic()-started, 3)
        report['monitor_ping_sent'] = heartbeat()
        print(json.dumps(report), flush=True)

if __name__ == '__main__':
    try:
        heartbeat('/start')
        main()
    except Exception as exc:
        heartbeat('/fail')
        # No exception details: third-party errors can embed secret material.
        print(json.dumps({'event':'RESOLUTE_JOB_FAILED','error_type':type(exc).__name__}), flush=True)
        raise SystemExit(1)
