import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";

export interface GithubTokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  /** seconds until accessToken expires, per GitHub App "Expire user authorization tokens" */
  expiresInSeconds: number | null;
  scopes: string[];
}

export interface GithubProfile {
  githubUserId: string;
  githubLogin: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const USER_AGENT = "ai-code-archaeologist";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Talks to the GitHub App OAuth endpoints (AUTH_SERVICE_PLAN.md "GitHub
 * App, not an OAuth App"). Never logs a code, token, or raw GitHub response
 * that might contain one (RULES.md #13).
 */
@Injectable()
export class GithubOAuthService {
  constructor(@Inject(APP_CONFIG) private readonly config: ApiEnv) {}

  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.GITHUB_APP_CLIENT_ID);
    url.searchParams.set("redirect_uri", this.config.GITHUB_CALLBACK_URL);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  exchangeCodeForToken(code: string, codeVerifier: string): Promise<GithubTokenExchangeResult> {
    return this.postTokenExchange({
      client_id: this.config.GITHUB_APP_CLIENT_ID,
      client_secret: this.config.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: this.config.GITHUB_CALLBACK_URL,
      code_verifier: codeVerifier,
    });
  }

  /** Transparent refresh for `POST /internal/github/token` when the stored access token is near expiry. */
  refreshToken(refreshToken: string): Promise<GithubTokenExchangeResult> {
    return this.postTokenExchange({
      client_id: this.config.GITHUB_APP_CLIENT_ID,
      client_secret: this.config.GITHUB_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async postTokenExchange(body: Record<string, string>): Promise<GithubTokenExchangeResult> {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": USER_AGENT },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AppError("OAUTH_EXCHANGE_FAILED", "Could not reach GitHub to complete sign-in.");
    }

    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok || !parsed || typeof parsed.access_token !== "string" || parsed.error) {
      throw new AppError("OAUTH_EXCHANGE_FAILED", "GitHub rejected the token exchange.");
    }

    return {
      accessToken: parsed.access_token,
      refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token : null,
      expiresInSeconds: typeof parsed.expires_in === "number" ? parsed.expires_in : null,
      scopes: typeof parsed.scope === "string" && parsed.scope.length > 0 ? parsed.scope.split(",") : [],
    };
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    let response: Response;
    try {
      response = await fetch(`${this.config.GITHUB_API_BASE_URL}/user`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": USER_AGENT,
        },
      });
    } catch {
      throw new AppError("OAUTH_EXCHANGE_FAILED", "Could not reach GitHub to load your profile.");
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError("GITHUB_ACCESS_DENIED", "GitHub declined access to your profile.");
    }
    if (!response.ok) {
      throw new AppError("OAUTH_EXCHANGE_FAILED", "GitHub returned an unexpected error while signing in.");
    }

    const body = (await response.json()) as {
      id: number;
      login: string;
      email: string | null;
      name: string | null;
      avatar_url: string | null;
    };

    return {
      githubUserId: String(body.id),
      githubLogin: body.login,
      email: body.email,
      displayName: body.name,
      avatarUrl: body.avatar_url,
    };
  }
}
