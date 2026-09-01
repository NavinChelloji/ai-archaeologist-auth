import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { AuthService } from "./auth.service";

describe("AuthService.deleteAccount", () => {
  it("revokes every refresh session before deleting the user row", async () => {
    const calls: string[] = [];
    const refreshSessions = { revokeAllForUser: vi.fn(async () => { calls.push("revokeAllForUser"); }) };
    const users = { delete: vi.fn(async () => { calls.push("delete"); }) };

    const auth = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      users as never,
      refreshSessions as never,
      {} as never,
      {} as ApiEnv
    );

    await auth.deleteAccount("user-1");

    expect(refreshSessions.revokeAllForUser).toHaveBeenCalledWith("user-1");
    expect(users.delete).toHaveBeenCalledWith("user-1");
    expect(calls).toEqual(["revokeAllForUser", "delete"]);
  });
});
