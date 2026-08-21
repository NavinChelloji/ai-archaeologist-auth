import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { GithubLinkService } from "./github-link.service";
import type { OauthMode, OauthStateData } from "./oauth-state.service";
import type { UserRow } from "./users.repository";

const config = { OAUTH_STATE_TTL_SECONDS: 600 } as ApiEnv;

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
    password_hash: "hashed",
    email_verified_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function fakeOauthState() {
  const attempts = new Map<string, OauthStateData>();
  let n = 0;

  return {
    start: vi.fn(async (mode: OauthMode = "signin", linkUserId?: string) => {
      const state = `state-${++n}`;
      attempts.set(state, { codeVerifier: `verifier-${n}`, mode, linkUserId });
      return { state, codeVerifier: `verifier-${n}`, codeChallenge: `challenge-${n}` };
    }),
    consume: vi.fn(async (state: string) => {
      const data = attempts.get(state);
      if (!data) throw Object.assign(new Error("invalid"), { code: "OAUTH_STATE_INVALID" });
      attempts.delete(state);
      return data;
    }),
  };
}

function fakeGithub() {
  return {
    buildAuthorizeUrl: vi.fn(() => "https://github.com/login/oauth/authorize?..."),
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: "gho_token",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["repo"],
    })),
    fetchProfile: vi.fn(async () => ({
      githubUserId: "gh-1",
      githubLogin: "octocat",
      email: null,
      displayName: null,
      avatarUrl: "https://avatar",
    })),
  };
}

function fakeCipher() {
  return { encrypt: vi.fn((plaintext: string) => ({ ciphertext: `enc:${plaintext}`, keyVersion: 1 })) };
}

function fakeUsers(initial: UserRow[] = []) {
  const byId = new Map(initial.map((u) => [u.id, u]));

  return {
    findByGithubUserId: vi.fn(
      async (githubUserId: string) => [...byId.values()].find((u) => u.github_user_id === githubUserId) ?? null
    ),
    attachGithubIdentity: vi.fn(async (userId: string, input: { githubUserId: string; githubLogin: string }) => {
      const row = byId.get(userId)!;
      row.github_user_id = input.githubUserId;
      row.github_login = input.githubLogin;
      return row;
    }),
    findById: vi.fn(async (userId: string) => byId.get(userId) ?? null),
    detachGithubIdentity: vi.fn(async (userId: string) => {
      byId.get(userId)!.github_user_id = null;
    }),
  };
}

describe("GithubLinkService", () => {
  it("attaches GitHub to the authenticated user", async () => {
    const users = fakeUsers([makeUser()]);
    const service = new GithubLinkService(
      fakeOauthState() as never,
      fakeGithub() as never,
      fakeCipher() as never,
      users as never,
      config
    );

    const started = await service.startLink("user-1");
    const attached = await service.completeLink({ state: started.state, code: "code", cookieState: started.state });

    expect(attached.github_user_id).toBe("gh-1");
    expect(users.attachGithubIdentity).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ githubUserId: "gh-1" })
    );
  });

  it("rejects linking a GitHub account already linked to a different user", async () => {
    const users = fakeUsers([makeUser({ id: "user-1" }), makeUser({ id: "user-2", github_user_id: "gh-1" })]);
    const service = new GithubLinkService(
      fakeOauthState() as never,
      fakeGithub() as never,
      fakeCipher() as never,
      users as never,
      config
    );

    const started = await service.startLink("user-1");

    await expect(
      service.completeLink({ state: started.state, code: "code", cookieState: started.state })
    ).rejects.toMatchObject({ code: "AUTH_GITHUB_ALREADY_LINKED" });
  });

  it("rejects a mismatched cookie state", async () => {
    const users = fakeUsers([makeUser()]);
    const service = new GithubLinkService(
      fakeOauthState() as never,
      fakeGithub() as never,
      fakeCipher() as never,
      users as never,
      config
    );

    const started = await service.startLink("user-1");

    await expect(
      service.completeLink({ state: started.state, code: "code", cookieState: "wrong-cookie" })
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });

  it("rejects a sign-in state replayed against the link callback", async () => {
    const oauthState = fakeOauthState();
    const users = fakeUsers([makeUser()]);
    const service = new GithubLinkService(
      oauthState as never,
      fakeGithub() as never,
      fakeCipher() as never,
      users as never,
      config
    );

    const started = await oauthState.start("signin");

    await expect(
      service.completeLink({ state: started.state, code: "code", cookieState: started.state })
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });

  it("unlinks GitHub when the user has a password", async () => {
    const users = fakeUsers([makeUser({ github_user_id: "gh-1", password_hash: "hashed" })]);
    const service = new GithubLinkService({} as never, {} as never, {} as never, users as never, config);

    await service.unlink("user-1");
    expect(users.detachGithubIdentity).toHaveBeenCalledWith("user-1");
  });

  it("refuses to unlink GitHub when it's the user's only credential", async () => {
    const users = fakeUsers([makeUser({ github_user_id: "gh-1", password_hash: null })]);
    const service = new GithubLinkService({} as never, {} as never, {} as never, users as never, config);

    await expect(service.unlink("user-1")).rejects.toMatchObject({ code: "AUTH_CANNOT_UNLINK_LAST_METHOD" });
  });

  it("rejects unlinking when no GitHub account is connected", async () => {
    const users = fakeUsers([makeUser({ github_user_id: null })]);
    const service = new GithubLinkService({} as never, {} as never, {} as never, users as never, config);

    await expect(service.unlink("user-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
