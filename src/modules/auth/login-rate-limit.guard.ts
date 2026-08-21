import { createHash } from "node:crypto";
import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";

const WINDOW_SECONDS = 60;

/** IP-keyed, since the request isn't authenticated yet — per-account brute force is separately covered by login lockout. */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ipKey = request.ip ? createHash("sha256").update(request.ip).digest("hex") : "unknown";

    const result = await this.rateLimit.consume(`auth-login:${ipKey}`, this.config.RATE_LIMIT_LOGIN_PER_MINUTE, WINDOW_SECONDS);

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many login attempts. Please wait before trying again.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
