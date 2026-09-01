import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { OwnershipResolver } from "./ownership-resolver.service";

const config = { OWNERSHIP_CACHE_TTL_SECONDS: 60 } as ApiEnv;

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  };
}

function fakeIndexer(owns: boolean) {
  return { checkOwnership: vi.fn(async () => ({ owns })) };
}

describe("OwnershipResolver", () => {
  it("passes for the owning user and caches the result", async () => {
    const redis = fakeRedis();
    const indexer = fakeIndexer(true);
    const resolver = new OwnershipResolver(indexer as never, redis as never, config);

    await expect(resolver.assertOwnership("user-1", "repo-1")).resolves.toBeUndefined();
    await resolver.assertOwnership("user-1", "repo-1");

    expect(indexer.checkOwnership).toHaveBeenCalledTimes(1);
  });

  it("rejects with REPO_FORBIDDEN for a non-owned repository", async () => {
    const resolver = new OwnershipResolver(fakeIndexer(false) as never, fakeRedis() as never, config);

    await expect(resolver.assertOwnership("user-1", "repo-1")).rejects.toMatchObject({ code: "REPO_FORBIDDEN" });
  });

  it("rejects from a cached negative result without calling indexer again", async () => {
    const redis = fakeRedis();
    const indexer = fakeIndexer(false);
    const resolver = new OwnershipResolver(indexer as never, redis as never, config);

    await expect(resolver.assertOwnership("user-1", "repo-1")).rejects.toMatchObject({ code: "REPO_FORBIDDEN" });
    await expect(resolver.assertOwnership("user-1", "repo-1")).rejects.toMatchObject({ code: "REPO_FORBIDDEN" });

    expect(indexer.checkOwnership).toHaveBeenCalledTimes(1);
  });

  it("invalidate clears the cached ownership so the next check re-asks indexer", async () => {
    const redis = fakeRedis();
    const indexer = fakeIndexer(true);
    const resolver = new OwnershipResolver(indexer as never, redis as never, config);

    await resolver.assertOwnership("user-1", "repo-1");
    await resolver.invalidate("user-1", "repo-1");
    await resolver.assertOwnership("user-1", "repo-1");

    expect(indexer.checkOwnership).toHaveBeenCalledTimes(2);
  });
});
