import type { UserDto } from "@aca/contracts";
import type { UserRow } from "./users.repository";

/** Never include token/credential fields — the browser must never receive a GitHub token or password hash. */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    githubLogin: row.github_login,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    emailVerified: row.email_verified_at !== null,
    hasPassword: row.password_hash !== null,
    githubLinked: row.github_user_id !== null,
    createdAt: row.created_at.toISOString(),
  };
}
