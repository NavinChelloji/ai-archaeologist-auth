import { Inject, Injectable } from "@nestjs/common";
import type PgBoss from "pg-boss";
import type {
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
import { PG_BOSS } from "../../shared/infra.module";
import { AuthService } from "../auth/auth.service";
import { GithubApiClient } from "./github-api.client";
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
    private readonly auth: AuthService,
    private readonly github: GithubApiClient,
    private readonly indexer: IndexerHttpClient,
    private readonly ownership: OwnershipResolver
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
    const result = await this.indexer.importRepository(userId, {
      ownerUserId: userId,
      provider: "github",
      providerRepoId: body.providerRepoId,
    });

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
}
