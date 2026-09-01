import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { DefaultRateLimitGuard } from "./default-rate-limit.guard";

const config = { RATE_LIMIT_DEFAULT_PER_MINUTE: 300, RATE_LIMIT_ANON_PER_MINUTE: 60 } as ApiEnv;

function contextFor(request: Partial<FastifyRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request as FastifyRequest }) } as unknown as ExecutionContext;
}

function fakeAccessTokens(userId: string | null) {
  return {
    verify: vi.fn(() => {
      if (!userId) throw new Error("invalid token");
      return { userId };
    }),
  };
}

describe("DefaultRateLimitGuard", () => {
  it("keys by userId and uses the authenticated limit when the bearer token verifies", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens("user-1") as never, config);

    const request = { url: "/api/v1/repositories", headers: { authorization: "Bearer good-token" }, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(rateLimit.consume).toHaveBeenCalledWith("default-user:user-1", 300, 60);
  });

  it("falls back to a hashed IP key with the anonymous limit when there is no valid bearer token", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens(null) as never, config);

    const request = { url: "/api/v1/auth/github/start", headers: {}, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(rateLimit.consume).toHaveBeenCalledWith(expect.stringMatching(/^default-ip:/), 60, 60);
  });

  it("throws RATE_LIMITED once the limit is exhausted", async () => {
    const rateLimit = { consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 10 })) };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens(null) as never, config);

    const request = { url: "/api/v1/repositories", headers: {}, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("exempts /internal routes so service-to-service traffic is never limited", async () => {
    const rateLimit = { consume: vi.fn() };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens(null) as never, config);

    const request = { url: "/internal/repositories/repo-1", headers: {}, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(rateLimit.consume).not.toHaveBeenCalled();
  });

  it("exempts /health routes", async () => {
    const rateLimit = { consume: vi.fn() };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens(null) as never, config);

    const request = { url: "/health/live", headers: {}, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(rateLimit.consume).not.toHaveBeenCalled();
  });

  it("exempts /metrics so Prometheus scrapes are never limited", async () => {
    const rateLimit = { consume: vi.fn() };
    const guard = new DefaultRateLimitGuard(rateLimit as never, fakeAccessTokens(null) as never, config);

    const request = { url: "/metrics", headers: {}, ip: "1.2.3.4" };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(rateLimit.consume).not.toHaveBeenCalled();
  });
});
