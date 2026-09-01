import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import type { RequestWithUser } from "../auth/access-token.guard";

const WINDOW_SECONDS = 60;

/** User-keyed — runs after AccessTokenGuard (RULES.md #12 "Rate-limit ... graph"; SCOPE_LIMITS.md RATE_LIMIT_GRAPH_PER_MINUTE — a graph explorer UI can fire many neighbor-expansion calls quickly). */
@Injectable()
export class GraphRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const result = await this.rateLimit.consume(`graph:${request.userId}`, this.config.RATE_LIMIT_GRAPH_PER_MINUTE, WINDOW_SECONDS);

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many graph requests. Please slow down.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
