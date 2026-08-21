-- migrate:up
CREATE TABLE IF NOT EXISTS users (
  id                        uuid PRIMARY KEY,
  github_user_id            text NOT NULL UNIQUE,
  github_login              text NOT NULL,
  email                     text,
  display_name              text,
  avatar_url                text,
  encrypted_access_token    text NOT NULL,
  encrypted_refresh_token   text,
  token_expires_at          timestamptz,
  key_version               integer NOT NULL DEFAULT 1,
  github_scopes             text[] NOT NULL DEFAULT '{}',
  disconnected_at           timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_github_login ON users (github_login);

-- migrate:down
DROP TABLE IF EXISTS users;
