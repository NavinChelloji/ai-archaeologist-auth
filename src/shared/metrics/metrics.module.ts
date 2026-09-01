import { Global, Module } from "@nestjs/common";
import { createHttpMetrics, createMetricsRegistry, type HttpMetrics, type Registry } from "@aca/metrics";
import { MetricsController } from "./metrics.controller";
import { HTTP_METRICS, METRICS_REGISTRY } from "./metrics.tokens";

export { HTTP_METRICS, METRICS_REGISTRY };

/**
 * `GET /metrics` and the metric objects every other module observes into
 * (RULES.md #15 "Metrics for HTTP latency and error rate"). Global, like
 * `InfraModule`. `api` has no queues or LLM/embedding providers of its own —
 * queue depth lives with `indexer`, provider metrics with `ai`.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: METRICS_REGISTRY, useFactory: (): Registry => createMetricsRegistry("api") },
    { provide: HTTP_METRICS, inject: [METRICS_REGISTRY], useFactory: (r: Registry): HttpMetrics => createHttpMetrics(r) },
  ],
  exports: [METRICS_REGISTRY, HTTP_METRICS],
})
export class MetricsModule {}
