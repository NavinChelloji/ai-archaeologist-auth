import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError } from "@aca/contracts";
import { AccessTokenService } from "./access-token.service";

export type RequestWithUser = FastifyRequest & { userId?: string };

const BEARER_PREFIX = "Bearer ";

/** Protects `/auth/me` and every future protected route — rejects unauthenticated requests. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers["authorization"];

    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new AppError("AUTH_REQUIRED", "Sign in to continue.");
    }

    const claims = this.accessTokens.verify(header.slice(BEARER_PREFIX.length));
    request.userId = claims.userId;
    return true;
  }
}
