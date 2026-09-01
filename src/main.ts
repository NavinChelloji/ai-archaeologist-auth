import "reflect-metadata";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyCors from "@fastify/cors";
import type { HttpMetrics } from "@aca/metrics";
import { AppModule } from "./app.module";
import { loadApiEnv } from "./config/env";
import { HTTP_METRICS } from "./shared/metrics/metrics.module";

config();

const CORRELATION_ID_HEADER = "x-correlation-id";

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  // Registered on the raw Fastify instance, not via Nest's `app.register()`
  // wrapper — its plugin typings don't line up with Nest's FastifyInstance
  // generic instantiation, a known friction point with Nest+Fastify plugins.
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRequest", async (request, reply) => {
    const header = request.headers[CORRELATION_ID_HEADER];
    request.correlationId = typeof header === "string" && header.length > 0 ? header : randomUUID();
    reply.header(CORRELATION_ID_HEADER, request.correlationId);
  });

  await fastify.register(fastifyCors, {
    origin: env.PUBLIC_APP_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  const httpMetrics = app.get<HttpMetrics>(HTTP_METRICS);
  fastify.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    httpMetrics.requestsTotal.inc(labels);
    httpMetrics.requestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`api listening on :${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error("api failed to start", err);
  process.exit(1);
});
