import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { CookieSerializeOptions } from "../../shared/cookies";
import type { RequestContext } from "./refresh-session.service";
import { AUTH_COOKIE_PATH } from "./auth.constants";

export function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 255) : null,
    ipHash: request.ip ? createHash("sha256").update(request.ip).digest("hex") : null,
  };
}

/**
 * `secure: true` still works for local dev over `http://localhost` —
 * browsers treat localhost as a secure context regardless of TLS
 * (AUTH_SERVICE_PLAN.md "Security": refresh cookie is HttpOnly, Secure,
 * SameSite=Lax, path-scoped to /api/v1/auth). Lax (not Strict) because
 * the cookie must be sent in cross-origin fetch requests from the frontend
 * calling /api/v1/auth/refresh.
 */
export function refreshCookieOptions(expiresAt: Date): CookieSerializeOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: AUTH_COOKIE_PATH, expires: expiresAt };
}

/** SameSite=Lax (not Strict) because this cookie must survive the top-level redirect back from github.com. */
export function oauthStateCookieOptions(ttlSeconds: number): CookieSerializeOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: AUTH_COOKIE_PATH, maxAge: ttlSeconds };
}
