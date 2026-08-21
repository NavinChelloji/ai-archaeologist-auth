import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import type { Logger } from "@aca/logger";
import { RefreshSessionService } from "./refresh-session.service";
import type { CreateRefreshSessionInput, RefreshSessionRow } from "./refresh-sessions.repository";

const config = { REFRESH_TOKEN_TTL_SECONDS: 2_592_000 } as ApiEnv;
const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { userAgent: null, ipHash: null };

function fakeRepository() {
  const rowsByHash = new Map<string, RefreshSessionRow>();
  let nextId = 0;

  return {
    create: vi.fn(async (input: CreateRefreshSessionInput) => {
      const row: RefreshSessionRow = {
        id: `session-${++nextId}`,
        user_id: input.userId,
        token_hash: input.tokenHash,
        parent_id: input.parentId,
        user_agent: input.userAgent,
        ip_hash: input.ipHash,
        expires_at: input.expiresAt,
        revoked_at: null,
        created_at: new Date(),
      };
      rowsByHash.set(row.token_hash, row);
      return row;
    }),
    findByTokenHash: vi.fn(async (tokenHash: string) => rowsByHash.get(tokenHash) ?? null),
    revoke: vi.fn(async (id: string) => {
      for (const row of rowsByHash.values()) {
        if (row.id === id) row.revoked_at = new Date();
      }
    }),
    revokeAllForUser: vi.fn(async (userId: string) => {
      for (const row of rowsByHash.values()) {
        if (row.user_id === userId) row.revoked_at = new Date();
      }
    }),
  };
}

describe("RefreshSessionService", () => {
  it("issues a token that can be rotated once", async () => {
    const repo = fakeRepository();
    const service = new RefreshSessionService(repo as never, config, noopLogger);

    const issued = await service.issue("user-1", context);
    const rotated = await service.rotate(issued.token, context);

    expect(rotated.userId).toBe("user-1");
    expect(rotated.token).not.toBe(issued.token);
  });

  it("rejects an unknown refresh token", async () => {
    const repo = fakeRepository();
    const service = new RefreshSessionService(repo as never, config, noopLogger);

    await expect(service.rotate("not-a-real-token", context)).rejects.toMatchObject({
      code: "AUTH_REFRESH_INVALID",
    });
  });

  it("detects reuse of an already-rotated token and revokes every session for the user", async () => {
    const repo = fakeRepository();
    const service = new RefreshSessionService(repo as never, config, noopLogger);

    const issued = await service.issue("user-1", context);
    await service.rotate(issued.token, context); // first (legitimate) rotation

    // presenting the same (now-revoked) token again looks like theft
    await expect(service.rotate(issued.token, context)).rejects.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
    });
    expect(repo.revokeAllForUser).toHaveBeenCalledWith("user-1");
  });

  it("rejects an expired refresh token", async () => {
    const repo = fakeRepository();
    const service = new RefreshSessionService(repo as never, { ...config, REFRESH_TOKEN_TTL_SECONDS: -1 }, noopLogger);

    const issued = await service.issue("user-1", context);

    await expect(service.rotate(issued.token, context)).rejects.toMatchObject({
      code: "AUTH_REFRESH_INVALID",
    });
  });
});
