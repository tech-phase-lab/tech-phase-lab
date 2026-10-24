-- Apply after 002_plans.sql, explicitly to RESOLUTE only; never on an HTTP request.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
ALTER TABLE resolute.plans DROP CONSTRAINT plans_plan_check;
ALTER TABLE resolute.plans ADD CONSTRAINT plans_answers_fx_v1 CHECK (
 plan IS NULL OR (
  plan ?& ARRAY['answersVersion','answers','fx']
  AND plan->'answersVersion' = '1'::jsonb
  AND jsonb_typeof(plan->'answers') = 'object'
  AND jsonb_typeof(plan->'fx') = 'object'
 )
);
-- The API enforces exact IDs, choices, ranges and shapes. Full answers and fx
-- are within the plan payload, so clearing plan removes them atomically.
COMMIT;
