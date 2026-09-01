import { createHash } from "node:crypto";
import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { AccessTokenService } from "../../modules/auth/access-token.service";
import { RateLimitService } from "./rate-limit.service";

const WINDOW_SECONDS = 60;
const BEARER_PREFIX = "Bearer ";

/**
 * Blanket fallback limit for every public route that doesn't already have a
 * tighter, endpoint-specific guard (RULES.md #12, SCOPE_LIMITS.md "Default
 * API" / "Unauthenticated"). Registered globally via `APP_GUARD`, so it runs
 * before `AccessTokenGuard` has had a chance to set `request.userId` — it
 * verifies the bearer token itself (best-effort, never throwing) purely to
 * pick the right key and limit; the real 401 for a missing/invalid token
 * still comes from the route's own `AccessTokenGuard` afterward. `/internal`
 * `/health`, and `/metrics` are exempt: they're not public ingress traffic
 * (RULES.md #12 "`/internal/*` routes ... must not be routed from the
 * public ingress") and applying the anonymous limit to service-to-service,
 * liveness-probe, or Prometheus-scrape traffic would be a self-inflicted
 * outage, not hardening.
 */
@Injectable()
export class DefaultRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly accessTokens: AccessTokenService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.isExempt(request.url)) return true;

    const userId = this.tryExtractUserId(request);
    const key = userId ? `default-user:${userId}` : `default-ip:${this.hashIp(request)}`;
    const limit = userId ? this.config.RATE_LIMIT_DEFAULT_PER_MINUTE : this.config.RATE_LIMIT_ANON_PER_MINUTE;

    const result = await this.rateLimit.consume(key, limit, WINDOW_SECONDS);
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }

  private isExempt(url: string | undefined): boolean {
    return !url || url.startsWith("/internal") || url.startsWith("/health") || url.startsWith("/metrics");
  }

  private tryExtractUserId(request: FastifyRequest): string | null {
    const header = request.headers["authorization"];
    if (!header?.startsWith(BEARER_PREFIX)) return null;
    try {
      return this.accessTokens.verify(header.slice(BEARER_PREFIX.length)).userId;
    } catch {
      return null;
    }
  }

  private hashIp(request: FastifyRequest): string {
    return request.ip ? createHash("sha256").update(request.ip).digest("hex") : "unknown";
  }
}
