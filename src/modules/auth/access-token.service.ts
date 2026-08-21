import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";

export interface AccessTokenClaims {
  userId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

const ISSUER = "api";
const AUDIENCE = "web";

/**
 * Short-lived RS256 user access tokens (distinct from the internal HS256
 * service token). Verified from signature and claims alone — no session
 * lookup, no in-memory state (AUTH_SERVICE_PLAN.md "Stateless Design").
 */
@Injectable()
export class AccessTokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: ApiEnv) {}

  issue(userId: string): IssuedAccessToken {
    const token = jwt.sign({}, this.config.JWT_ACCESS_PRIVATE_KEY, {
      algorithm: "RS256",
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
    });
    return { token, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS };
  }

  verify(token: string): AccessTokenClaims {
    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(token, this.config.JWT_ACCESS_PUBLIC_KEY, {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch (err) {
      const code = err instanceof jwt.TokenExpiredError ? "AUTH_TOKEN_EXPIRED" : "AUTH_REQUIRED";
      throw new AppError(code, "Your session has expired. Please sign in again.");
    }

    if (typeof payload === "string" || !payload.sub) {
      throw new AppError("AUTH_REQUIRED", "Invalid access token.");
    }

    return { userId: payload.sub };
  }
}
