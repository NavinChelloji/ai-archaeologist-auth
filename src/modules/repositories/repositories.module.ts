import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { InternalModule } from "../../internal/internal.module";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { AuthModule } from "../auth/auth.module";
import { GithubApiClient } from "./github-api.client";
import { ImportRateLimitGuard } from "./import-rate-limit.guard";
import { ImportUsageRepository } from "./import-usage.repository";
import { IndexerHttpClient } from "./indexer-http.client";
import { JobEventsStreamService } from "./job-events-stream.service";
import { OwnershipResolver } from "./ownership-resolver.service";
import { RepositoriesController } from "./repositories.controller";
import { RepositoriesService } from "./repositories.service";
import { SseAuthGuard } from "./sse-auth.guard";

@Module({
  imports: [ConfigModule, InternalModule, AuthModule],
  controllers: [RepositoriesController],
  providers: [
    RepositoriesService,
    GithubApiClient,
    IndexerHttpClient,
    OwnershipResolver,
    ImportUsageRepository,
    ImportRateLimitGuard,
    RateLimitService,
    JobEventsStreamService,
    SseAuthGuard,
  ],
  exports: [IndexerHttpClient, OwnershipResolver],
})
export class RepositoriesModule {}
