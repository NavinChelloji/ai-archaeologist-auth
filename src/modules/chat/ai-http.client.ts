import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  AppError,
  ERROR_CODES,
  type ConversationDto,
  type ConversationsListResponse,
  type ErrorCode,
  type MessagesListResponse,
} from "@aca/contracts";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";
import { InternalTokenService } from "../../internal/internal-token.service";

const USER_AGENT = "ai-code-archaeologist";
const KNOWN_CODES = new Set<string>(ERROR_CODES);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

/**
 * Typed HTTP client for `ai`'s `/internal/{repositories/:repoId/conversations,conversations}/*`
 * routes (API_GATEWAY_SERVICE_PLAN.md "Internal token service and typed HTTP
 * clients for indexer and ai"). `streamMessage` is not a JSON round trip
 * like the others — it pipes `ai`'s SSE response straight through to the
 * browser (CHAT_SERVICE_PLAN.md "Chat is synchronous and streamed": `web` ->
 * `api` (SSE passthrough) -> `ai` (SSE)).
 */
@Injectable()
export class AiHttpClient {
  constructor(
    private readonly internalTokens: InternalTokenService,
    @Inject(APP_CONFIG) private readonly config: ApiEnv
  ) {}

  createConversation(userId: string, repoId: string, title?: string): Promise<ConversationDto> {
    return this.request(
      "POST",
      `/internal/repositories/${repoId}/conversations`,
      { sub: userId, repoId, scope: ["chat:write"] },
      { userId, title }
    );
  }

  listConversations(userId: string, repoId: string, cursor: string | undefined, pageSize: number): Promise<ConversationsListResponse> {
    const params = new URLSearchParams({ userId, pageSize: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    return this.request("GET", `/internal/repositories/${repoId}/conversations?${params}`, { sub: userId, repoId, scope: ["chat:read"] });
  }

  listMessages(userId: string, conversationId: string, cursor: string | undefined, pageSize: number): Promise<MessagesListResponse> {
    const params = new URLSearchParams({ userId, pageSize: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    return this.request("GET", `/internal/conversations/${conversationId}/messages?${params}`, { sub: userId, scope: ["chat:read"] });
  }

  /**
   * Streams `ai`'s SSE response straight through to `reply`. Headers are
   * only written after the upstream call resolves successfully — if `ai`'s
   * own pre-flight (ownership/quota) rejects the request, that arrives here
   * as a normal non-200 JSON error *before* any byte has been sent to the
   * browser, so it still surfaces as a real HTTP status rather than a
   * broken stream (same discipline as JobEventsStreamService).
   */
  async streamMessage(userId: string, conversationId: string, content: string, reply: FastifyReply): Promise<void> {
    const token = this.internalTokens.issue({ iss: "api", aud: "ai", sub: userId, scope: ["chat:write"] });
    const abortController = new AbortController();

    let upstream: Response;
    try {
      upstream = await fetch(`${this.config.AI_SERVICE_URL}/internal/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({ userId, content }),
        signal: abortController.signal,
      });
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Could not reach the chat service.");
    }

    if (!upstream.ok || !upstream.body) {
      const parsed = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = isErrorCode(parsed?.error?.code) ? parsed.error.code : "DEPENDENCY_UNAVAILABLE";
      throw new AppError(code, parsed?.error?.message ?? "The chat service could not complete this request.");
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": this.config.PUBLIC_APP_URL,
      "access-control-allow-credentials": "true",
      vary: "origin",
    });

    reply.raw.on("close", () => abortController.abort());

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } finally {
      reply.raw.end();
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    tokenInput: { sub: string; repoId?: string; scope: string[] },
    body?: unknown
  ): Promise<T> {
    const token = this.internalTokens.issue({ iss: "api", aud: "ai", ...tokenInput });

    let response: Response;
    try {
      response = await fetch(`${this.config.AI_SERVICE_URL}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": USER_AGENT,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Could not reach the chat service.");
    }

    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = isErrorCode(parsed?.error?.code) ? parsed.error.code : "DEPENDENCY_UNAVAILABLE";
      throw new AppError(code, parsed?.error?.message ?? "The chat service could not complete this request.");
    }

    return (await response.json()) as T;
  }
}
