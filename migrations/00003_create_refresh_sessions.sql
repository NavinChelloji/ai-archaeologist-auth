-- migrate:up
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  parent_id       uuid REFERENCES refresh_sessions(id) ON DELETE SET NULL,
  user_agent      text,
  ip_hash         text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_active
  ON refresh_sessions (user_id) WHERE revoked_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS refresh_sessions;
