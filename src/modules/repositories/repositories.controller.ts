import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards, UsePipes } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  GithubRepositoriesQuerySchema,
  ImportRepositoryRequestSchema,
  RepositoriesListQuerySchema,
  type GithubRepositoriesQuery,
  type GithubRepositoriesResponse,
  type ImportRepositoryRequest,
  type ImportRepositoryResponse,
  type ProcessingJobDto,
  type RepositoriesListQuery,
  type RepositoriesListResponse,
  type RepositoryDto,
} from "@aca/contracts";
import { AccessTokenGuard, type RequestWithUser } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe";
import { ImportRateLimitGuard } from "./import-rate-limit.guard";
import { JobEventsStreamService } from "./job-events-stream.service";
import { RepositoriesService } from "./repositories.service";
import { SseAuthGuard } from "./sse-auth.guard";

/**
 * Public repository browsing and import surface
 * (API_GATEWAY_SERVICE_PLAN.md "Public APIs"). Every route requires a
 * signed-in user; `indexer` is never reached directly by the browser.
 *
 * Guards are applied per-method rather than once at the class level so the
 * SSE route can use `SseAuthGuard` (which also accepts the token as a query
 * parameter, since `EventSource` can't set an `Authorization` header)
 * without weakening auth on every other route in this controller.
 */
@Controller("api/v1")
export class RepositoriesController {
  constructor(
    private readonly repositories: RepositoriesService,
    private readonly jobEvents: JobEventsStreamService
  ) {}

  @Get("github/repositories")
  @UseGuards(AccessTokenGuard)
  @UsePipes(new ZodValidationPipe(GithubRepositoriesQuerySchema))
  async listGithubRepositories(
    @Req() request: RequestWithUser,
    @Query() query: GithubRepositoriesQuery
  ): Promise<GithubRepositoriesResponse> {
    return this.repositories.listGithubRepositories(request.userId as string, query);
  }

  @Post("repositories/import")
  @UseGuards(AccessTokenGuard, ImportRateLimitGuard)
  @UsePipes(new ZodValidationPipe(ImportRepositoryRequestSchema))
  async importRepository(
    @Req() request: RequestWithUser,
    @Body() body: ImportRepositoryRequest
  ): Promise<ImportRepositoryResponse> {
    return this.repositories.importRepository(request.userId as string, body, request.correlationId);
  }

  @Get("repositories")
  @UseGuards(AccessTokenGuard)
  @UsePipes(new ZodValidationPipe(RepositoriesListQuerySchema))
  async listRepositories(
    @Req() request: RequestWithUser,
    @Query() query: RepositoriesListQuery
  ): Promise<RepositoriesListResponse> {
    return this.repositories.listRepositories(request.userId as string, query);
  }

  @Get("repositories/:repoId")
  @UseGuards(AccessTokenGuard)
  async getRepository(@Req() request: RequestWithUser, @Param("repoId") repoId: string): Promise<RepositoryDto> {
    return this.repositories.getRepository(request.userId as string, repoId);
  }

  @Get("repositories/:repoId/job")
  @UseGuards(AccessTokenGuard)
  async getLatestJob(@Req() request: RequestWithUser, @Param("repoId") repoId: string): Promise<ProcessingJobDto> {
    return this.repositories.getLatestJob(request.userId as string, repoId);
  }

  /** SSE — this handler owns the response directly (JobEventsStreamService writes to `reply.raw`), so Nest must not also try to send a return value. */
  @Get("repositories/:repoId/events")
  @UseGuards(SseAuthGuard)
  async streamEvents(
    @Req() request: RequestWithUser,
    @Res() reply: FastifyReply,
    @Param("repoId") repoId: string
  ): Promise<void> {
    await this.jobEvents.stream(request.userId as string, repoId, reply);
  }
}
