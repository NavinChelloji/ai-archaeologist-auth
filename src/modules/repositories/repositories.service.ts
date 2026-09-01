import { Inject, Injectable } from "@nestjs/common";
import type PgBoss from "pg-boss";
import { AppError } from "@aca/contracts";
import type {
  DeleteRepositoryResponse,
  GithubRepositoriesQuery,
  GithubRepositoriesResponse,
  ImportRepositoryRequest,
  ImportRepositoryResponse,
  ProcessingJobDto,
  RepositoriesListQuery,
  RepositoriesListResponse,
  RepositoryDto,
} from "@aca/contracts";
import { publishJob } from "@aca/queue";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { PG_BOSS } from "../../shared/infra.module";
import { AuthService } from "../auth/auth.service";
import { GithubApiClient } from "./github-api.client";
import { ImportUsageRepository } from "./import-usage.repository";
import { IndexerHttpClient } from "./indexer-http.client";
import { OwnershipResolver } from "./ownership-resolver.service";

/**
 * Gateway-side orchestration for repository browsing and import
 * (API_GATEWAY_SERVICE_PLAN.md). Composes the in-process Auth module (for a
 * user's GitHub token) with `indexer`'s internal HTTP surface.
 */
@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(APP_CONFIG) private readonly config: ApiEnv,
    private readonly auth: AuthService,
    private readonly github: GithubApiClient,
    private readonly indexer: IndexerHttpClient,
    private readonly ownership: OwnershipResolver,
    private readonly importUsage: ImportUsageRepository
  ) {}

  async listGithubRepositories(userId: string, query: GithubRepositoriesQuery): Promise<GithubRepositoriesResponse> {
    const { token } = await this.auth.getInternalGithubToken(userId);
    const result = await this.github.listForUser({
      token,
      page: query.page,
      perPage: query.perPage,
      search: query.search,
    });

    return { repositories: result.repositories, page: query.page, perPage: query.perPage, hasNextPage: result.hasNextPage };
  }

  /**
   * Registers the repository with `indexer` (minting `repoId` if new), then
   * enqueues `repo.import.requested` to start the pipeline
   * (API_GATEWAY_SERVICE_PLAN.md "Jobs Enqueued", CODEBASE.md "Repository
   * Indexing Pipeline" step 2). `correlationId` is the originating HTTP
   * request's id, copied through the whole pipeline from here on.
   */
  async importRepository(
    userId: string,
    body: ImportRepositoryRequest,
    correlationId: string
  ): Promise<ImportRepositoryResponse> {
    const importsThisMonth = await this.importUsage.countForUserThisMonth(userId);
    if (importsThisMonth >= this.config.QUOTA_IMPORTS_PER_MONTH) {
      throw new AppError("QUOTA_IMPORTS", "Monthly import budget exhausted.", {
        details: { limit: this.config.QUOTA_IMPORTS_PER_MONTH },
      });
    }

    const result = await this.indexer.importRepository(userId, {
      ownerUserId: userId,
      provider: "github",
      providerRepoId: body.providerRepoId,
    });
    await this.importUsage.record(userId, result.repoId);

    await publishJob(this.boss, {
      eventType: "repo.import.requested",
      payload: {
        provider: "github",
        providerRepoId: body.providerRepoId,
        fullName: result.fullName,
        defaultBranch: result.defaultBranch,
        isPrivate: result.isPrivate,
        ref: null,
        // A re-import of an already-registered repository re-triggers the pipeline as a reindex, not a fresh import.
        reindex: !result.created,
      },
      correlationId,
      userId,
      repoId: result.repoId,
    });

    return result;
  }

  listRepositories(userId: string, query: RepositoriesListQuery): Promise<RepositoriesListResponse> {
    return this.indexer.listRepositories(userId, query.cursor, query.pageSize);
  }

  async getRepository(userId: string, repoId: string): Promise<RepositoryDto> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getRepository(userId, repoId);
  }

  async getLatestJob(userId: string, repoId: string): Promise<ProcessingJobDto> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getLatestJob(userId, repoId);
  }

  /**
   * `DELETE /api/v1/repositories/:repoId` (DATA_RETENTION_AND_PRIVACY.md
   * "Repository deletion"). Soft-deletes synchronously so the repository
   * disappears from the user's list immediately, then publishes
   * `repo.deleted` for the asynchronous cascade in `indexer` and `ai`.
   */
  async deleteRepository(userId: string, repoId: string, correlationId: string): Promise<DeleteRepositoryResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    await this.indexer.deleteRepository(userId, repoId);
    await this.ownership.invalidate(userId, repoId);

    await publishJob(this.boss, {
      eventType: "repo.deleted",
      payload: { repoId, reason: "user_request" },
      correlationId,
      userId,
      repoId,
    });

    return { repoId, status: "deleting" };
  }
}
