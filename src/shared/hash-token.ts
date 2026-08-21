import { createHash } from "node:crypto";

/** SHA-256 hex digest — every opaque bearer token (refresh, email verification, password reset) is stored hashed, never in plaintext. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
