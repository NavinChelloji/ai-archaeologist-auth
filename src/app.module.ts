import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "./config/config.module";
import { InfraModule } from "./shared/infra.module";
import { HealthModule } from "./shared/health/health.module";
import { AllExceptionsFilter } from "./shared/errors/all-exceptions.filter";
import { InternalModule } from "./internal/internal.module";
import { SystemModule } from "./modules/system/system.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RepositoriesModule } from "./modules/repositories/repositories.module";
import { GraphModule } from "./modules/graph/graph.module";
import { ChatModule } from "./modules/chat/chat.module";

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    HealthModule,
    InternalModule,
    SystemModule,
    AuthModule,
    RepositoriesModule,
    GraphModule,
    ChatModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
