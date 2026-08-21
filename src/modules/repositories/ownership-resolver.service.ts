import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { AppError } from "@aca/contracts";
import { REDIS_CLIENT } from "../../shared/infra.module";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { IndexerHttpClient } from "./indexer-http.client";

/**
 * Resolves `userId` -> `repoId` ownership once here, cached 60s in Redis
 * (API_GATEWAY_SERVICE_PLAN.md "Resolve `userId` -> `repoId` ownership,
 * cached in Redis for 60 seconds"). `indexer` never re-checks ownership —
 * it trusts the internal token this Gateway mints after this check passes.
 */
@Injectable()
export class OwnershipResolver {
  constructor(
    private readonly indexer: IndexerHttpClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  /** Throws `REPO_FORBIDDEN` for both "not yours" and "no such repository" — never lets the two be told apart (RULES.md #13). */
  async assertOwnership(userId: string, repoId: string): Promise<void> {
    const cacheKey = `ownership:${userId}:${repoId}`;
    const cached = await this.redis.get(cacheKey);

    if (cached !== null) {
      if (cached === "1") return;
      throw new AppError("REPO_FORBIDDEN", "You do not have access to this repository.");
    }

    const { owns } = await this.indexer.checkOwnership(userId, repoId);
    await this.redis.set(cacheKey, owns ? "1" : "0", "EX", this.config.OWNERSHIP_CACHE_TTL_SECONDS);

    if (!owns) {
      throw new AppError("REPO_FORBIDDEN", "You do not have access to this repository.");
    }
  }
}
