import type Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { OauthStateService } from "./oauth-state.service";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  } as unknown as Redis;
}

const config = { OAUTH_STATE_TTL_SECONDS: 600 } as ApiEnv;

describe("OauthStateService", () => {
  it("consumes a state exactly once and returns its PKCE verifier and mode", async () => {
    const redis = fakeRedis();
    const service = new OauthStateService(redis, config);

    const attempt = await service.start();
    const data = await service.consume(attempt.state);

    expect(data.codeVerifier).toBe(attempt.codeVerifier);
    expect(data.mode).toBe("signin");
  });

  it("carries the target user through a link attempt", async () => {
    const redis = fakeRedis();
    const service = new OauthStateService(redis, config);

    const attempt = await service.start("link", "user-123");
    const data = await service.consume(attempt.state);

    expect(data.mode).toBe("link");
    expect(data.linkUserId).toBe("user-123");
  });

  it("rejects an unknown or already-consumed state", async () => {
    const redis = fakeRedis();
    const service = new OauthStateService(redis, config);

    const attempt = await service.start();
    await service.consume(attempt.state);

    await expect(service.consume(attempt.state)).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    await expect(service.consume("never-issued")).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });
});
