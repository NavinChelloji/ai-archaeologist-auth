import { Inject, Injectable } from "@nestjs/common";
import type PgBoss from "pg-boss";
import { publishJob } from "@aca/queue";
import { PG_BOSS } from "../../shared/infra.module";
import { AuthService } from "../auth/auth.service";
import { IndexerHttpClient } from "../repositories/indexer-http.client";

const LIST_PAGE_SIZE = 100;

/**
 * Orchestrates `DELETE /api/v1/account`
 * (DATA_RETENTION_AND_PRIVACY.md "Account deletion"). Publishes `repo.deleted`
 * for every one of the user's repositories (reusing the exact same cascade
 * `DELETE /api/v1/repositories/:repoId` triggers) plus one `user.deleted` so
 * `ai` can anonymize `token_usage`, then deletes `api`'s own account data
 * last — if publishing fails partway, the account still exists to retry
 * from, rather than being gone with orphaned repo data left behind.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly auth: AuthService,
    private readonly indexer: IndexerHttpClient
  ) {}

  async deleteAccount(userId: string, correlationId: string): Promise<void> {
    const repoIds = await this.collectAllRepoIds(userId);

    for (const repoId of repoIds) {
      await publishJob(this.boss, {
        eventType: "repo.deleted",
        payload: { repoId, reason: "account_deletion" },
        correlationId,
        userId,
        repoId,
      });
    }

    await publishJob(this.boss, {
      eventType: "user.deleted",
      payload: { userId, repoIds },
      correlationId,
      userId,
    });

    await this.auth.deleteAccount(userId);
  }

  private async collectAllRepoIds(userId: string): Promise<string[]> {
    const repoIds: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.indexer.listRepositories(userId, cursor, LIST_PAGE_SIZE);
      repoIds.push(...page.repositories.map((r) => r.repoId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return repoIds;
  }
}
