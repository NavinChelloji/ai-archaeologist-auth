-- migrate:up

-- adr/0006-email-password-auth.md: GitHub is no longer required to have an
-- account, so every column that used to assume it exists becomes nullable.
ALTER TABLE users ALTER COLUMN github_user_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN github_login DROP NOT NULL;
ALTER TABLE users ALTER COLUMN encrypted_access_token DROP NOT NULL;

ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;

-- A row must have at least one way to sign in.
ALTER TABLE users ADD CONSTRAINT users_has_an_identity
  CHECK (github_user_id IS NOT NULL OR password_hash IS NOT NULL);

-- Email was previously just profile info copied from GitHub, not unique.
-- It's now also a login credential, so it must be unique when present —
-- partial because a GitHub-only user may still have no email at all.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_has_an_identity;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users ALTER COLUMN encrypted_access_token SET NOT NULL;
ALTER TABLE users ALTER COLUMN github_login SET NOT NULL;
ALTER TABLE users ALTER COLUMN github_user_id SET NOT NULL;
