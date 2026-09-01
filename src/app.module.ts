import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./config/config.module";
import { InfraModule } from "./shared/infra.module";
import { HealthModule } from "./shared/health/health.module";
import { MetricsModule } from "./shared/metrics/metrics.module";
import { AllExceptionsFilter } from "./shared/errors/all-exceptions.filter";
import { DefaultRateLimitGuard } from "./shared/rate-limit/default-rate-limit.guard";
import { RateLimitService } from "./shared/rate-limit/rate-limit.service";
import { InternalModule } from "./internal/internal.module";
import { SystemModule } from "./modules/system/system.module";
import { AccountModule } from "./modules/account/account.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RepositoriesModule } from "./modules/repositories/repositories.module";
import { GraphModule } from "./modules/graph/graph.module";
import { ChatModule } from "./modules/chat/chat.module";

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    HealthModule,
    MetricsModule,
    InternalModule,
    SystemModule,
    AuthModule,
    RepositoriesModule,
    GraphModule,
    ChatModule,
    AccountModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    RateLimitService,
    { provide: APP_GUARD, useClass: DefaultRateLimitGuard },
  ],
})
export class AppModule {}
