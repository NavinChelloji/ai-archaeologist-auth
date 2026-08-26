import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { InternalModule } from "../../internal/internal.module";
import { AuthModule } from "../auth/auth.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { AiHttpClient } from "./ai-http.client";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [ConfigModule, InternalModule, AuthModule, RepositoriesModule],
  controllers: [ChatController],
  providers: [ChatService, AiHttpClient],
})
export class ChatModule {}
