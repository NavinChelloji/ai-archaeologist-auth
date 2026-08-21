import { Body, Controller, HttpCode, Post, Req, Res, UseGuards, UsePipes } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  type ForgotPasswordRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
  type VerifyEmailRequest,
} from "@aca/contracts";
import { serializeCookie } from "../../shared/cookies";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe";
import { AccessTokenGuard, type RequestWithUser } from "./access-token.guard";
import { REFRESH_COOKIE_NAME } from "./auth.constants";
import { EmailVerificationService } from "./email-verification.service";
import { ForgotPasswordRateLimitGuard } from "./forgot-password-rate-limit.guard";
import { LoginRateLimitGuard } from "./login-rate-limit.guard";
import { toUserDto } from "./mappers";
import { PasswordAuthService, type SessionResult } from "./password-auth.service";
import { PasswordResetService } from "./password-reset.service";
import { refreshCookieOptions, requestContext } from "./request-context";
import { SignupRateLimitGuard } from "./signup-rate-limit.guard";
import { UsersRepository } from "./users.repository";

function toSessionResponse(result: SessionResult): SessionResponse {
  return {
    user: toUserDto(result.user),
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
  };
}

/**
 * Email/password as a second, independent identity method alongside GitHub
 * OAuth (adr/0006-email-password-auth.md). Plain JSON endpoints — unlike the
 * GitHub flow, there's no browser redirect to manage.
 */
@Controller("api/v1/auth")
export class PasswordAuthController {
  constructor(
    private readonly passwordAuth: PasswordAuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly users: UsersRepository
  ) {}

  @Post("signup")
  @UseGuards(SignupRateLimitGuard)
  @UsePipes(new ZodValidationPipe(SignupRequestSchema))
  async signup(
    @Body() body: SignupRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SessionResponse> {
    const result = await this.passwordAuth.signup(body.email, body.password, requestContext(request));
    reply.header(
      "set-cookie",
      serializeCookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(result.refreshExpiresAt))
    );
    return toSessionResponse(result);
  }

  @Post("login")
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(LoginRequestSchema))
  async login(
    @Body() body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SessionResponse> {
    const result = await this.passwordAuth.login(body.email, body.password, requestContext(request));
    reply.header(
      "set-cookie",
      serializeCookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(result.refreshExpiresAt))
    );
    return toSessionResponse(result);
  }

  @Post("verify-email")
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(VerifyEmailRequestSchema))
  async verifyEmail(@Body() body: VerifyEmailRequest): Promise<void> {
    await this.emailVerification.verify(body.token);
  }

  /** No-op (still 204) if there's nothing to resend to — doesn't leak account state to its own caller. */
  @Post("resend-verification")
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async resendVerification(@Req() request: RequestWithUser): Promise<void> {
    const user = await this.users.findById(request.userId as string);
    if (user?.email && !user.email_verified_at) {
      await this.emailVerification.sendVerification(user.id, user.email);
    }
  }

  @Post("forgot-password")
  @HttpCode(204)
  @UseGuards(ForgotPasswordRateLimitGuard)
  @UsePipes(new ZodValidationPipe(ForgotPasswordRequestSchema))
  async forgotPassword(@Body() body: ForgotPasswordRequest): Promise<void> {
    await this.passwordReset.requestReset(body.email);
  }

  @Post("reset-password")
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(ResetPasswordRequestSchema))
  async resetPassword(@Body() body: ResetPasswordRequest): Promise<void> {
    await this.passwordReset.reset(body.token, body.newPassword);
  }
}
