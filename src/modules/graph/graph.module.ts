import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";

@Module({
  imports: [AuthModule, RepositoriesModule],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
