"""Independent encrypted recovery checkpoint. No online-write durability claim.

A restore pin must come from a write-fenced, complete export, independently of the
DB backup. Never infer completeness/freshness from a timestamp or latest pointer.
"""
import datetime as dt
import hashlib
import json
import re

PREFIX = 'resolute/protection/v1/'  # Outside rotating dump retention.
MAX_BYTES = 16 * 1024 * 1024
PRESENCE_SQL = "SELECT (to_regclass('resolute.plans') IS NOT NULL OR to_regclass('resolute.notification_settings') IS NOT NULL)::text"
EXPORT_SQL = """BEGIN;
-- Explicit maintenance export only: both writers must be unable to reconnect and
-- no other source connection may still have an open/in-flight mutation.
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated database required'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN
   ('resolute_plan_writer','resolute_notification_writer') AND NOT rolcanlogin) <> 2
 OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())
 THEN RAISE EXCEPTION 'Exclusive write-fenced maintenance required'; END IF;
END $$;
LOCK TABLE resolute.plans,resolute.plan_deletions,resolute.notification_settings,
 resolute.notification_suppressions IN SHARE MODE;
SELECT json_build_object('version',1,
 'deletions', COALESCE((SELECT json_agg(json_build_object('userId',clerk_user_id,
 'revision',revision,'at',to_char(deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 ORDER BY clerk_user_id,revision) FROM resolute.plan_deletions),'[]'::json),
 'suppressions', COALESCE((SELECT json_agg(json_build_object('userId',clerk_user_id,
 'revision',revision,'kind',kind,'at',to_char(stopped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 ORDER BY clerk_user_id,revision,kind) FROM resolute.notification_suppressions),'[]'::json))::text;
COMMIT;"""

def validate(value):
    if not isinstance(value, dict) or set(value) != {'version', 'deletions', 'suppressions'} or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('invalid protection checkpoint')
    for group in ('deletions', 'suppressions'):
        if not isinstance(value[group], list):
            raise ValueError('invalid protection checkpoint')
        seen = set()
        for row in value[group]:
            keys = {'userId', 'revision', 'at'} | ({'kind'} if group == 'suppressions' else set())
            if not isinstance(row, dict) or set(row) != keys:
                raise ValueError('invalid protection entry')
            if not isinstance(row['userId'], str) or not re.fullmatch(r'user_[A-Za-z0-9]{1,128}', row['userId']):
                raise ValueError('invalid protection identity')
            if type(row['revision']) is not int or not 0 < row['revision'] < 9007199254740991:
                raise ValueError('invalid protection revision')
            if not isinstance(row['at'], str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', row['at']):
                raise ValueError('invalid protection timestamp')
            dt.datetime.fromisoformat(row['at'].replace('Z', '+00:00'))
            if group == 'suppressions' and row['kind'] not in ('alerts', 'morning'):
                raise ValueError('invalid protection kind')
            key = (row['userId'], row['revision'], row.get('kind'))
            if key in seen:
                raise ValueError('duplicate protection entry')
            seen.add(key)
    return value

def load_json(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError('protection checkpoint too large')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate protection field')
            result[key] = value
        return result
    return validate(json.loads(raw, object_pairs_hook=unique))

def export_checkpoint(s3, bucket, root, run, source_env, recipient):
    """Explicit maintenance operation; caller must fence application writes first.

    SQL is a single MVCC statement; retry by exporting again after a failed upload.
    Returned ciphertext pin is usable only after the caller verifies the write fence.
    No dump latest pointer, retention, runtime activation, or source data is changed.
    """
    raw = run(['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-c', EXPORT_SQL], env=source_env)
    body = json.dumps(load_json(raw), sort_keys=True, separators=(',', ':')).encode()
    plain, encrypted = root / 'protection.json', root / 'protection.age'
    plain.write_bytes(body); plain.chmod(0o600)
    run(['age', '-r', recipient, '-o', str(encrypted), str(plain)])
    cipher = encrypted.read_bytes()
    if len(cipher) > MAX_BYTES:
        raise ValueError('encrypted protection checkpoint too large')
    pin = hashlib.sha256(cipher).hexdigest()
    s3.put_object(Bucket=bucket, Key=PREFIX + pin + '.age', Body=cipher)
    readback = s3.get_object(Bucket=bucket, Key=PREFIX + pin + '.age')['Body'].read(MAX_BYTES + 1)
    if readback != cipher:
        raise RuntimeError('protection readback mismatch')
    return pin

def restore_sql(ledger):
    validate(ledger)
    # Validated identifiers/timestamps contain no SQL escapes. JSON is still quoted
    # explicitly; use stdin, never shell interpolation or command-line member data.
    payload = json.dumps(ledger, separators=(',', ':')).replace("'", "''")
    return """BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute_restore_test' THEN
  RAISE EXCEPTION 'Isolated restore database required'; END IF;
END $$;
CREATE TEMP TABLE protection_input (body jsonb) ON COMMIT DROP;
INSERT INTO protection_input VALUES ('""" + payload + """'::jsonb);
-- A checkpoint older/incomplete relative to even the dump's own journals cannot
-- be accepted. Exact timestamp agreement also rejects conflicting history.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM resolute.plan_deletions d WHERE NOT EXISTS (
  SELECT 1 FROM protection_input,LATERAL jsonb_array_elements(body->'deletions') r
  WHERE r->>'userId'=d.clerk_user_id AND (r->>'revision')::bigint=d.revision
   AND (r->>'at')::timestamptz=date_trunc('milliseconds',d.deleted_at)))
 OR EXISTS (SELECT 1 FROM resolute.notification_suppressions s WHERE NOT EXISTS (
  SELECT 1 FROM protection_input,LATERAL jsonb_array_elements(body->'suppressions') r
  WHERE r->>'userId'=s.clerk_user_id AND (r->>'revision')::bigint=s.revision
   AND r->>'kind'=s.kind AND (r->>'at')::timestamptz=date_trunc('milliseconds',s.stopped_at)))
 THEN RAISE EXCEPTION 'Incomplete or conflicting independent checkpoint'; END IF;
END $$;
-- Recovery must not run the source journaling trigger or duplicate journal keys.
ALTER TABLE resolute.notification_settings DISABLE TRIGGER USER;
INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at,deleted_at)
 SELECT DISTINCT ON (r->>'userId') r->>'userId',(r->>'revision')::bigint,NULL,NULL,NULL,(r->>'at')::timestamptz
 FROM protection_input, LATERAL jsonb_array_elements(body->'deletions') r
 ORDER BY r->>'userId',(r->>'revision')::bigint DESC
 ON CONFLICT(clerk_user_id) DO UPDATE SET revision=EXCLUDED.revision,
 plan=NULL,created_at=NULL,updated_at=NULL,deleted_at=EXCLUDED.deleted_at
 WHERE resolute.plans.revision <= EXCLUDED.revision;
-- Determine both channels against the ORIGINAL restored revision, not a revision
-- already raised by the other channel. Later explicit re-consent is preserved.
CREATE TEMP TABLE protection_stops ON COMMIT DROP AS
 SELECT r->>'userId' AS user_id, max((r->>'revision')::bigint) AS revision,
 max((r->>'at')::timestamptz) AS stopped_at,
 bool_or(r->>'kind'='alerts' AND COALESCE(s.revision,0)<=(r->>'revision')::bigint) AS alerts,
 bool_or(r->>'kind'='morning' AND COALESCE(s.revision,0)<=(r->>'revision')::bigint) AS morning
 FROM protection_input, LATERAL jsonb_array_elements(body->'suppressions') r
 LEFT JOIN resolute.notification_settings s ON s.clerk_user_id=r->>'userId'
 GROUP BY r->>'userId';
INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at)
 SELECT user_id,'{"deliveryHourJst":7,"alertsEnabled":false,"morningEnabled":false,"watchItems":[],"surgeCapPct":null}'::jsonb,
 revision,stopped_at FROM protection_stops
 ON CONFLICT(clerk_user_id) DO NOTHING;
UPDATE resolute.notification_settings s SET
 settings=s.settings || jsonb_build_object(
 'alertsEnabled',CASE WHEN p.alerts THEN false ELSE (s.settings->>'alertsEnabled')::boolean END,
 'morningEnabled',CASE WHEN p.morning THEN false ELSE (s.settings->>'morningEnabled')::boolean END),
 revision=GREATEST(s.revision,p.revision),updated_at=GREATEST(s.updated_at,p.stopped_at)
 FROM protection_stops p WHERE s.clerk_user_id=p.user_id AND (p.alerts OR p.morning);
-- Rebuild journals too so the next export cannot lose pre-restore protections.
INSERT INTO resolute.plan_deletions
 SELECT r->>'userId',(r->>'revision')::bigint,(r->>'at')::timestamptz
 FROM protection_input,LATERAL jsonb_array_elements(body->'deletions') r
 ON CONFLICT(clerk_user_id,revision) DO NOTHING;
INSERT INTO resolute.notification_suppressions
 SELECT r->>'userId',(r->>'revision')::bigint,r->>'kind',(r->>'at')::timestamptz
 FROM protection_input,LATERAL jsonb_array_elements(body->'suppressions') r
 ON CONFLICT(clerk_user_id,revision,kind) DO NOTHING;
-- A restored unsent task is never safe to replay: provider acceptance may have
-- happened after the dump. Clear payloads; future delivery needs reconciliation.
DELETE FROM resolute.notification_outbox WHERE accepted_at IS NULL;
ALTER TABLE resolute.notification_settings ENABLE TRIGGER USER;
COMMIT;"""

def restore_checkpoint(s3, bucket, root, run, env, identity, pin):
    if not isinstance(pin, str) or not re.fullmatch('[0-9a-f]{64}', pin):
        raise RuntimeError('independent write-fenced protection checkpoint required')
    cipher = s3.get_object(Bucket=bucket, Key=PREFIX + pin + '.age')['Body'].read(MAX_BYTES + 1)
    if len(cipher) > MAX_BYTES or hashlib.sha256(cipher).hexdigest() != pin:
        raise RuntimeError('protection checkpoint checksum mismatch')
    encrypted, plain = root / 'restore-protection.age', root / 'restore-protection.json'
    encrypted.write_bytes(cipher)
    run(['age', '-d', '-i', str(identity), '-o', str(plain), str(encrypted)])
    ledger = load_json(plain.read_bytes())
    run(['psql', '-Xq', '-v', 'ON_ERROR_STOP=1'], env=env, data=restore_sql(ledger).encode())
    return {'state': 'verified', 'deletions': len(ledger['deletions']),
            'suppressions': len(ledger['suppressions']), 'pending_outbox': 'cleared'}
