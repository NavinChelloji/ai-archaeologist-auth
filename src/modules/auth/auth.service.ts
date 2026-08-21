import { Inject, Injectable } from "@nestjs/common";
import { AppError, type UserDto } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { AccessTokenService } from "./access-token.service";
import { GithubOAuthService } from "./github-oauth.service";
import { OauthStateService } from "./oauth-state.service";
import { RefreshSessionService, type RequestContext } from "./refresh-session.service";
import { TokenCipherService } from "./token-cipher.service";
import { UsersRepository, type UserRow } from "./users.repository";
import { toUserDto } from "./mappers";

export interface StartOAuthResult {
  authorizeUrl: string;
  state: string;
  stateTtlSeconds: number;
}

export interface CompleteOAuthResult {
  user: UserRow;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface InternalGithubToken {
  token: string;
  expiresAt: Date | null;
}

function expiresAtFromSeconds(seconds: number | null): Date | null {
  return seconds === null ? null : new Date(Date.now() + seconds * 1000);
}

/**
 * Orchestrates the GitHub OAuth flow, token issuance, and internal token
 * hand-off. Controllers stay HTTP-only concerns (cookies, redirects);
 * everything decision-worthy lives here (RULES.md #1: "keep business logic
 * out of controllers").
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly oauthState: OauthStateService,
    private readonly github: GithubOAuthService,
    private readonly cipher: TokenCipherService,
    private readonly users: UsersRepository,
    private readonly refreshSessions: RefreshSessionService,
    private readonly accessTokens: AccessTokenService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  async startOAuth(): Promise<StartOAuthResult> {
    const attempt = await this.oauthState.start();
    return {
      authorizeUrl: this.github.buildAuthorizeUrl(attempt.state, attempt.codeChallenge),
      state: attempt.state,
      stateTtlSeconds: this.config.OAUTH_STATE_TTL_SECONDS,
    };
  }

  async completeOAuth(input: {
    state: string;
    code: string;
    cookieState: string | undefined;
    context: RequestContext;
  }): Promise<CompleteOAuthResult> {
    if (!input.cookieState || input.cookieState !== input.state) {
      throw new AppError("OAUTH_STATE_INVALID", "This sign-in attempt could not be verified. Please try again.");
    }

    const stateData = await this.oauthState.consume(input.state);
    if (stateData.mode !== "signin") {
      throw new AppError("OAUTH_STATE_INVALID", "This sign-in attempt could not be verified. Please try again.");
    }

    const exchange = await this.github.exchangeCodeForToken(input.code, stateData.codeVerifier);
    const profile = await this.github.fetchProfile(exchange.accessToken);

    const encryptedAccess = this.cipher.encrypt(exchange.accessToken);
    const encryptedRefresh = exchange.refreshToken ? this.cipher.encrypt(exchange.refreshToken) : null;

    const user = await this.users.upsertByGithubUserId({
      githubUserId: profile.githubUserId,
      githubLogin: profile.githubLogin,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      encryptedAccessToken: encryptedAccess.ciphertext,
      encryptedRefreshToken: encryptedRefresh?.ciphertext ?? null,
      tokenExpiresAt: expiresAtFromSeconds(exchange.expiresInSeconds),
      keyVersion: encryptedAccess.keyVersion,
      githubScopes: exchange.scopes,
    });

    const issuedRefresh = await this.refreshSessions.issue(user.id, input.context);

    return { user, refreshToken: issuedRefresh.token, refreshExpiresAt: issuedRefresh.expiresAt };
  }

  async refresh(presentedToken: string | undefined, context: RequestContext): Promise<RefreshResult> {
    if (!presentedToken) {
      throw new AppError("AUTH_REFRESH_INVALID", "Your session is no longer valid. Please sign in again.");
    }

    const rotated = await this.refreshSessions.rotate(presentedToken, context);
    const access = this.accessTokens.issue(rotated.userId);

    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (presentedToken) {
      await this.refreshSessions.revoke(presentedToken);
    }
  }

  async getUser(userId: string): Promise<UserDto> {
    const row = await this.users.findById(userId);
    if (!row) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    return toUserDto(row);
  }

  /** `POST /internal/github/token` — decrypts and, when near expiry, transparently refreshes. */
  async getInternalGithubToken(userId: string): Promise<InternalGithubToken> {
    const row = await this.users.findById(userId);
    if (!row) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (row.disconnected_at) {
      throw new AppError("GITHUB_RECONNECT_REQUIRED", "GitHub is no longer connected for this account.");
    }
    // adr/0006-email-password-auth.md: GitHub is no longer required to have
    // an account, so a user can reach this point with no connection at all.
    if (!row.encrypted_access_token) {
      throw new AppError("GITHUB_RECONNECT_REQUIRED", "GitHub is not connected for this account.");
    }

    const marginMs = this.config.TOKEN_REFRESH_MARGIN_SECONDS * 1000;
    const nearExpiry = row.token_expires_at !== null && row.token_expires_at.getTime() - Date.now() < marginMs;

    if (!nearExpiry) {
      const token = this.cipher.decrypt({ ciphertext: row.encrypted_access_token, keyVersion: row.key_version });
      return { token, expiresAt: row.token_expires_at };
    }

    return this.refreshGithubToken(row);
  }

  private async refreshGithubToken(row: UserRow): Promise<InternalGithubToken> {
    if (!row.encrypted_refresh_token) {
      throw new AppError("GITHUB_RECONNECT_REQUIRED", "GitHub access expired and cannot be refreshed automatically.");
    }

    const refreshToken = this.cipher.decrypt({
      ciphertext: row.encrypted_refresh_token,
      keyVersion: row.key_version,
    });

    let exchange;
    try {
      exchange = await this.github.refreshToken(refreshToken);
    } catch {
      throw new AppError("GITHUB_RECONNECT_REQUIRED", "GitHub access expired and could not be refreshed.");
    }

    const encryptedAccess = this.cipher.encrypt(exchange.accessToken);
    const encryptedRefresh = exchange.refreshToken ? this.cipher.encrypt(exchange.refreshToken) : null;
    const expiresAt = expiresAtFromSeconds(exchange.expiresInSeconds);

    await this.users.updateEncryptedTokens(row.id, {
      encryptedAccessToken: encryptedAccess.ciphertext,
      encryptedRefreshToken: encryptedRefresh?.ciphertext ?? row.encrypted_refresh_token,
      tokenExpiresAt: expiresAt,
      keyVersion: encryptedAccess.keyVersion,
    });

    return { token: exchange.accessToken, expiresAt };
  }
}
