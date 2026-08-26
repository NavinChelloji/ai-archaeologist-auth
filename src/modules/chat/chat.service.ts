import { Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type {
  ConversationDto,
  ConversationsListQuery,
  ConversationsListResponse,
  MessagesListQuery,
  MessagesListResponse,
} from "@aca/contracts";
import { OwnershipResolver } from "../repositories/ownership-resolver.service";
import { AiHttpClient } from "./ai-http.client";

/**
 * Gateway-side orchestration for chat (API_GATEWAY_SERVICE_PLAN.md,
 * CHAT_SERVICE_PLAN.md). Conversation *creation* and *listing* are
 * repo-scoped, so they go through the same ownership check as every other
 * `/repositories/:repoId/*` route. Message routes are conversation-scoped —
 * `ai` owns `chat_conversations.user_id` and asserts that ownership itself,
 * so there is no `repoId` here to check against.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiHttpClient,
    private readonly ownership: OwnershipResolver
  ) {}

  async createConversation(userId: string, repoId: string, title?: string): Promise<ConversationDto> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.ai.createConversation(userId, repoId, title);
  }

  async listConversations(userId: string, repoId: string, query: ConversationsListQuery): Promise<ConversationsListResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.ai.listConversations(userId, repoId, query.cursor, query.pageSize);
  }

  listMessages(userId: string, conversationId: string, query: MessagesListQuery): Promise<MessagesListResponse> {
    return this.ai.listMessages(userId, conversationId, query.cursor, query.pageSize);
  }

  streamMessage(userId: string, conversationId: string, content: string, reply: FastifyReply): Promise<void> {
    return this.ai.streamMessage(userId, conversationId, content, reply);
  }
}
