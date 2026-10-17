-- Non-public daily processing audit. No customer feed or publication switch.
CREATE TABLE IF NOT EXISTS public.resolute_rizel_daily_runs (
 day date PRIMARY KEY,
 state text NOT NULL CHECK(state IN ('processing','ready','failed')),
 started_at timestamptz NOT NULL,
 finished_at timestamptz,
 candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 3),
 selection_refs jsonb NOT NULL DEFAULT '[]',
 publication text NOT NULL DEFAULT 'withheld' CHECK(publication='withheld')
);
REVOKE ALL ON public.resolute_rizel_daily_runs FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.resolute_rizel_daily_runs TO resolute_rizel_writer;
