import { describe, expect, it, vi } from "vitest";
import { AccountService } from "./account.service";

const REPO_1 = "123e4567-e89b-12d3-a456-426614174000";
const REPO_2 = "123e4567-e89b-12d3-a456-426614174001";
const CORRELATION_ID = "123e4567-e89b-12d3-a456-426614174002";
const USER_ID = "123e4567-e89b-12d3-a456-426614174003";

function repoDto(repoId: string) {
  return {
    repoId,
    fullName: "octocat/hello-world",
    defaultBranch: "main",
    isPrivate: false,
    primaryLanguage: "TypeScript",
    activeSnapshotId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fakeIndexer(pages: { repositories: ReturnType<typeof repoDto>[]; nextCursor: string | null }[]) {
  const listRepositories = vi.fn();
  for (const page of pages) listRepositories.mockResolvedValueOnce(page);
  return { listRepositories };
}

function fakeAuth() {
  return { deleteAccount: vi.fn(async () => undefined) };
}

function fakeBoss() {
  return { send: vi.fn(async () => "queue-job-id") };
}

describe("AccountService.deleteAccount", () => {
  it("publishes repo.deleted for every repo (paging through all of them), then user.deleted, then deletes the api-side account", async () => {
    const indexer = fakeIndexer([
      { repositories: [repoDto(REPO_1)], nextCursor: "cursor-1" },
      { repositories: [repoDto(REPO_2)], nextCursor: null },
    ]);
    const auth = fakeAuth();
    const boss = fakeBoss();
    const service = new AccountService(boss as never, auth as never, indexer as never);

    await service.deleteAccount(USER_ID, CORRELATION_ID);

    expect(indexer.listRepositories).toHaveBeenCalledTimes(2);
    expect(indexer.listRepositories).toHaveBeenNthCalledWith(1, USER_ID, undefined, 100);
    expect(indexer.listRepositories).toHaveBeenNthCalledWith(2, USER_ID, "cursor-1", 100);

    expect(boss.send).toHaveBeenCalledWith(
      "repo.deleted",
      expect.objectContaining({ payload: { repoId: REPO_1, reason: "account_deletion" } }),
      {}
    );
    expect(boss.send).toHaveBeenCalledWith(
      "repo.deleted",
      expect.objectContaining({ payload: { repoId: REPO_2, reason: "account_deletion" } }),
      {}
    );
    expect(boss.send).toHaveBeenCalledWith(
      "user.deleted",
      expect.objectContaining({ payload: { userId: USER_ID, repoIds: [REPO_1, REPO_2] } }),
      {}
    );

    // api's own account data is deleted last, after every deletion job is safely queued.
    expect(auth.deleteAccount).toHaveBeenCalledWith(USER_ID);
    const lastSendCallIndex = boss.send.mock.invocationCallOrder.length - 1;
    expect(auth.deleteAccount.mock.invocationCallOrder[0]).toBeGreaterThan(boss.send.mock.invocationCallOrder[lastSendCallIndex]);
  });

  it("still publishes user.deleted with an empty repoIds list for a user with no repositories", async () => {
    const indexer = fakeIndexer([{ repositories: [], nextCursor: null }]);
    const auth = fakeAuth();
    const boss = fakeBoss();
    const service = new AccountService(boss as never, auth as never, indexer as never);

    await service.deleteAccount(USER_ID, CORRELATION_ID);

    // user.deleted fans out to both indexer's and ai's queues (@aca/queue FANOUT_QUEUES).
    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(
      "user.deleted",
      expect.objectContaining({ payload: { userId: USER_ID, repoIds: [] } }),
      {}
    );
    expect(boss.send).toHaveBeenCalledWith(
      "user.deleted.ai",
      expect.objectContaining({ payload: { userId: USER_ID, repoIds: [] } }),
      {}
    );
  });
});
