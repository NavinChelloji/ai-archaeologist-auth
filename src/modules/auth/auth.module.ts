import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { InternalModule } from "../../internal/internal.module";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { AccessTokenGuard } from "./access-token.guard";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { AuthInternalController } from "./auth.internal.controller";
import { AuthService } from "./auth.service";
import { EmailVerificationService } from "./email-verification.service";
import { EmailVerificationTokensRepository } from "./email-verification-tokens.repository";
import { ForgotPasswordRateLimitGuard } from "./forgot-password-rate-limit.guard";
import { GithubLinkController } from "./github-link.controller";
import { GithubLinkService } from "./github-link.service";
import { GithubOAuthService } from "./github-oauth.service";
import { InternalGithubTokenRateLimitGuard } from "./internal-github-token-rate-limit.guard";
import { LoginRateLimitGuard } from "./login-rate-limit.guard";
import { OauthStateService } from "./oauth-state.service";
import { PasswordAuthController } from "./password-auth.controller";
import { PasswordAuthService } from "./password-auth.service";
import { PasswordHashService } from "./password-hash.service";
import { PasswordResetService } from "./password-reset.service";
import { PasswordResetTokensRepository } from "./password-reset-tokens.repository";
import { RefreshCookieAuthGuard } from "./refresh-cookie-auth.guard";
import { RefreshRateLimitGuard } from "./refresh-rate-limit.guard";
import { RefreshSessionService } from "./refresh-session.service";
import { RefreshSessionsRepository } from "./refresh-sessions.repository";
import { SignupRateLimitGuard } from "./signup-rate-limit.guard";
import { TokenCipherService } from "./token-cipher.service";
import { UsersRepository } from "./users.repository";

@Module({
  imports: [ConfigModule, InternalModule],
  controllers: [AuthController, AuthInternalController, PasswordAuthController, GithubLinkController],
  providers: [
    AuthService,
    GithubOAuthService,
    OauthStateService,
    TokenCipherService,
    UsersRepository,
    RefreshSessionsRepository,
    RefreshSessionService,
    AccessTokenService,
    AccessTokenGuard,
    RateLimitService,
    RefreshRateLimitGuard,
    InternalGithubTokenRateLimitGuard,
    PasswordHashService,
    EmailVerificationTokensRepository,
    PasswordResetTokensRepository,
    EmailVerificationService,
    PasswordResetService,
    PasswordAuthService,
    LoginRateLimitGuard,
    SignupRateLimitGuard,
    ForgotPasswordRateLimitGuard,
    GithubLinkService,
    RefreshCookieAuthGuard,
  ],
  exports: [AuthService, AccessTokenGuard, AccessTokenService],
})
export class AuthModule {}
