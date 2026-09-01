import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { InternalModule } from "../../internal/internal.module";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { AuthModule } from "../auth/auth.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { AiHttpClient } from "./ai-http.client";
import { ChatController } from "./chat.controller";
import { ChatRateLimitGuard } from "./chat-rate-limit.guard";
import { ChatService } from "./chat.service";

@Module({
  imports: [ConfigModule, InternalModule, AuthModule, RepositoriesModule],
  controllers: [ChatController],
  providers: [ChatService, AiHttpClient, RateLimitService, ChatRateLimitGuard],
})
export class ChatModule {}
