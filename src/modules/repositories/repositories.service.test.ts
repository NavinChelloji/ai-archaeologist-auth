import { describe, expect, it, vi } from "vitest";
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
  };
}

function fakeOwnership() {
  return { assertOwnership: vi.fn(async () => undefined) };
}

function fakeBoss() {
  return { send: vi.fn(async () => "queue-job-id") };
}

const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("RepositoriesService (gateway)", () => {
  it("fetches a fresh GitHub token before listing repositories", async () => {
    const auth = fakeAuth();
    const github = fakeGithub();
    const service = new RepositoriesService(fakeBoss() as never, auth as never, github as never, fakeIndexer() as never, fakeOwnership() as never);

    const result = await service.listGithubRepositories("user-1", { page: 1, perPage: 30, search: undefined });

    expect(auth.getInternalGithubToken).toHaveBeenCalledWith("user-1");
    expect(github.listForUser).toHaveBeenCalledWith({ token: "gh-token", page: 1, perPage: 30, search: undefined });
    expect(result.repositories).toHaveLength(1);
  });

  it("forwards the authenticated user as ownerUserId on import, ignoring any client-supplied identity", async () => {
    const indexer = fakeIndexer();
    const service = new RepositoriesService(fakeBoss() as never, fakeAuth() as never, fakeGithub() as never, indexer as never, fakeOwnership() as never);

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(indexer.importRepository).toHaveBeenCalledWith("user-1", {
      ownerUserId: "user-1",
      provider: "github",
      providerRepoId: "999",
    });
  });

  it("enqueues repo.import.requested with the originating request's correlationId after registering the repo", async () => {
    const boss = fakeBoss();
    const indexer = fakeIndexer();
    const service = new RepositoriesService(boss as never, fakeAuth() as never, fakeGithub() as never, indexer as never, fakeOwnership() as never);

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
    const boss = fakeBoss();
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
    const service = new RepositoriesService(boss as never, fakeAuth() as never, fakeGithub() as never, indexer as never, fakeOwnership() as never);

    await service.importRepository("user-1", { providerRepoId: "999" }, CORRELATION_ID);

    expect(boss.send).toHaveBeenCalledWith(
      "repo.import.requested",
      expect.objectContaining({ payload: expect.objectContaining({ reindex: true }) }),
      {}
    );
  });

  it("checks ownership before fetching a single repository", async () => {
    const ownership = fakeOwnership();
    const indexer = fakeIndexer();
    const service = new RepositoriesService(fakeBoss() as never, fakeAuth() as never, fakeGithub() as never, indexer as never, ownership as never);

    await service.getRepository("user-1", "repo-1");

    expect(ownership.assertOwnership).toHaveBeenCalledWith("user-1", "repo-1");
    expect(indexer.getRepository).toHaveBeenCalledWith("user-1", "repo-1");
  });

  it("checks ownership before fetching the latest job", async () => {
    const ownership = fakeOwnership();
    const indexer = fakeIndexer();
    const service = new RepositoriesService(fakeBoss() as never, fakeAuth() as never, fakeGithub() as never, indexer as never, ownership as never);

    const job = await service.getLatestJob("user-1", "repo-1");

    expect(ownership.assertOwnership).toHaveBeenCalledWith("user-1", "repo-1");
    expect(indexer.getLatestJob).toHaveBeenCalledWith("user-1", "repo-1");
    expect(job.stage).toBe("parsing");
  });
});
