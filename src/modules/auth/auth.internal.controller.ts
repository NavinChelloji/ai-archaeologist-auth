import { Body, Controller, Get, Param, Post, UseGuards, UsePipes } from "@nestjs/common";
import {
  InternalGithubTokenRequestSchema,
  type AuthMeResponse,
  type InternalGithubTokenRequest,
  type InternalGithubTokenResponse,
} from "@aca/contracts";
import { InternalAuthGuard } from "../../internal/internal-auth.guard";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { InternalGithubTokenRateLimitGuard } from "./internal-github-token-rate-limit.guard";

/**
 * `/internal/*` — never routed from the public ingress, always behind
 * InternalAuthGuard (RULES.md #12). Used by `indexer` to obtain a GitHub
 * token for one job, and to resolve a user's public profile.
 */
@Controller("internal")
@UseGuards(InternalAuthGuard)
export class AuthInternalController {
  constructor(private readonly auth: AuthService) {}

  @Post("github/token")
  @UseGuards(InternalGithubTokenRateLimitGuard)
  @UsePipes(new ZodValidationPipe(InternalGithubTokenRequestSchema))
  async githubToken(@Body() body: InternalGithubTokenRequest): Promise<InternalGithubTokenResponse> {
    const result = await this.auth.getInternalGithubToken(body.userId);
    return { token: result.token, expiresAt: result.expiresAt?.toISOString() ?? null };
  }

  @Get("users/:userId")
  async getUser(@Param("userId") userId: string): Promise<AuthMeResponse> {
    const user = await this.auth.getUser(userId);
    return { user };
  }
}
