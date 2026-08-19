import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type PgBoss from "pg-boss";
import { ensureSystemPingQueue, publishSystemPing } from "@aca/queue";
import type { Logger } from "@aca/logger";
import { APP_LOGGER, PG_BOSS } from "../../shared/infra.module";

/**
 * Stage 1 smoke test for the exit criterion "a trivial pg-boss job can be
 * enqueued in api and consumed in indexer" (DEVELOPMENT_STAGES.md Stage 1).
 * Publishes one `system.health.ping` job once this service is up; watch
 * the indexer logs for "received ping" to confirm the queue works
 * end to end. See @aca/queue's systemPing module for why this job is kept
 * out of the documented product job vocabulary.
 */
@Injectable()
export class SystemService implements OnApplicationBootstrap {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(APP_LOGGER) private readonly logger: Logger
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureSystemPingQueue(this.boss);

    const jobId = await publishSystemPing(this.boss, {
      pingId: randomUUID(),
      sentAt: new Date().toISOString(),
      message: "hello from api",
    });

    this.logger.info({ jobId }, "published system.health.ping");
  }
}
