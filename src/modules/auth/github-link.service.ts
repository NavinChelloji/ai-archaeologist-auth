import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { GithubOAuthService } from "./github-oauth.service";
import { OauthStateService } from "./oauth-state.service";
import { TokenCipherService } from "./token-cipher.service";
import { UsersRepository, type UserRow } from "./users.repository";

export interface StartLinkResult {
  authorizeUrl: string;
  state: string;
  stateTtlSeconds: number;
}

export interface CompleteLinkInput {
  state: string;
  code: string;
  cookieState: string | undefined;
}

/**
 * Attaches a GitHub identity to an already-authenticated user — distinct
 * from GitHub sign-in (`AuthService`), which creates or signs into an
 * account by `github_user_id` (AUTH_SERVICE_PLAN.md "GitHub linking vs.
 * sign-in").
 */
@Injectable()
export class GithubLinkService {
  constructor(
    private readonly oauthState: OauthStateService,
    private readonly github: GithubOAuthService,
    private readonly cipher: TokenCipherService,
    private readonly users: UsersRepository,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async startLink(userId: string): Promise<StartLinkResult> {
    const attempt = await this.oauthState.start("link", userId);
    return {
      authorizeUrl: this.github.buildAuthorizeUrl(attempt.state, attempt.codeChallenge),
      state: attempt.state,
      stateTtlSeconds: this.config.OAUTH_STATE_TTL_SECONDS,
    };
  }

  async completeLink(input: CompleteLinkInput): Promise<UserRow> {
    if (!input.cookieState || input.cookieState !== input.state) {
      throw new AppError("OAUTH_STATE_INVALID", "This connection attempt could not be verified. Please try again.");
    }

    const stateData = await this.oauthState.consume(input.state);
    if (stateData.mode !== "link" || !stateData.linkUserId) {
      throw new AppError("OAUTH_STATE_INVALID", "This connection attempt could not be verified. Please try again.");
    }

    const exchange = await this.github.exchangeCodeForToken(input.code, stateData.codeVerifier);
    const profile = await this.github.fetchProfile(exchange.accessToken);

    const existing = await this.users.findByGithubUserId(profile.githubUserId);
    if (existing && existing.id !== stateData.linkUserId) {
      throw new AppError("AUTH_GITHUB_ALREADY_LINKED", "This GitHub account is already linked to a different user.");
    }

    const encryptedAccess = this.cipher.encrypt(exchange.accessToken);
    const encryptedRefresh = exchange.refreshToken ? this.cipher.encrypt(exchange.refreshToken) : null;
    const tokenExpiresAt =
      exchange.expiresInSeconds === null ? null : new Date(Date.now() + exchange.expiresInSeconds * 1000);

    return this.users.attachGithubIdentity(stateData.linkUserId, {
      githubUserId: profile.githubUserId,
      githubLogin: profile.githubLogin,
      avatarUrl: profile.avatarUrl,
      encryptedAccessToken: encryptedAccess.ciphertext,
      encryptedRefreshToken: encryptedRefresh?.ciphertext ?? null,
      tokenExpiresAt,
      keyVersion: encryptedAccess.keyVersion,
      githubScopes: exchange.scopes,
    });
  }

  /** Rejected with `AUTH_CANNOT_UNLINK_LAST_METHOD` when the user has no password — GitHub would otherwise be their only way back in. */
  async unlink(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (!user.github_user_id) {
      throw new AppError("CONFLICT", "No GitHub account is connected.");
    }
    if (!user.password_hash) {
      throw new AppError(
        "AUTH_CANNOT_UNLINK_LAST_METHOD",
        "Set a password before disconnecting GitHub, or you won't be able to sign in."
      );
    }

    await this.users.detachGithubIdentity(userId);
  }
}
