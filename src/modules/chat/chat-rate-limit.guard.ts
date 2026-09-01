import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import type { RequestWithUser } from "../auth/access-token.guard";

const WINDOW_SECONDS = 3600;

/** User-keyed — runs after AccessTokenGuard (RULES.md #12 "Rate-limit ... chat"; SCOPE_LIMITS.md RATE_LIMIT_CHAT_PER_HOUR — chat is the one endpoint group that spends real LLM tokens per call). */
@Injectable()
export class ChatRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const result = await this.rateLimit.consume(`chat:${request.userId}`, this.config.RATE_LIMIT_CHAT_PER_HOUR, WINDOW_SECONDS);

    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many chat messages. Please wait before sending another.", {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }

    return true;
  }
}
