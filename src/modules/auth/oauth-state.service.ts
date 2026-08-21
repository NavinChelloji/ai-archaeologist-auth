import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { REDIS_CLIENT } from "../../shared/infra.module";

const REDIS_KEY_PREFIX = "oauth:state:";

export type OauthMode = "signin" | "link";

export interface OauthAttempt {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * `mode: "link"` carries the authenticated user to attach GitHub to
 * (AUTH_SERVICE_PLAN.md "GitHub linking vs. sign-in") — the callback checks
 * this so a "link" state can't be replayed against the sign-in callback or
 * vice versa.
 */
export interface OauthStateData {
  codeVerifier: string;
  mode: OauthMode;
  linkUserId?: string;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * OAuth `state` + PKCE, single-use, Redis-backed with a TTL
 * (AUTH_SERVICE_PLAN.md "Stateless Design" — no in-memory sessions).
 */
@Injectable()
export class OauthStateService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  /** Generates a fresh state + PKCE pair and stores the attempt in Redis, keyed by state. */
  async start(mode: OauthMode = "signin", linkUserId?: string): Promise<OauthAttempt> {
    const state = randomUUID();
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

    const data: OauthStateData = { codeVerifier, mode, linkUserId };
    await this.redis.set(`${REDIS_KEY_PREFIX}${state}`, JSON.stringify(data), "EX", this.config.OAUTH_STATE_TTL_SECONDS);

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Validates and consumes a state, returning its stored attempt data.
   * Throws `OAUTH_STATE_INVALID` if the state is missing, expired, or
   * already used — states are deleted on first read, so replay fails the
   * same way.
   */
  async consume(state: string): Promise<OauthStateData> {
    const key = `${REDIS_KEY_PREFIX}${state}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AppError("OAUTH_STATE_INVALID", "This sign-in attempt has expired or was already used.");
    }
    await this.redis.del(key);
    return JSON.parse(raw) as OauthStateData;
  }
}
