-- Private audit store only. Apply with the database administrator, not a browser.
-- Approval of a copy is NOT permission to publish it.
CREATE TABLE IF NOT EXISTS resolute_rizel_selections (
 article_id text NOT NULL,
 article_revision text NOT NULL,
 created_at timestamptz NOT NULL,
 result jsonb NOT NULL CHECK (result->>'publication' = 'withheld'),
 PRIMARY KEY(article_id, article_revision)
);
REVOKE ALL ON resolute_rizel_selections FROM PUBLIC;
