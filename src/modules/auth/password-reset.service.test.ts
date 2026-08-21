import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { PasswordResetService } from "./password-reset.service";
import type { PasswordResetTokenRow } from "./password-reset-tokens.repository";
import type { UserRow } from "./users.repository";

const config = { PASSWORD_RESET_TTL_SECONDS: 3_600, PUBLIC_APP_URL: "http://localhost:5173" } as ApiEnv;

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    github_user_id: null,
    github_login: null,
    email: "person@example.com",
    display_name: null,
    avatar_url: null,
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    token_expires_at: null,
    key_version: 1,
    github_scopes: [],
    disconnected_at: null,
    password_hash: "hashed:old-password",
    email_verified_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function fakeTokens() {
  const rows = new Map<string, PasswordResetTokenRow>();
  let nextId = 0;

  return {
    create: vi.fn(async (userId: string, tokenHash: string, expiresAt: Date) => {
      rows.set(tokenHash, {
        id: `token-${++nextId}`,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        consumed_at: null,
        created_at: new Date(),
      });
    }),
    findByTokenHash: vi.fn(async (tokenHash: string) => rows.get(tokenHash) ?? null),
    consume: vi.fn(async (id: string) => {
      for (const row of rows.values()) {
        if (row.id === id) row.consumed_at = new Date();
      }
    }),
  };
}

function fakeUsers(initial: UserRow[] = []) {
  const byId = new Map(initial.map((u) => [u.id, u]));
  return {
    findByEmail: vi.fn(async (email: string) => [...byId.values()].find((u) => u.email === email) ?? null),
    updatePasswordHash: vi.fn(async (userId: string, passwordHash: string) => {
      byId.get(userId)!.password_hash = passwordHash;
    }),
  };
}

function fakeRefreshSessions() {
  return { revokeAllForUser: vi.fn(async () => undefined) };
}

function fakePasswordHash() {
  return { hash: vi.fn(async (password: string) => `hashed:${password}`) };
}

function fakeEmailSender() {
  return { send: vi.fn(async () => undefined) };
}

function extractToken(sender: ReturnType<typeof fakeEmailSender>): string {
  const text = sender.send.mock.calls[0]![0].text as string;
  return new URL(text.split("visiting: ")[1]!).searchParams.get("token")!;
}

describe("PasswordResetService", () => {
  it("resets the password with a valid token and revokes every session", async () => {
    const users = fakeUsers([makeUser()]);
    const tokens = fakeTokens();
    const refreshSessions = fakeRefreshSessions();
    const emailSender = fakeEmailSender();
    const service = new PasswordResetService(
      tokens as never,
      users as never,
      refreshSessions as never,
      fakePasswordHash() as never,
      emailSender as never,
      config
    );

    await service.requestReset("person@example.com");
    const token = extractToken(emailSender);

    await service.reset(token, "new-password");

    expect(users.updatePasswordHash).toHaveBeenCalledWith("user-1", "hashed:new-password");
    expect(refreshSessions.revokeAllForUser).toHaveBeenCalledWith("user-1");
    await expect(service.reset(token, "again")).rejects.toMatchObject({ code: "AUTH_PASSWORD_RESET_INVALID" });
  });

  it("succeeds silently for an unregistered email — not an enumeration oracle", async () => {
    const users = fakeUsers();
    const service = new PasswordResetService(
      fakeTokens() as never,
      users as never,
      fakeRefreshSessions() as never,
      fakePasswordHash() as never,
      fakeEmailSender() as never,
      config
    );

    await expect(service.requestReset("nobody@example.com")).resolves.toBeUndefined();
  });

  it("rejects an unknown token", async () => {
    const service = new PasswordResetService(
      fakeTokens() as never,
      fakeUsers() as never,
      fakeRefreshSessions() as never,
      fakePasswordHash() as never,
      fakeEmailSender() as never,
      config
    );

    await expect(service.reset("never-issued", "whatever")).rejects.toMatchObject({
      code: "AUTH_PASSWORD_RESET_INVALID",
    });
  });
});
