import { createHash } from "node:crypto";
import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";

const WINDOW_SECONDS = 3600;

@Injectable()
export class SignupRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ipKey = request.ip ? createHash("sha256").update(request.ip).digest("hex") : "unknown";

    const result = await this.rateLimit.consume(`auth-signup:${ipKey}`, this.config.RATE_LIMIT_SIGNUP_PER_HOUR, WINDOW_SECONDS);

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many signup attempts. Please wait before trying again.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
