import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../../config/env";
import { RepositoriesService } from "./repositories.service";

function fakeAuth(token = "gh-token") {
  return { getInternalGithubToken: vi.fn(async () => ({ token, expiresAt: null })) };
}

function fakeGithub() {
  return {
    listForUser: vi.fn(async () => ({
      repositories: [
        {
          providerRepoId: "1",
          name: "hello-world",
          fullName: "octocat/hello-world",
          ownerLogin: "octocat",
          private: false,
          defaultBranch: "main",
          description: null,
          language: "TypeScript",
          sizeKb: 42,
          stargazersCount: 3,
          updatedAt: "2026-01-01T00:00:00.000Z",
          htmlUrl: "https://github.com/octocat/hello-world",
        },
      ],
      hasNextPage: false,
    })),
  };
}

function fakeIndexer() {
  return {
    importRepository: vi.fn(async (_userId: string, _body: { providerRepoId: string }) => ({
      repoId: "repo-1",
      fullName: "octocat/hello-world",
      defaultBranch: "main",
      isPrivate: false,
      primaryLanguage: "TypeScript",
      activeSnapshotId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      created: true,
    })),
    listRepositories: vi.fn(async () => ({ repositories: [], nextCursor: null })),
    getRepository: vi.fn(async () => ({
      repoId: "repo-1",
      fullName: "octocat/hello-world",
      defaultBranch: "main",
      isPrivate: false,
      primaryLanguage: "TypeScript",
      activeSnapshotId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    getLatestJob: vi.fn(async () => ({
      jobId: "job-1",
      repoId: "repo-1",
      snapshotId: null,
      status: "running",
      stage: "parsing",
      progressPercent: 42,
      message: "Parsing symbols and imports: 812 of 1,940",
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    deleteRepository: vi.fn(async () => ({ status: "deleting" as const })),
  };
}

function fakeOwnership() {
  return { assertOwnership: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined) };
}

function fakeBoss() {
  return { send: vi.fn(async () => "queue-job-id") };
}

function fakeImportUsage(importsThisMonth = 0) {
  return { countForUserThisMonth: vi.fn(async () => importsThisMonth), record: vi.fn(async () => undefined) };
}

function config(): ApiEnv {
  return { QUOTA_IMPORTS_PER_MONTH: 30 } as ApiEnv;
}

const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const REPO_ID = "123e4567-e89b-12d3-a456-426614174001";

function buildService(opts: {
  boss?: ReturnType<typeof fakeBoss>;
  auth?: ReturnType<typeof fakeAuth>;
  github?: ReturnType<typeof fakeGithub>;
  indexer?: ReturnType<typeof fakeIndexer>;
  ownership?: ReturnType<typeof fakeOwnership>;
  importUsage?: ReturnType<typeof fakeImportUsage>;
} = {}) {
  const boss = opts.boss ?? fakeBoss();
  const auth = opts.auth ?? fakeAuth();
  const github = opts.github ?? fakeGithub();
  const indexer = opts.indexer ?? fakeIndexer();
  const ownership = opts.ownership ?? fakeOwnership();
  const importUsage = opts.importUsage ?? fakeImportUsage();

  const service = new RepositoriesService(
    boss as never,
    config(),
    auth as never,
    github as never,
    indexer as never,
    ownership as never,
    importUsage as never
  );

  return { service, boss, auth, github, indexer, ownership, importUsage };
}

describe("RepositoriesService (gateway)", () => {
  it("fetches a fresh GitHub token before listing repositories", async () => {
    const { service, auth, github } = buildService();

    const result = await service.listGithubRepositories("user-1", { page: 1, perPage: 30, search: undefined });

    expect(auth.getInternalGithubToken).toHaveBeenCalledWith("user-1");
    expect(github.listForUser).toHaveBeenCalledWith({ token: "gh-token", page: 1, perPage: 30, search: undefined });
    expect(result.repositories).toHaveLength(1);
  });

  it("forwards the authenticated user as ownerUserId on import, ignoring any client-supplied identity", async () => {
    const { service, indexer } = buildService();

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(indexer.importRepository).toHaveBeenCalledWith("user-1", {
      ownerUserId: "user-1",
      provider: "github",
      providerRepoId: "999",
    });
  });

  it("enqueues repo.import.requested with the originating request's correlationId after registering the repo", async () => {
    const { service, boss } = buildService();

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(boss.send).toHaveBeenCalledWith(
      "repo.import.requested",
      expect.objectContaining({
        eventType: "repo.import.requested",
        correlationId: CORRELATION_ID,
        userId: "user-1",
        repoId: "repo-1",
        payload: expect.objectContaining({ providerRepoId: "999", fullName: "octocat/hello-world", reindex: false }),
      }),
      {}
    );
  });

  it("marks the job as a reindex when importing an already-registered repository", async () => {
    const indexer = fakeIndexer();
    indexer.importRepository = vi.fn(async () => ({
      repoId: "repo-1",
      fullName: "octocat/hello-world",
      defaultBranch: "main",
      isPrivate: false,
      primaryLanguage: "TypeScript",
      activeSnapshotId: "snap-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      created: false,
    }));
    const { service, boss } = buildService({ indexer });

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(boss.send).toHaveBeenCalledWith(
      "repo.import.requested",
      expect.objectContaining({ payload: expect.objectContaining({ reindex: true }) }),
      {}
    );
  });

  it("records an import event after a successful import", async () => {
    const { service, importUsage } = buildService();

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(importUsage.countForUserThisMonth).toHaveBeenCalledWith("user-1");
    expect(importUsage.record).toHaveBeenCalledWith("user-1", "repo-1");
  });

  it("rejects import with QUOTA_IMPORTS once the monthly budget is exhausted, without touching indexer or the queue", async () => {
    const { service, indexer, boss, importUsage } = buildService({ importUsage: fakeImportUsage(30) });

    await expect(service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID)).rejects.toThrow();

    expect(indexer.importRepository).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
    expect(importUsage.record).not.toHaveBeenCalled();
  });

  it("checks ownership before fetching a single repository", async () => {
    const { service, ownership, indexer } = buildService();

    await service.getRepository("user-1", "repo-1");

    expect(ownership.assertOwnership).toHaveBeenCalledWith("user-1", "repo-1");
    expect(indexer.getRepository).toHaveBeenCalledWith("user-1", "repo-1");
  });

  it("checks ownership before fetching the latest job", async () => {
    const { service, ownership, indexer } = buildService();

    const job = await service.getLatestJob("user-1", "repo-1");

    expect(ownership.assertOwnership).toHaveBeenCalledWith("user-1", "repo-1");
    expect(indexer.getLatestJob).toHaveBeenCalledWith("user-1", "repo-1");
    expect(job.stage).toBe("parsing");
  });

  it("checks ownership, soft-deletes via indexer, invalidates the ownership cache, and publishes repo.deleted on deletion", async () => {
    const { service, boss, indexer, ownership } = buildService();

    const result = await service.deleteRepository("user-1", REPO_ID, CORRELATION_ID);

    expect(ownership.assertOwnership).toHaveBeenCalledWith("user-1", REPO_ID);
    expect(indexer.deleteRepository).toHaveBeenCalledWith("user-1", REPO_ID);
    expect(ownership.invalidate).toHaveBeenCalledWith("user-1", REPO_ID);
    expect(boss.send).toHaveBeenCalledWith(
      "repo.deleted",
      expect.objectContaining({
        eventType: "repo.deleted",
        correlationId: CORRELATION_ID,
        userId: "user-1",
        repoId: REPO_ID,
        payload: { repoId: REPO_ID, reason: "user_request" },
      }),
      {}
    );
    expect(result).toEqual({ repoId: REPO_ID, status: "deleting" });
  });

  it("rejects deleting another user's repository without touching indexer or the queue", async () => {
    const ownership = {
      assertOwnership: vi.fn(async () => {
        throw new Error("REPO_FORBIDDEN");
      }),
      invalidate: vi.fn(),
    };
    const { service, indexer, boss } = buildService({ ownership: ownership as never });

    await expect(service.deleteRepository("user-2", REPO_ID, CORRELATION_ID)).rejects.toThrow("REPO_FORBIDDEN");

    expect(indexer.deleteRepository).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });
});
