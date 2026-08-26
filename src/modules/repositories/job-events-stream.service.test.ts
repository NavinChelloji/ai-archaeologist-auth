import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@aca/contracts";
import { JobEventsStreamService } from "./job-events-stream.service";

function fakeReply() {
  const raw = new EventEmitter() as EventEmitter & {
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  raw.writeHead = vi.fn();
  raw.write = vi.fn();
  raw.end = vi.fn();
  return { raw } as never;
}

function fakeRedis(subscriber: EventEmitter & { subscribe: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> }) {
  return { duplicate: vi.fn(() => subscriber) } as never;
}

function fakeSubscriber() {
  const sub = new EventEmitter() as EventEmitter & {
    subscribe: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };
  sub.subscribe = vi.fn().mockResolvedValue(undefined);
  sub.quit = vi.fn().mockResolvedValue(undefined);
  return sub;
}

const CONFIG = { SSE_HEARTBEAT_SECONDS: 15, PUBLIC_APP_URL: "http://localhost:5173" } as never;
const LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const JOB_ID = "123e4567-e89b-12d3-a456-426614174000";
const REPO_ID = "123e4567-e89b-12d3-a456-426614174001";

const runningJob = {
  jobId: JOB_ID,
  repoId: REPO_ID,
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
};

describe("JobEventsStreamService", () => {
  it("rejects streaming when the requester doesn't own the repository", async () => {
    const ownership = { assertOwnership: vi.fn().mockRejectedValue(new Error("REPO_FORBIDDEN")) };
    const indexer = { getLatestJob: vi.fn() };
    const service = new JobEventsStreamService(fakeRedis(fakeSubscriber()), CONFIG, LOGGER, ownership as never, indexer as never);

    await expect(service.stream("user-1", REPO_ID, fakeReply())).rejects.toThrow();
    expect(indexer.getLatestJob).not.toHaveBeenCalled();
  });

  it("propagates a non-JOB_NOT_FOUND error from the initial job fetch without writing any headers", async () => {
    // Regression: writeHead used to run before this fetch, so a throw here
    // crashed the whole process with ERR_HTTP_HEADERS_SENT once NestJS's
    // exception filter tried to set a status on an already-committed
    // response — not just fail this one request.
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockRejectedValue(new AppError("DEPENDENCY_UNAVAILABLE", "indexer unreachable")) };
    const service = new JobEventsStreamService(fakeRedis(fakeSubscriber()), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await expect(service.stream("user-1", REPO_ID, reply)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(reply.raw.writeHead).not.toHaveBeenCalled();
  });

  it("opens the stream and waits for updates when no job exists yet (JOB_NOT_FOUND) — the normal race right after import", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockRejectedValue(new AppError("JOB_NOT_FOUND", "no job yet")) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await expect(service.stream("user-1", REPO_ID, reply)).resolves.toBeUndefined();

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "content-type": "text/event-stream" }));
    expect(reply.raw.write).not.toHaveBeenCalled();
    expect(subscriber.subscribe).toHaveBeenCalledWith(`progress:${REPO_ID}`);
  });

  it("writes the current job snapshot immediately on connect, then subscribes for more", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "content-type": "text/event-stream" }));
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining('"stage":"parsing"'));
    expect(subscriber.subscribe).toHaveBeenCalledWith(`progress:${REPO_ID}`);
    expect(reply.raw.end).not.toHaveBeenCalled();
  });

  it("sets CORS headers itself, since writing straight to reply.raw bypasses @fastify/cors's normal reply pipeline", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const service = new JobEventsStreamService(fakeRedis(fakeSubscriber()), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "access-control-allow-origin": "http://localhost:5173",
        "access-control-allow-credentials": "true",
      })
    );
  });

  it("ends the stream without subscribing when the job is already in a terminal state", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue({ ...runningJob, status: "completed", stage: "completed" }) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);

    expect(subscriber.subscribe).not.toHaveBeenCalled();
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("forwards a published progress event to the client and closes on a terminal message", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);

    const completedEvent = {
      repoId: REPO_ID,
      jobId: JOB_ID,
      status: "completed",
      stage: "completed",
      progressPercent: 100,
      message: "Completed",
      errorCode: null,
      occurredAt: "2026-01-01T00:05:00.000Z",
    };

    subscriber.emit("message", `progress:${REPO_ID}`, JSON.stringify(completedEvent));

    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining('"status":"completed"'));
    expect(subscriber.quit).toHaveBeenCalled();
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("drops an unparseable message instead of throwing — a listener throw here would crash the process", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);

    expect(() => subscriber.emit("message", `progress:${REPO_ID}`, "not json")).not.toThrow();
  });

  it("ignores messages from a different repo's channel", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);
    reply.raw.write.mockClear();

    subscriber.emit("message", "progress:some-other-repo", JSON.stringify({ ...runningJob, status: "completed" }));

    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("cleans up the Redis subscriber when the client disconnects", async () => {
    const ownership = { assertOwnership: vi.fn().mockResolvedValue(undefined) };
    const indexer = { getLatestJob: vi.fn().mockResolvedValue(runningJob) };
    const subscriber = fakeSubscriber();
    const service = new JobEventsStreamService(fakeRedis(subscriber), CONFIG, LOGGER, ownership as never, indexer as never);
    const reply = fakeReply();

    await service.stream("user-1", REPO_ID, reply);
    (reply as { raw: EventEmitter }).raw.emit("close");

    expect(subscriber.quit).toHaveBeenCalled();
  });
});
