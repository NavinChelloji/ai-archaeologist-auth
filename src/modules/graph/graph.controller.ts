import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  GraphDependenciesQuerySchema,
  GraphFoldersQuerySchema,
  GraphNeighborsQuerySchema,
  GraphSymbolsQuerySchema,
  TreeQuerySchema,
  type GraphDependenciesQuery,
  type GraphFoldersQuery,
  type GraphNeighborsQuery,
  type GraphResponse,
  type GraphSymbolsQuery,
  type TreeQuery,
  type TreeResponse,
} from "@aca/contracts";
import { AccessTokenGuard, type RequestWithUser } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe";
import { GraphService } from "./graph.service";

/**
 * Public file-tree and folder/dependency/symbol graph browsing surface
 * (API_GATEWAY_SERVICE_PLAN.md "Public APIs"). Every route requires a
 * signed-in user and proxies to `indexer`'s internal graph module — the
 * browser never reaches `indexer` directly.
 */
@Controller("api/v1/repositories")
@UseGuards(AccessTokenGuard)
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get(":repoId/tree")
  async getTree(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Query(new ZodValidationPipe(TreeQuerySchema)) query: TreeQuery
  ): Promise<TreeResponse> {
    return this.graph.getTree(request.userId as string, repoId, query);
  }

  @Get(":repoId/graph/folders")
  async getFolders(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Query(new ZodValidationPipe(GraphFoldersQuerySchema)) query: GraphFoldersQuery
  ): Promise<GraphResponse> {
    return this.graph.getFolders(request.userId as string, repoId, query);
  }

  @Get(":repoId/graph/dependencies")
  async getDependencies(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Query(new ZodValidationPipe(GraphDependenciesQuerySchema)) query: GraphDependenciesQuery
  ): Promise<GraphResponse> {
    return this.graph.getDependencies(request.userId as string, repoId, query);
  }

  @Get(":repoId/graph/symbols")
  async getSymbols(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Query(new ZodValidationPipe(GraphSymbolsQuerySchema)) query: GraphSymbolsQuery
  ): Promise<GraphResponse> {
    return this.graph.getSymbols(request.userId as string, repoId, query);
  }

  @Get(":repoId/graph/nodes/:nodeId/neighbors")
  async getNeighbors(
    @Req() request: RequestWithUser,
    @Param("repoId") repoId: string,
    @Param("nodeId") nodeId: string,
    @Query(new ZodValidationPipe(GraphNeighborsQuerySchema)) query: GraphNeighborsQuery
  ): Promise<GraphResponse> {
    return this.graph.getNeighbors(request.userId as string, repoId, nodeId, query);
  }
}
