import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  ConversationsListQuerySchema,
  CreateConversationRequestSchema,
  MessagesListQuerySchema,
  SendMessageRequestSchema,
  type ConversationDto,
  type ConversationsListQuery,
  type ConversationsListResponse,
  type CreateConversationRequest,
  type MessagesListQuery,
  type MessagesListResponse,
  type SendMessageRequest,
} from "@aca/contracts";
import { AccessTokenGuard, type RequestWithUser } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe";
import { ChatService } from "./chat.service";

/**
 * Public chat surface (API_GATEWAY_SERVICE_PLAN.md "Public APIs"). Every
 * route requires a signed-in user; `ai` is never reached directly by the
 * browser.
 */
@Controller("api/v1")
@UseGuards(AccessTokenGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post("repositories/:repoId/conversations")
  async createConversation(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Body(new ZodValidationPipe(CreateConversationRequestSchema)) body: CreateConversationRequest
  ): Promise<ConversationDto> {
    return this.chat.createConversation(request.userId as string, repoId, body.title);
  }

  @Get("repositories/:repoId/conversations")
  async listConversations(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Query(new ZodValidationPipe(ConversationsListQuerySchema)) query: ConversationsListQuery
  ): Promise<ConversationsListResponse> {
    return this.chat.listConversations(request.userId as string, repoId, query);
  }

  @Get("conversations/:conversationId/messages")
  async listMessages(
    @Req() request: RequestWithUser,
    @Param("conversationId") conversationId: string,
    @Query(new ZodValidationPipe(MessagesListQuerySchema)) query: MessagesListQuery
  ): Promise<MessagesListResponse> {
    return this.chat.listMessages(request.userId as string, conversationId, query);
  }

  /** SSE — this handler owns the response directly (AiHttpClient writes to `reply.raw`), so Nest must not also try to send a return value. */
  @Post("conversations/:conversationId/messages")
  async sendMessage(
    @Req() request: RequestWithUser,
    @Res() reply: FastifyReply,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(SendMessageRequestSchema)) body: SendMessageRequest
  ): Promise<void> {
    await this.chat.streamMessage(request.userId as string, conversationId, body.content, reply);
  }
}
