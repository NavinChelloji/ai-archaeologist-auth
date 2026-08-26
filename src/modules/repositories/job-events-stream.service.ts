import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type Redis from "ioredis";
import { AppError, JobProgressEventSchema, type JobProgressEvent, type ProcessingJobDto } from "@aca/contracts";
import type { Logger } from "@aca/logger";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { APP_LOGGER, REDIS_CLIENT } from "../../shared/infra.module";
import { IndexerHttpClient } from "./indexer-http.client";
import { OwnershipResolver } from "./ownership-resolver.service";

function progressChannel(repoId: string): string {
  return `progress:${repoId}`;
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toProgressEvent(job: ProcessingJobDto): JobProgressEvent {
  return {
    repoId: job.repoId,
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    progressPercent: job.progressPercent,
    message: job.message,
    errorCode: job.errorCode,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * `GET /api/v1/repositories/:repoId/events` — indexing progress over SSE.
 * `indexer` publishes to Redis Pub/Sub on `progress:{repoId}`; every `api`
 * replica subscribes and forwards to whichever clients it holds
 * (API_GATEWAY_SERVICE_PLAN.md "SSE fan-out across replicas" — this must be
 * Pub/Sub, not a queue job, or multi-replica delivery silently drops
 * updates for whichever replica isn't holding the message).
 *
 * Reconnection: Redis Pub/Sub has no replay, so instead of trying to honour
 * `Last-Event-ID` we always push the *current* job snapshot the moment a
 * client (re)connects — a client that missed messages while disconnected is
 * caught up by this alone, and it's honest rather than reconstructing a
 * history that was never durably queued.
 */
@Injectable()
export class JobEventsStreamService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: ApiEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly ownership: OwnershipResolver,
    private readonly indexer: IndexerHttpClient
  ) {}

  async stream(userId: string, repoId: string, reply: FastifyReply): Promise<void> {
    await this.ownership.assertOwnership(userId, repoId);

    // Fetched *before* any header is written: this can throw (most notably
    // JOB_NOT_FOUND — an expected race right after import, before the
    // pipeline has created the processing_jobs row yet). Once headers are
    // sent, NestJS's exception filter can no longer set a status code, so
    // anything that can fail must be resolved before `writeHead` below —
    // getting this order wrong crashes the whole process with
    // ERR_HTTP_HEADERS_SENT, not just this one request.
    let initialJob: ProcessingJobDto | null = null;
    try {
      initialJob = await this.indexer.getLatestJob(userId, repoId);
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== "JOB_NOT_FOUND") {
        throw err;
      }
      // No job yet — open the stream anyway and wait for the first publish.
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      // @fastify/cors stages its headers on the Fastify `reply` wrapper
      // (reply.header(...)) and only flushes them when Fastify's own
      // reply.send() pipeline runs. Writing straight to reply.raw for SSE
      // bypasses that pipeline entirely, so this route's CORS headers have
      // to be set by hand here — set globally in main.ts, mirrored here.
      "access-control-allow-origin": this.config.PUBLIC_APP_URL,
      "access-control-allow-credentials": "true",
      vary: "origin",
    });

    // Everything below runs after headers are committed, so nothing here
    // may throw an AppError expecting the exception filter to handle it —
    // any failure must be swallowed and logged instead.
    try {
      if (initialJob) {
        this.write(reply, toProgressEvent(initialJob));
        if (isTerminal(initialJob.status)) {
          reply.raw.end();
          return;
        }
      }

      const channel = progressChannel(repoId);
      const subscriber = this.redis.duplicate();
      await subscriber.subscribe(channel);

      const onMessage = (fromChannel: string, message: string): void => {
        if (fromChannel !== channel) return;
        this.handleMessage(reply, subscriber, message);
      };
      subscriber.on("message", onMessage);

      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, this.config.SSE_HEARTBEAT_SECONDS * 1000);
      heartbeat.unref();

      const cleanup = (): void => {
        clearInterval(heartbeat);
        subscriber.off("message", onMessage);
        subscriber.quit().catch((quitErr: unknown) => this.logger.warn({ err: quitErr, repoId }, "error closing SSE Redis subscriber"));
      };

      reply.raw.on("close", cleanup);
    } catch (err) {
      this.logger.error({ err, repoId }, "SSE stream setup failed after headers were sent");
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }

  /** Called from a Redis event-listener callback — must never throw synchronously, or it crashes the process, not just this request. */
  private handleMessage(reply: FastifyReply, subscriber: Redis, raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.logger.warn({ err }, "dropped an unparseable progress event");
      return;
    }

    const parsed = JobProgressEventSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, "dropped a malformed progress event");
      return;
    }

    this.write(reply, parsed.data);

    if (isTerminal(parsed.data.status)) {
      subscriber.quit().catch(() => undefined);
      reply.raw.end();
    }
  }

  private write(reply: FastifyReply, event: JobProgressEvent): void {
    reply.raw.write(`id: ${randomUUID()}\n`);
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
