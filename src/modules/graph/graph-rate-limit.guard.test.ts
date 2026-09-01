import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import type { RequestWithUser } from "../auth/access-token.guard";
import { GraphRateLimitGuard } from "./graph-rate-limit.guard";

const config = { RATE_LIMIT_GRAPH_PER_MINUTE: 120 } as ApiEnv;

function contextFor(userId: string): ExecutionContext {
  const request = { userId } as RequestWithUser;
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe("GraphRateLimitGuard", () => {
  it("allows a request within the per-user per-minute limit", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
    const guard = new GraphRateLimitGuard(rateLimit as never, config);

    await expect(guard.canActivate(contextFor("user-1"))).resolves.toBe(true);
    expect(rateLimit.consume).toHaveBeenCalledWith("graph:user-1", 120, 60);
  });

  it("throws RATE_LIMITED once the per-minute limit is exhausted", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 30 })) };
    const guard = new GraphRateLimitGuard(rateLimit as never, config);

    await expect(guard.canActivate(contextFor("user-1"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
