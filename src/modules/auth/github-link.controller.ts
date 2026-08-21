import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { expireCookie, parseCookies, serializeCookie } from "../../shared/cookies";
import { AccessTokenGuard, type RequestWithUser } from "./access-token.guard";
import { AUTH_COOKIE_PATH, OAUTH_STATE_COOKIE_NAME } from "./auth.constants";
import { GithubLinkService } from "./github-link.service";
import { RefreshCookieAuthGuard } from "./refresh-cookie-auth.guard";
import { oauthStateCookieOptions } from "./request-context";

/**
 * Connecting/disconnecting GitHub for an already-authenticated user —
 * distinct from `AuthController`'s `github/start`/`callback`, which sign a
 * user in (AUTH_SERVICE_PLAN.md "GitHub linking vs. sign-in").
 */
@Controller("api/v1/auth/github")
export class GithubLinkController {
  constructor(
    private readonly links: GithubLinkService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  @Get("link/start")
  @UseGuards(RefreshCookieAuthGuard)
  async startLink(@Req() request: RequestWithUser, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const result = await this.links.startLink(request.userId as string);
    reply.header(
      "set-cookie",
      serializeCookie(OAUTH_STATE_COOKIE_NAME, result.state, oauthStateCookieOptions(result.stateTtlSeconds))
    );
    reply.redirect(result.authorizeUrl, 302);
  }

  @Get("link/callback")
  async linkCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<void> {
    const cookieState = parseCookies(request.headers.cookie)[OAUTH_STATE_COOKIE_NAME];
    reply.header("set-cookie", expireCookie(OAUTH_STATE_COOKIE_NAME, AUTH_COOKIE_PATH));

    if (!code || !state) {
      reply.redirect(`${this.config.PUBLIC_APP_URL}/settings?error=OAUTH_STATE_INVALID`, 302);
      return;
    }

    try {
      await this.links.completeLink({ state, code, cookieState });
      reply.redirect(`${this.config.PUBLIC_APP_URL}/settings?linked=github`, 302);
    } catch (err) {
      const errorCode = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      reply.redirect(`${this.config.PUBLIC_APP_URL}/settings?error=${errorCode}`, 302);
    }
  }

  @Post("unlink")
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async unlink(@Req() request: RequestWithUser): Promise<void> {
    await this.links.unlink(request.userId as string);
  }
}
