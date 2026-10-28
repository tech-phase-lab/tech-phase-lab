"""One-shot creation of the Live SELECT-only backup login. No table changes."""
import base64
import hashlib
import hmac
import os
from pathlib import Path
import re
import subprocess
import tempfile


def scram(password):
    salt = os.urandom(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    client = hmac.digest(salted, b'Client Key', 'sha256')
    server = hmac.digest(salted, b'Server Key', 'sha256')
    encode = lambda value: base64.b64encode(value).decode()
    return 'SCRAM-SHA-256$4096:' + encode(salt) + '$' + encode(hashlib.sha256(client).digest()) + ':' + encode(server)


def main():
    env = os.environ
    password = env.get('TECH_PHASE_LIVE_BACKUP_DB_PASSWORD', '')
    if (env.get('TECH_PHASE_LIVE_BACKUP_PROVISION') != 'true'
            or env.get('RAILWAY_GIT_BRANCH') != 'codex/research-preview'
            or not re.fullmatch('[a-f0-9]{64}', password)):
        raise RuntimeError('guard')
    verifier = scram(password)
    with tempfile.TemporaryDirectory() as directory:
        ca = Path(directory) / 'ca.crt'
        ca.write_text(env['TECH_PHASE_LIVE_BACKUP_DB_CA'])
        source = {'PATH': env['PATH'], 'PGHOST': 'postgres.railway.internal',
                  'PGPORT': '5432', 'PGDATABASE': 'tech_phase_billing_live',
                  'PGUSER': 'postgres', 'PGPASSWORD': env['TECH_PHASE_LIVE_BACKUP_ADMIN_PASSWORD'],
                  'PGSSLMODE': 'verify-full', 'PGSSLROOTCERT': str(ca),
                  'PGCONNECT_TIMEOUT': '10', 'PGOPTIONS': '-c statement_timeout=30000'}
        sql = """
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database() <> 'tech_phase_billing_live' THEN RAISE EXCEPTION 'wrong DB'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tech_phase_billing_live_backup') THEN
   RAISE EXCEPTION 'role exists; inspect without rotating';
 END IF;
END $$;
CREATE ROLE tech_phase_billing_live_backup LOGIN PASSWORD 'VERIFIER'
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT CONNECT ON DATABASE tech_phase_billing_live TO tech_phase_billing_live_backup;
GRANT USAGE ON SCHEMA tech_phase_billing_live TO tech_phase_billing_live_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA tech_phase_billing_live TO tech_phase_billing_live_backup;
DO $$ DECLARE owner_name text; BEGIN
 FOR owner_name IN SELECT DISTINCT pg_get_userbyid(relowner) FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tech_phase_billing_live'
 LOOP EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA tech_phase_billing_live GRANT SELECT ON TABLES TO tech_phase_billing_live_backup',owner_name); END LOOP;
END $$;
COMMIT;
""".replace('VERIFIER', verifier)
        result = subprocess.run(['psql', '-Xq', '-v', 'ON_ERROR_STOP=1'],
                                input=sql.encode(), env=source, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError('provision failed')
    print('TECH_PHASE_LIVE_BACKUP_READER_READY', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('TECH_PHASE_LIVE_BACKUP_READER_FAILED', flush=True)
        raise SystemExit(1)
