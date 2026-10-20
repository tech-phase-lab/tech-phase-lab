"""PRO Sandbox encrypted snapshots and disposable restore drills only.

There is deliberately no restore-to-service mode. A snapshot can predate a
refund; promotion requires independent provider reconciliation and approval.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SCHEMA = 'tech_phase_billing_sandbox'
PREFIX = 'tech-phase/sandbox/v1/'
MAX_BYTES = 64 * 1024 * 1024
TABLES = ('adverse_transactions', 'events', 'payments', 'periods',
          'review_holds', 'subscriptions')


def run(args, *, env=None):
    result = subprocess.run(args, env=env, capture_output=True, timeout=600)
    if result.returncode:
        raise RuntimeError('database command failed')
    return result.stdout


def pg_env(env):
    # Do not inherit libpq service files, options, or another application's URL.
    result = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
              'PGCONNECT_TIMEOUT': '15', 'PGSSLMODE': 'require',
              'PGOPTIONS': '-c default_transaction_read_only=on -c statement_timeout=300000',
              'PGHOST': 'postgres.railway.internal', 'PGPORT': '5432',
              'PGDATABASE': SCHEMA, 'PGUSER': SCHEMA + '_backup'}
    password = env.get('TECH_PHASE_BACKUP_DB_PASSWORD', '')
    if not re.fullmatch('[a-f0-9]{64}', password):
        raise RuntimeError('backup reader credential required')
    result['PGPASSWORD'] = password
    return result


def validate_mode(env):
    if (env.get('TECH_PHASE_BACKUP_ENABLED') != 'true'
            or env.get('TECH_PHASE_PAYPAL_ENV') != 'sandbox'
            or env.get('TECH_PHASE_BACKUP_BRANCH') != 'codex/research-preview'):
        raise RuntimeError('Sandbox backup guard failed')
    mode = env.get('TECH_PHASE_BACKUP_MODE')
    if mode not in ('backup', 'restore-check'):
        raise RuntimeError('unsupported backup mode')
    if mode == 'restore-check':
        # No source connection credentials in a restore drill, even unused ones.
        if any(value and (name.startswith('PG') or 'DATABASE_URL' in name
                          or name.endswith('DB_PASSWORD') or 'PAYPAL_CLIENT' in name)
               for name, value in env.items()):
            raise RuntimeError('restore environment contains source credentials')
    return mode


def encryption_key(env):
    value = env.get('TECH_PHASE_BACKUP_KEY_HEX', '')
    if not re.fullmatch('[a-f0-9]{64}', value):
        raise RuntimeError('PRO encryption key required')
    return bytes.fromhex(value)


def stamp_now():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')


def validate_manifest(manifest, now=None):
    if not isinstance(manifest, dict) or set(manifest) != {'version', 'key', 'sha256', 'bytes'}:
        raise RuntimeError('invalid snapshot manifest')
    match = re.fullmatch(re.escape(PREFIX) + r'dumps/(\d{8}T\d{12}Z)\.aesgcm', str(manifest['key']))
    if (type(manifest['version']) is not int or manifest['version'] != 1 or not match
            or not re.fullmatch('[a-f0-9]{64}', str(manifest['sha256']))
            or type(manifest['bytes']) is not int
            or not 29 < manifest['bytes'] <= MAX_BYTES + 28):
        raise RuntimeError('invalid snapshot manifest')
    created = dt.datetime.strptime(match[1], '%Y%m%dT%H%M%S%fZ').replace(tzinfo=dt.timezone.utc)
    age = ((now or dt.datetime.now(dt.timezone.utc)) - created).total_seconds()
    if not -300 <= age <= 48 * 3600:
        raise RuntimeError('snapshot is stale or future dated')
    return manifest


def seal(dump, key, object_key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not dump.startswith(b'PGDMP') or len(dump) > MAX_BYTES:
        raise RuntimeError('invalid or oversized PostgreSQL archive')
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, dump, object_key.encode())


def unseal(cipher, key, manifest):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    validate_manifest(manifest)
    if (len(cipher) != manifest['bytes']
            or hashlib.sha256(cipher).hexdigest() != manifest['sha256']):
        raise RuntimeError('stored snapshot checksum mismatch')
    plain = AESGCM(key).decrypt(cipher[:12], cipher[12:], manifest['key'].encode())
    if not plain.startswith(b'PGDMP') or len(plain) > MAX_BYTES:
        raise RuntimeError('invalid decrypted archive')
    return plain


def read_object(client, bucket, key, limit):
    response = client.get_object(Bucket=bucket, Key=key)
    body = response['Body']
    try:
        if response.get('ContentLength', limit + 1) > limit:
            raise RuntimeError('object too large')
        data = body.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError('object too large')
        return data
    finally:
        body.close()


def retained_keys(keys):
    # Seven distinct days plus four distinct ISO weeks, scoped to this format.
    valid = sorted((k for k in keys if re.fullmatch(
        re.escape(PREFIX) + r'dumps/\d{8}T\d{12}Z\.aesgcm', k)), reverse=True)
    days, weeks, keep = set(), set(), set()
    for key in valid:
        day = Path(key).name[:8]
        week = dt.datetime.strptime(day, '%Y%m%d').date().isocalendar()[:2]
        if (day not in days and len(days) < 7) or (week not in weeks and len(weeks) < 4):
            keep.add(key)
        days.add(day)
        weeks.add(week)
    return keep


def verify_ledger(env):
    def query(sql):
        return run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], env=env).decode().strip()
    tables = json.loads(query("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') "
                             "FROM pg_tables WHERE schemaname='" + SCHEMA + "'"))
    if tables != list(TABLES):
        raise RuntimeError('unexpected PRO schema inventory')
    counts = {table: int(query(f'SELECT count(*) FROM {SCHEMA}.{table}')) for table in TABLES}
    invalid = query(f"""SELECT count(*) FROM {SCHEMA}.payments p
        JOIN {SCHEMA}.subscriptions s ON s.id=p.subscription_id
        LEFT JOIN {SCHEMA}.periods g USING(transaction_id)
        WHERE p.currency<>s.currency OR p.minor<>s.minor
        OR (g.transaction_id IS NOT NULL AND
            (p.paid_at<g.period_start OR p.paid_at>=g.period_end))""")
    if invalid != '0':
        raise RuntimeError('restored payment ledger inconsistent')
    # A two-way comparison detects a view that accidentally resurrects holds,
    # loses eligible periods, or changes a member/expiry after restore.
    mismatch = query(f"""WITH expected AS (
        SELECT s.user_id,p.transaction_id,g.period_start,g.period_end
        FROM {SCHEMA}.periods g JOIN {SCHEMA}.payments p USING(transaction_id)
        JOIN {SCHEMA}.subscriptions s ON s.id=p.subscription_id
        WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.review_holds h WHERE h.subscription_id=s.id)
          AND NOT EXISTS (SELECT 1 FROM {SCHEMA}.adverse_transactions a WHERE a.transaction_id=p.transaction_id)
      ) SELECT count(*) FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM {SCHEMA}.entitlement_periods)
        UNION ALL
        (SELECT * FROM {SCHEMA}.entitlement_periods EXCEPT ALL SELECT * FROM expected)
      ) differences""")
    if mismatch != '0':
        raise RuntimeError('restored entitlement view inconsistent')
    return counts


def restore_check(dump, root):
    # This function constructs every connection field; never accepts a target URL.
    cluster = root / 'cluster'
    cluster.mkdir()
    run(['chown', '-R', 'postgres:postgres', str(root)])
    prefix = ['runuser', '-u', 'postgres', '--']
    run(prefix + ['initdb', '-D', str(cluster), '-A', 'trust', '--no-locale', '--encoding=UTF8'])
    run(prefix + ['pg_ctl', '-D', str(cluster), '-l', str(root / 'pg.log'),
                  '-o', "-c listen_addresses='' -k " + str(root), '-w', 'start'])
    try:
        env = {'PATH': os.environ['PATH'], 'PGHOST': str(root), 'PGPORT': '5432',
               'PGUSER': 'postgres', 'PGDATABASE': 'tech_phase_restore_check',
               'PGSSLMODE': 'disable', 'PGCONNECT_TIMEOUT': '15'}
        run(['createdb', 'tech_phase_restore_check'], env=env)
        run(['pg_restore', '--exit-on-error', '--single-transaction', '--no-owner',
             '--no-acl', '-d', 'tech_phase_restore_check', str(dump)], env=env)
        return verify_ledger(env)
    finally:
        run(prefix + ['pg_ctl', '-D', str(cluster), '-m', 'immediate', '-w', 'stop'])


class NoMonitorRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def monitor_ping(url, phase):
    """Send no payload, credentials or exception text; never follow redirects."""
    if not url:
        return 'disabled'
    if (phase not in ('start', 'success', 'fail') or not re.fullmatch(
            r'https://hc-ping\.com/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', url)):
        return 'failed'
    suffix = '' if phase == 'success' else '/' + phase
    try:
        request = Request(url + suffix, data=b'', method='POST')
        with build_opener(NoMonitorRedirects()).open(request, timeout=5) as response:
            return 'sent' if response.status == 200 else 'failed'
    except Exception:
        return 'failed'


def run_job(env=None, job=None):
    env = os.environ if env is None else env
    job = main if job is None else job
    # A rejected environment must not mark an unrelated check healthy.
    try:
        validate_mode(env)
    except Exception:
        print(json.dumps({'event': 'TECH_PHASE_BACKUP_JOB_FAILED'}), flush=True)
        return 1
    url = env.get('TECH_PHASE_BACKUP_MONITOR_PING_URL', '')
    started = monitor_ping(url, 'start')
    try:
        job()
    except Exception:
        finished = monitor_ping(url, 'fail')
        print(json.dumps({'event': 'TECH_PHASE_BACKUP_JOB_FAILED',
                          'monitor_start': started, 'monitor_finish': finished}), flush=True)
        return 1
    finished = monitor_ping(url, 'success')
    print(json.dumps({'event': 'TECH_PHASE_BACKUP_MONITOR',
                      'monitor_start': started, 'monitor_finish': finished}), flush=True)
    # Preserve completed backup work, but surface broken monitoring to Railway.
    return 1 if 'failed' in (started, finished) else 0


def main():
    import boto3
    from botocore.config import Config
    mode = validate_mode(os.environ)
    key = encryption_key(os.environ)
    endpoint = os.environ['TECH_PHASE_BACKUP_ENDPOINT']
    parsed = urlsplit(endpoint)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise RuntimeError('invalid backup endpoint')
    bucket = os.environ['TECH_PHASE_BACKUP_BUCKET']
    client = boto3.client('s3', endpoint_url=endpoint,
        aws_access_key_id=os.environ['TECH_PHASE_BACKUP_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['TECH_PHASE_BACKUP_SECRET_ACCESS_KEY'],
        region_name=os.environ['TECH_PHASE_BACKUP_REGION'],
        config=Config(s3={'addressing_style': 'virtual'}, retries={'max_attempts': 3},
                      connect_timeout=15, read_timeout=120))
    with tempfile.TemporaryDirectory(prefix='tech-phase-') as directory:
        root = Path(directory)
        dump = root / 'snapshot.dump'
        if mode == 'backup':
            source = pg_env(os.environ)
            identity = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c',
                'SELECT current_database() || chr(32) || current_user'], env=source).decode().strip()
            if identity != SCHEMA + ' ' + SCHEMA + '_backup':
                raise RuntimeError('incorrect backup source')
            unsafe = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', f"""
                SELECT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
                    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
                  OR has_schema_privilege(current_user, '{SCHEMA}', 'CREATE')
                  OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='{SCHEMA}' AND c.relkind IN ('r','p')
                      AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
                  OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
                    WHERE r.rolname=current_user))::text"""], env=source).decode().strip()
            if unsafe != 'false':
                raise RuntimeError('backup source role is not read-only')
            run(['pg_dump', '-Fc', '--no-owner', '--no-acl', '--schema=' + SCHEMA,
                 '--lock-wait-timeout=15000', '-f', str(dump)], env=source)
            if dump.stat().st_size > MAX_BYTES:
                raise RuntimeError('backup exceeds size limit')
            run(['pg_restore', '--list', str(dump)])
            object_key = PREFIX + 'dumps/' + stamp_now() + '.aesgcm'
            cipher = seal(dump.read_bytes(), key, object_key)
            manifest = {'version': 1, 'key': object_key, 'bytes': len(cipher),
                        'sha256': hashlib.sha256(cipher).hexdigest()}
            client.put_object(Bucket=bucket, Key=object_key, Body=cipher)
            stored = read_object(client, bucket, object_key, MAX_BYTES + 28)
            if unseal(stored, key, manifest) != dump.read_bytes():
                raise RuntimeError('backup readback differs')
            # Only mark latest after authenticated readback succeeds.
            client.put_object(Bucket=bucket, Key=PREFIX + 'latest.json', Body=json.dumps(manifest).encode())
            objects = []
            for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=PREFIX + 'dumps/'):
                objects.extend(item['Key'] for item in page.get('Contents', []))
            keep = retained_keys(objects)
            for object_key in objects:
                if object_key not in keep and re.fullmatch(re.escape(PREFIX) + r'dumps/\d{8}T\d{12}Z\.aesgcm', object_key):
                    client.delete_object(Bucket=bucket, Key=object_key)
            report = {'event': 'TECH_PHASE_BACKUP_OK', 'bytes': len(cipher), 'retained': len(keep)}
        else:
            manifest = validate_manifest(json.loads(read_object(client, bucket, PREFIX + 'latest.json', 2048)))
            dump.write_bytes(unseal(read_object(client, bucket, manifest['key'], MAX_BYTES + 28), key, manifest))
            counts = restore_check(dump, root)
            report = {'event': 'TECH_PHASE_RESTORE_CHECK_OK', 'rows': counts,
                      'checks': ['authenticated_decryption', 'pg_restore', 'ledger', 'entitlement_view'],
                      'promotion': False}
        print(json.dumps(report), flush=True)


if __name__ == '__main__':
    raise SystemExit(run_job())
