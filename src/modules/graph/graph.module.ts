import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { AuthModule } from "../auth/auth.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { GraphController } from "./graph.controller";
import { GraphRateLimitGuard } from "./graph-rate-limit.guard";
import { GraphService } from "./graph.service";

@Module({
  imports: [ConfigModule, AuthModule, RepositoriesModule],
  controllers: [GraphController],
  providers: [GraphService, RateLimitService, GraphRateLimitGuard],
})
export class GraphModule {}
