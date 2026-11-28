-- Additive, RESOLUTE database only. Apply using the migration owner, never at web startup.
-- Shock Gauge AI cost (Nov 28): each day's per-article AI results (summary or why it was withheld, Japanese headline, ranking), so the
-- 06:30 run after a failed 06:00 run, the 08:20 fallback build and the next days' runs never pay twice for the same article
-- (services/resolute-api/shock-ai-cache.mjs). Keys "summary:<article id>", "title:<article id>", "rank:<article id>"; values
-- {h: content key, d: day, v: result}. Until this is applied the cache lasts one run only. The table's existing grants cover the column.
BEGIN;
ALTER TABLE resolute.shock_candidates ADD COLUMN IF NOT EXISTS ai_cache jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(ai_cache)='object');
COMMIT;
