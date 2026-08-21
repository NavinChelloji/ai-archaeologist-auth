import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { PasswordAuthService } from "./password-auth.service";
import type { UserRow } from "./users.repository";

const config = { LOGIN_LOCKOUT_THRESHOLD: 3, LOGIN_LOCKOUT_DURATION_SECONDS: 900 } as ApiEnv;
const context = { userAgent: null, ipHash: null };

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
    password_hash: "hashed:correct-password",
    email_verified_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function fakeUsersRepository(initial: UserRow[] = []) {
  const byId = new Map(initial.map((u) => [u.id, u]));
  let nextId = initial.length + 1;

  return {
    findByEmail: vi.fn(async (email: string) => [...byId.values()].find((u) => u.email === email) ?? null),
    createWithPassword: vi.fn(async (input: { email: string; passwordHash: string }) => {
      const row = makeUser({ id: `user-${nextId++}`, email: input.email, password_hash: input.passwordHash });
      byId.set(row.id, row);
      return row;
    }),
    incrementFailedLoginAttempts: vi.fn(async (userId: string) => {
      const row = byId.get(userId)!;
      row.failed_login_attempts += 1;
      return row;
    }),
    lockUntil: vi.fn(async (userId: string, until: Date) => {
      byId.get(userId)!.locked_until = until;
    }),
    resetFailedLoginAttempts: vi.fn(async (userId: string) => {
      const row = byId.get(userId)!;
      row.failed_login_attempts = 0;
      row.locked_until = null;
    }),
  };
}

function fakePasswordHash() {
  return {
    hash: vi.fn(async (password: string) => `hashed:${password}`),
    verify: vi.fn(async (hash: string, password: string) => hash === `hashed:${password}`),
  };
}

function fakeEmailVerification() {
  return { sendVerification: vi.fn(async () => undefined) };
}

function fakeRefreshSessions() {
  return {
    issue: vi.fn(async (userId: string) => ({ token: `refresh-${userId}`, expiresAt: new Date(Date.now() + 1000) })),
  };
}

function fakeAccessTokens() {
  return { issue: vi.fn((userId: string) => ({ token: `access-${userId}`, expiresIn: 900 })) };
}

function makeService(users: ReturnType<typeof fakeUsersRepository>, overrides: Partial<ApiEnv> = {}) {
  return new PasswordAuthService(
    users as never,
    fakePasswordHash() as never,
    fakeEmailVerification() as never,
    fakeRefreshSessions() as never,
    fakeAccessTokens() as never,
    { ...config, ...overrides }
  );
}

describe("PasswordAuthService", () => {
  it("signs a new user up and immediately issues a session", async () => {
    const users = fakeUsersRepository();
    const service = makeService(users);

    const result = await service.signup("new@example.com", "correct-password", context);

    expect(result.user.email).toBe("new@example.com");
    expect(result.accessToken).toBe(`access-${result.user.id}`);
  });

  it("rejects signup with an already-registered email", async () => {
    const users = fakeUsersRepository([makeUser({ email: "taken@example.com" })]);
    const service = makeService(users);

    await expect(service.signup("taken@example.com", "whatever", context)).rejects.toMatchObject({
      code: "AUTH_EMAIL_ALREADY_REGISTERED",
    });
  });

  it("logs in with correct credentials", async () => {
    const users = fakeUsersRepository([makeUser()]);
    const service = makeService(users);

    const result = await service.login("person@example.com", "correct-password", context);
    expect(result.user.id).toBe("user-1");
  });

  it("rejects the wrong password and an unknown email with the same code", async () => {
    const users = fakeUsersRepository([makeUser()]);
    const service = makeService(users);

    await expect(service.login("person@example.com", "wrong-password", context)).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    await expect(service.login("nobody@example.com", "whatever", context)).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("rejects a password login for a GitHub-only account", async () => {
    const users = fakeUsersRepository([makeUser({ password_hash: null })]);
    const service = makeService(users);

    await expect(service.login("person@example.com", "whatever", context)).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("locks the account after the configured number of failed attempts", async () => {
    const users = fakeUsersRepository([makeUser()]);
    const service = makeService(users);

    for (let i = 0; i < config.LOGIN_LOCKOUT_THRESHOLD; i++) {
      await expect(service.login("person@example.com", "wrong", context)).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    await expect(service.login("person@example.com", "correct-password", context)).rejects.toMatchObject({
      code: "AUTH_ACCOUNT_LOCKED",
    });
  });

  it("clears the failed-attempt counter on a successful login", async () => {
    const users = fakeUsersRepository([makeUser({ failed_login_attempts: 1 })]);
    const service = makeService(users);

    await service.login("person@example.com", "correct-password", context);
    expect(users.resetFailedLoginAttempts).toHaveBeenCalledWith("user-1");
  });
});
