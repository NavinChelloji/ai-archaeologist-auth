import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { EmailVerificationService } from "./email-verification.service";
import type { EmailVerificationTokenRow } from "./email-verification-tokens.repository";

const config = { EMAIL_VERIFICATION_TTL_SECONDS: 86_400, PUBLIC_APP_URL: "http://localhost:5173" } as ApiEnv;

function fakeTokens() {
  const rows = new Map<string, EmailVerificationTokenRow>();
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

function fakeUsers() {
  return { markEmailVerified: vi.fn(async () => undefined) };
}

function fakeEmailSender() {
  return { send: vi.fn(async () => undefined) };
}

function extractToken(sender: ReturnType<typeof fakeEmailSender>): string {
  const text = sender.send.mock.calls[0]![0].text as string;
  return new URL(text.split("visiting: ")[1]!).searchParams.get("token")!;
}

describe("EmailVerificationService", () => {
  it("verifies a token exactly once", async () => {
    const tokens = fakeTokens();
    const users = fakeUsers();
    const emailSender = fakeEmailSender();
    const service = new EmailVerificationService(tokens as never, users as never, emailSender as never, config);

    await service.sendVerification("user-1", "person@example.com");
    const token = extractToken(emailSender);

    await service.verify(token);
    expect(users.markEmailVerified).toHaveBeenCalledWith("user-1");

    await expect(service.verify(token)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_INVALID" });
  });

  it("rejects an expired token", async () => {
    const tokens = fakeTokens();
    const users = fakeUsers();
    const emailSender = fakeEmailSender();
    const service = new EmailVerificationService(tokens as never, users as never, emailSender as never, {
      ...config,
      EMAIL_VERIFICATION_TTL_SECONDS: -1,
    });

    await service.sendVerification("user-1", "person@example.com");
    const token = extractToken(emailSender);

    await expect(service.verify(token)).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_INVALID" });
  });

  it("rejects an unknown token", async () => {
    const tokens = fakeTokens();
    const users = fakeUsers();
    const emailSender = fakeEmailSender();
    const service = new EmailVerificationService(tokens as never, users as never, emailSender as never, config);

    await expect(service.verify("never-issued")).rejects.toMatchObject({ code: "AUTH_EMAIL_VERIFICATION_INVALID" });
  });
});
