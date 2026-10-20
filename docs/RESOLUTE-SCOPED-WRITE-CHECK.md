# RESOLUTE in-container rollback-only storage check

Prepared 2026-10-20. Run with psql inside the existing Postgres container,
using its existing local authentication. Do not export credentials, change the
Postgres start command, restart the database, enable LOGIN, or run migrations.
No new service receives an administrator connection. No customer-save gate opens.
Use `psql -X -v ON_ERROR_STOP=1 -d resolute`; disconnect on any error so the
transaction rolls back. A local rehearsal does not constitute production success.

The synthetic identity below must be absent in all five tables before execution.
All writes use SET LOCAL ROLE and a single rollback-only transaction. No
entitlement is created, no notification delivery table is written, and no
external protection receipt is claimed. The zero receipt is synthetic and is
rolled back. Gateway durability and isolated restore remain separate gates.

```sql
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '20s';
DO $$ BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'WRONG_DATABASE'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN
  ('resolute_plan_writer','resolute_notification_writer','resolute_protection_writer')
  AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)<>3
 OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN
  ('resolute_plan_writer','resolute_notification_writer','resolute_protection_writer'))
 THEN RAISE EXCEPTION 'STORAGE_NOT_DORMANT'; END IF;
END $$;
LOCK TABLE resolute.plans,resolute.plan_deletions,resolute.notification_settings,
 resolute.notification_suppressions,resolute.protection_outbox IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.plan_deletions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_settings WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_suppressions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.protection_outbox WHERE clerk_user_id='user_storagecheck20261020rollback')
 THEN RAISE EXCEPTION 'PROBE_ID_ALREADY_EXISTS'; END IF;
END $$;
SET LOCAL ROLE resolute_plan_writer;
INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at)
 VALUES('user_storagecheck20261020rollback',1,'{"answersVersion":1,"answers":{},"fx":{}}',statement_timestamp(),statement_timestamp());
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback'
  AND revision=1 AND plan='{"answersVersion":1,"answers":{},"fx":{}}'::jsonb) THEN RAISE EXCEPTION 'PLAN_READBACK_FAILED'; END IF;
END $$;
UPDATE resolute.plans SET revision=2,plan=NULL,created_at=NULL,updated_at=NULL,
 deleted_at=statement_timestamp() WHERE clerk_user_id='user_storagecheck20261020rollback';
INSERT INTO resolute.plan_deletions
 SELECT clerk_user_id,revision,deleted_at FROM resolute.plans
 WHERE clerk_user_id='user_storagecheck20261020rollback';
RESET ROLE;
SET LOCAL ROLE resolute_notification_writer;
INSERT INTO resolute.notification_settings VALUES('user_storagecheck20261020rollback',
 '{"deliveryHourJst":7,"alertsEnabled":false,"morningEnabled":false,"watchItems":[],"surgeCapPct":null}',1,statement_timestamp());
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM resolute.notification_settings
  WHERE clerk_user_id='user_storagecheck20261020rollback' AND revision=1
  AND settings->>'alertsEnabled'='false' AND settings->>'morningEnabled'='false')
 THEN RAISE EXCEPTION 'SETTINGS_READBACK_FAILED'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE resolute_protection_writer;
DO $$ BEGIN
 IF (SELECT array_agg(kind ORDER BY kind) FROM resolute.protection_outbox
  WHERE clerk_user_id='user_storagecheck20261020rollback')
  IS DISTINCT FROM ARRAY['alerts_off','delete','morning_off']::text[]
 THEN RAISE EXCEPTION 'PROTECTION_TRIGGER_FAILED'; END IF;
END $$;
UPDATE resolute.protection_outbox SET receipt_sha256=repeat('0',64),
 published_at=statement_timestamp(),next_attempt_at='infinity'
 WHERE clerk_user_id='user_storagecheck20261020rollback';
DO $$ BEGIN
 IF (SELECT count(*) FROM resolute.protection_outbox
  WHERE clerk_user_id='user_storagecheck20261020rollback'
  AND receipt_sha256=repeat('0',64) AND published_at IS NOT NULL)<>3
 THEN RAISE EXCEPTION 'RECEIPT_COLUMN_READBACK_FAILED'; END IF;
 BEGIN
  PERFORM 1 FROM resolute_payments_live.orders LIMIT 0;
  RAISE EXCEPTION 'RAW_PAYMENT_ACCESS_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM resolute.notification_outbox LIMIT 0;
  RAISE EXCEPTION 'DELIVERY_ACCESS_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE resolute.protection_outbox SET kind='delete' WHERE false;
  RAISE EXCEPTION 'EVENT_MUTATION_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM resolute.protection_outbox WHERE false;
  RAISE EXCEPTION 'EVENT_DELETE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.plan_deletions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_settings WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_suppressions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.protection_outbox WHERE clerk_user_id='user_storagecheck20261020rollback')
 THEN RAISE EXCEPTION 'ROLLBACK_FAILED'; END IF;
END $$;
SELECT 'RESOLUTE_SCOPED_ROLLBACK_OK' AS event,0 AS committed_rows,false AS activation;
```

Follow-up: independently audit the full effective ACL; establish a fresh complete
write-fenced history inventory; exercise actual HTTPS publish/readback/receipt;
restore into an isolated database and assert deletion/both stops and replay
idempotence. Do not interpret this rollback check as persistent customer saving.

## Execution status — 2026-10-20 16:08 JST

Local PGlite rehearsal of the exact SQL above passed twice, returning
RESOLUTE_SCOPED_ROLLBACK_OK / committed_rows0 / activation=false both times.
A third run with a storage role set LOGIN was correctly rejected as
STORAGE_NOT_DORMANT. Initial synthetic plan payload was corrected to satisfy the
existing plans_answers_fx_v1 constraint before these passing runs. This is SQL
mechanism evidence, not production access or authenticated application saving.

Existing resolute-db-provision inspectionc4ce3332-9348-400f-a45a-fd3814b63292
actually logged at07:03:41Z: configured=false, neutralized=true,
usableForResolute=false, networkCalls0, writes0. The old setup DB credential
is absent; no admin credential was installed or copied. Its current code only
reports these booleans and performs no network/database operation.

Railway CLI5.71.0 was installed in /tmp/resolute-railway-cli. The owner completed
the one-click device authorization at approximately16:08 JST. The subsequent
login-process poll was rejected by the execution environment:
Network access to https://backboard.railway.com:443 was blocked by policy.
This is not evidence of bad credentials, and the CLI login completion/SSH
connection has not been verified. Do not request another login or code just to
retry this policy block. Do not tunnel or reroute around the denied endpoint.
The connected Railway app remains available for its supported operations, but
currently exposes no SQL/SSH/remote-exec operation.

Production execution remains pending on an allowed in-container command path.
No source data, customer-save flags, writer logins, schedule, payment, email or AI
setting changed. The owner authorization to perform the scoped rollback-only
check persists; the blocker is execution access, not missing approval.
