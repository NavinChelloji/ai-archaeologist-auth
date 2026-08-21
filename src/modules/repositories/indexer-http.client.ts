import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  ERROR_CODES,
  type ErrorCode,
  type InternalImportRepositoryRequest,
  type InternalImportRepositoryResponse,
  type InternalRepositoryOwnershipResponse,
  type ProcessingJobDto,
  type RepositoriesListResponse,
  type RepositoryDto,
} from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { InternalTokenService } from "../../internal/internal-token.service";

const USER_AGENT = "ai-code-archaeologist";
const KNOWN_CODES = new Set<string>(ERROR_CODES);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

/**
 * Typed HTTP client for `indexer`'s `/internal/repositories/*` routes
 * (API_GATEWAY_SERVICE_PLAN.md "Internal token service and typed HTTP
 * clients for indexer and ai"). Mints a fresh, short-lived internal token
 * per call — ownership is resolved once here in the Gateway and asserted
 * downstream via that token's claims (CODEBASE.md "Authorization model").
 */
@Injectable()
export class IndexerHttpClient {
  constructor(
    private readonly internalTokens: InternalTokenService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  importRepository(userId: string, body: InternalImportRepositoryRequest): Promise<InternalImportRepositoryResponse> {
    return this.request("POST", "/internal/repositories/import", { sub: userId, scope: ["repo:write"] }, body);
  }

  getRepository(userId: string, repoId: string): Promise<RepositoryDto> {
    return this.request("GET", `/internal/repositories/${repoId}`, { sub: userId, repoId, scope: ["repo:read"] });
  }

  listRepositories(userId: string, cursor: string | undefined, pageSize: number): Promise<RepositoriesListResponse> {
    const params = new URLSearchParams({ ownerUserId: userId, pageSize: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    return this.request("GET", `/internal/repositories?${params}`, { sub: userId, scope: ["repo:read"] });
  }

  getLatestJob(userId: string, repoId: string): Promise<ProcessingJobDto> {
    return this.request("GET", `/internal/repositories/${repoId}/job`, { sub: userId, repoId, scope: ["repo:read"] });
  }

  checkOwnership(userId: string, repoId: string): Promise<InternalRepositoryOwnershipResponse> {
    const params = new URLSearchParams({ userId });
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/ownership?${params}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    tokenInput: { sub: string; repoId?: string; scope: string[] },
    body?: unknown
  ): Promise<T> {
    const token = this.internalTokens.issue({ iss: "api", aud: "indexer", ...tokenInput });

    let response: Response;
    try {
      response = await fetch(`${this.config.INDEXER_SERVICE_URL}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": USER_AGENT,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Could not reach the indexing service.");
    }

    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = isErrorCode(parsed?.error?.code) ? parsed.error.code : "DEPENDENCY_UNAVAILABLE";
      throw new AppError(code, parsed?.error?.message ?? "The indexing service could not complete this request.");
    }

    return (await response.json()) as T;
  }
}
