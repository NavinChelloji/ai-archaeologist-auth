import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  ERROR_CODES,
  type ErrorCode,
  type GraphDependenciesQuery,
  type GraphFoldersQuery,
  type GraphNeighborsQuery,
  type GraphResponse,
  type GraphSymbolsQuery,
  type InternalImportRepositoryRequest,
  type InternalImportRepositoryResponse,
  type InternalRepositoryOwnershipResponse,
  type ProcessingJobDto,
  type RepositoriesListResponse,
  type RepositoryDto,
  type TreeQuery,
  type TreeResponse,
} from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { InternalTokenService } from "../../internal/internal-token.service";

const USER_AGENT = "ai-code-archaeologist";
const KNOWN_CODES = new Set<string>(ERROR_CODES);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

/** Re-serializes an already Zod-parsed query object (numbers, booleans) back to a query string for the forwarded request — `indexer` re-validates it against the same schema. */
function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
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

  /** Fast, synchronous soft-delete (DATA_RETENTION_AND_PRIVACY.md "Repository deletion" step 1) — the caller publishes `repo.deleted` for the rest of the cascade right after this returns. */
  deleteRepository(userId: string, repoId: string): Promise<{ status: "deleting" }> {
    return this.request("DELETE", `/internal/repositories/${repoId}`, { sub: userId, repoId, scope: ["repo:write"] });
  }

  getTree(userId: string, repoId: string, query: TreeQuery): Promise<TreeResponse> {
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/tree${toQueryString(query)}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  getGraphFolders(userId: string, repoId: string, query: GraphFoldersQuery): Promise<GraphResponse> {
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/graph/folders${toQueryString(query)}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  getGraphDependencies(userId: string, repoId: string, query: GraphDependenciesQuery): Promise<GraphResponse> {
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/graph/dependencies${toQueryString(query)}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  getGraphSymbols(userId: string, repoId: string, query: GraphSymbolsQuery): Promise<GraphResponse> {
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/graph/symbols${toQueryString(query)}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  getGraphNeighbors(
    userId: string,
    repoId: string,
    nodeId: string,
    query: GraphNeighborsQuery
  ): Promise<GraphResponse> {
    return this.request(
      "GET",
      `/internal/repositories/${repoId}/graph/nodes/${nodeId}/neighbors${toQueryString(query)}`,
      { sub: userId, repoId, scope: ["repo:read"] }
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
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
