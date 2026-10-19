-- Explicit operator migration only. Does not activate live entitlement lookup.
BEGIN;
DO $$
DECLARE role_name text;
BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
 -- Existing API identity is required. Missing future writers are prepared without login.
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_api_reader') THEN RAISE EXCEPTION 'API reader is unavailable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_plan_writer') THEN
  CREATE ROLE resolute_plan_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_notification_writer') THEN
  CREATE ROLE resolute_notification_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 FOREACH role_name IN ARRAY ARRAY['resolute_api_reader','resolute_plan_writer','resolute_notification_writer'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND NOT rolsuper AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'Expected scoped entitlement consumer role is unavailable'; END IF;
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA resolute_payments_live TO resolute_api_reader,resolute_plan_writer,resolute_notification_writer;
GRANT SELECT ON resolute_payments_live.entitlement_periods TO resolute_api_reader,resolute_plan_writer,resolute_notification_writer;
COMMIT;
