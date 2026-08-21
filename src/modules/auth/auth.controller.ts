import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, type AuthMeResponse, type RefreshResponse } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { expireCookie, parseCookies, serializeCookie } from "../../shared/cookies";
import { AccessTokenGuard, type RequestWithUser } from "./access-token.guard";
import { AuthService } from "./auth.service";
import { AUTH_COOKIE_PATH, OAUTH_STATE_COOKIE_NAME, REFRESH_COOKIE_NAME } from "./auth.constants";
import { RefreshRateLimitGuard } from "./refresh-rate-limit.guard";
import { oauthStateCookieOptions, refreshCookieOptions, requestContext } from "./request-context";

/**
 * Public auth surface (AUTH_SERVICE_PLAN.md "APIs"). The callback never
 * returns JSON — it always redirects the browser, success or failure, so
 * the browser is never left sitting on an API URL.
 */
@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  @Get("github/start")
  async start(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const result = await this.auth.startOAuth();
    reply.header(
      "set-cookie",
      serializeCookie(OAUTH_STATE_COOKIE_NAME, result.state, oauthStateCookieOptions(result.stateTtlSeconds))
    );
    reply.redirect(result.authorizeUrl, 302);
  }

  @Get("github/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<void> {
    const cookieState = parseCookies(request.headers.cookie)[OAUTH_STATE_COOKIE_NAME];
    reply.header("set-cookie", expireCookie(OAUTH_STATE_COOKIE_NAME, AUTH_COOKIE_PATH));

    if (!code || !state) {
      reply.redirect(`${this.config.PUBLIC_APP_URL}/login?error=OAUTH_STATE_INVALID`, 302);
      return;
    }

    try {
      const result = await this.auth.completeOAuth({
        state,
        code,
        cookieState,
        context: requestContext(request),
      });
      reply.header(
        "set-cookie",
        serializeCookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(result.refreshExpiresAt))
      );
      reply.redirect(`${this.config.PUBLIC_APP_URL}/auth/callback`, 302);
    } catch (err) {
      const errorCode = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      reply.redirect(`${this.config.PUBLIC_APP_URL}/login?error=${errorCode}`, 302);
    }
  }

  @Post("refresh")
  @UseGuards(RefreshRateLimitGuard)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RefreshResponse> {
    const presented = parseCookies(request.headers.cookie)[REFRESH_COOKIE_NAME];
    const result = await this.auth.refresh(presented, requestContext(request));
    reply.header(
      "set-cookie",
      serializeCookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(result.refreshExpiresAt))
    );
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const presented = parseCookies(request.headers.cookie)[REFRESH_COOKIE_NAME];
    await this.auth.logout(presented);
    reply.header("set-cookie", expireCookie(REFRESH_COOKIE_NAME, AUTH_COOKIE_PATH));
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: RequestWithUser): Promise<AuthMeResponse> {
    const user = await this.auth.getUser(request.userId as string);
    return { user };
  }
}
