import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import type { RequestWithUser } from "../auth/access-token.guard";
import { ChatRateLimitGuard } from "./chat-rate-limit.guard";

const config = { RATE_LIMIT_CHAT_PER_HOUR: 20 } as ApiEnv;

function contextFor(userId: string): ExecutionContext {
  const request = { userId } as RequestWithUser;
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe("ChatRateLimitGuard", () => {
  it("allows a request within the per-user hourly limit", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
    const guard = new ChatRateLimitGuard(rateLimit as never, config);

    await expect(guard.canActivate(contextFor("user-1"))).resolves.toBe(true);
    expect(rateLimit.consume).toHaveBeenCalledWith("chat:user-1", 20, 3600);
  });

  it("throws RATE_LIMITED once the hourly limit is exhausted", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 120 })) };
    const guard = new ChatRateLimitGuard(rateLimit as never, config);

    await expect(guard.canActivate(contextFor("user-1"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
