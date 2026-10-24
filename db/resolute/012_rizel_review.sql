-- Additive private storage. No customer role receives access.
BEGIN;
CREATE TABLE IF NOT EXISTS resolute_rizel_copy_versions (
 id text NOT NULL, locale text NOT NULL CHECK(locale IN ('ja','en')),
 revision integer NOT NULL CHECK(revision>0), value jsonb NOT NULL,
 approval text NOT NULL CHECK(approval IN ('draft','approved')),
 approved_by text, approved_at timestamptz,
 publication text NOT NULL DEFAULT 'withheld' CHECK(publication='withheld'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,locale,revision)
);
CREATE TABLE IF NOT EXISTS resolute_rizel_reviews (
 article_id text NOT NULL, article_revision text NOT NULL,
 locale text NOT NULL CHECK(locale IN ('ja','en')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 revision integer NOT NULL DEFAULT 0, reviewer text, reviewed_at timestamptz,
 PRIMARY KEY(article_id,article_revision,locale),
 FOREIGN KEY(article_id,article_revision) REFERENCES resolute_rizel_selections(article_id,article_revision)
);
CREATE TABLE IF NOT EXISTS resolute_rizel_review_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 article_id text NOT NULL, article_revision text NOT NULL, locale text NOT NULL,
 decision text NOT NULL, reviewer text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON resolute_rizel_copy_versions,resolute_rizel_reviews,resolute_rizel_review_events FROM PUBLIC;
COMMIT;
