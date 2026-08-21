import { Inject, Injectable } from "@nestjs/common";
import { AppError, type GithubRepositoryDto } from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";

export interface ListGithubRepositoriesInput {
  token: string;
  page: number;
  perPage: number;
  search: string | undefined;
}

export interface ListGithubRepositoriesResult {
  repositories: GithubRepositoryDto[];
  hasNextPage: boolean;
}

const USER_AGENT = "ai-code-archaeologist";

interface GithubRepoResponseItem {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  size: number;
  stargazers_count: number;
  updated_at: string | null;
  html_url: string;
}

function toDto(item: GithubRepoResponseItem): GithubRepositoryDto {
  return {
    providerRepoId: String(item.id),
    name: item.name,
    fullName: item.full_name,
    ownerLogin: item.owner.login,
    private: item.private,
    defaultBranch: item.default_branch,
    description: item.description,
    language: item.language,
    sizeKb: item.size,
    stargazersCount: item.stargazers_count,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url,
  };
}

/**
 * Live GitHub repository listing — never persisted (CODEBASE.md "`api`
 * never persists GitHub repo listings; it lists them live from GitHub").
 * `search` filters within the fetched page only: GitHub's `/user/repos`
 * has no full-text query parameter, and the Search API is a different
 * endpoint with its own, stricter rate limit.
 */
@Injectable()
export class GithubApiClient {
  constructor(@Inject(APP_CONFIG) private readonly config: ApiEnv) {}

  async listForUser(input: ListGithubRepositoriesInput): Promise<ListGithubRepositoriesResult> {
    const url = new URL(`${this.config.GITHUB_API_BASE_URL}/user/repos`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", String(input.perPage));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${input.token}`,
          accept: "application/vnd.github+json",
          "user-agent": USER_AGENT,
        },
      });
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Could not reach GitHub.");
    }

    if (response.status === 403 || response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const remaining = response.headers.get("x-ratelimit-remaining");
      const isRateLimit = response.status === 429 || remaining === "0";
      if (isRateLimit) {
        throw new AppError("GITHUB_RATE_LIMITED", "GitHub rate limit reached. Please try again shortly.", {
          details: retryAfterHeader ? { retryAfterSeconds: Number(retryAfterHeader) } : undefined,
        });
      }
      throw new AppError("GITHUB_ACCESS_DENIED", "GitHub declined access to your repositories.");
    }
    if (response.status === 401) {
      throw new AppError("GITHUB_RECONNECT_REQUIRED", "GitHub is no longer connected for this account.");
    }
    if (!response.ok) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "GitHub returned an unexpected error.");
    }

    const body = (await response.json()) as GithubRepoResponseItem[];
    const search = input.search?.toLowerCase();
    const filtered = search ? body.filter((item) => item.full_name.toLowerCase().includes(search)) : body;

    // GitHub signals more pages via the `Link` header; a full page is the simplest reliable proxy without parsing it.
    const hasNextPage = body.length === input.perPage;

    return { repositories: filtered.map(toDto), hasNextPage };
  }
}
