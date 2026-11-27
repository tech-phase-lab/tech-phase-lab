-- Additive, RESOLUTE database only. Apply using the migration owner, never at web startup.
-- Shock Gauge owner pick (owner, Nov 27): the day's candidates (built at 06:00 JST, 06:30 on an after-close earnings day, and mailed
-- to the owner with the 3 stories the service plans to publish), the stories the owner adds, and the owner's picks (stories, their ★ and order, accepted until 08:00 JST), published
-- at 08:20 JST. Without picks the service publishes its own. Screenshots are never stored: only the owner's edited text is.
BEGIN;
CREATE TABLE IF NOT EXISTS resolute.shock_candidates (
 day date PRIMARY KEY,
 state text NOT NULL CHECK(state IN('processing','ready','failed')),
 candidates jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(candidates)='array'),
 built_at timestamptz NOT NULL DEFAULT now(),
 -- The service's own 3 picks, chosen at the candidate run and mailed to the owner: [{id, stars, rizel}]. Published at 08:20 unless
 -- the owner answered by 08:00.
 planned jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(planned)='array'),
 -- The owner's own stories: [{id, url, publisher, ja:{title,summary}, en:{title,summary}, stars, addedAt}].
 added jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(added)='array'),
 -- [{id, stars}] in the owner's order (candidate or added ids); NULL until the owner answers.
 picks jsonb CHECK(picks IS NULL OR jsonb_typeof(picks)='array'),
 picked_at timestamptz,
 revision integer NOT NULL DEFAULT 0,
 -- 'owner' = the owner's picks were published; 'auto' = the service's own picks (no answer by the deadline).
 published_source text CHECK(published_source IS NULL OR published_source IN('owner','auto')),
 published_at timestamptz,
 mail_state text);
GRANT SELECT,INSERT,UPDATE ON resolute.shock_candidates TO resolute_risk_writer;
COMMIT;
