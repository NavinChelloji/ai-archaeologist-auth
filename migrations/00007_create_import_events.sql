-- migrate:up
-- Cost-containment record of every accepted repository import (fresh import
-- or reindex) for QUOTA_IMPORTS enforcement (SCOPE_LIMITS.md
-- "QUOTA_IMPORTS_PER_MONTH", RULES.md #18 "Enforce ... quotas ... before
-- making a paid call, not after"). `api` owns this — it is the only
-- deployable that knows which user triggered an import — even though
-- `indexer` separately enforces the concurrent MAX_REPOSITORIES_PER_USER cap.
CREATE TABLE IF NOT EXISTS import_events (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id      uuid NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_events_user_month ON import_events (user_id, occurred_at DESC);

-- migrate:down
DROP TABLE IF EXISTS import_events;
