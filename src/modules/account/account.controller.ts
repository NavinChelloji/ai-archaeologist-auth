import { Controller, Delete, HttpCode, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { expireCookie } from "../../shared/cookies";
import { AccessTokenGuard, type RequestWithUser } from "../auth/access-token.guard";
import { AUTH_COOKIE_PATH, REFRESH_COOKIE_NAME } from "../auth/auth.constants";
import { AccountService } from "./account.service";

/** Public account-deletion surface (DATA_RETENTION_AND_PRIVACY.md "Account deletion"). */
@Controller("api/v1/account")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Delete()
  @UseGuards(AccessTokenGuard)
  @HttpCode(204)
  async deleteAccount(@Req() request: RequestWithUser, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.account.deleteAccount(request.userId as string, request.correlationId);
    reply.header("set-cookie", expireCookie(REFRESH_COOKIE_NAME, AUTH_COOKIE_PATH));
  }
}
