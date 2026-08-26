import { Injectable } from "@nestjs/common";
import type {
  GraphDependenciesQuery,
  GraphFoldersQuery,
  GraphNeighborsQuery,
  GraphResponse,
  GraphSymbolsQuery,
  TreeQuery,
  TreeResponse,
} from "@aca/contracts";
import { IndexerHttpClient } from "../repositories/indexer-http.client";
import { OwnershipResolver } from "../repositories/ownership-resolver.service";

/**
 * Gateway-side proxy for `indexer`'s tree/graph read APIs
 * (API_GATEWAY_SERVICE_PLAN.md "Public APIs", GRAPH_SERVICE_PLAN.md "APIs").
 * Same ownership-then-proxy shape as RepositoriesService: resolve
 * `userId` -> `repoId` ownership here, then let the internal token asserted
 * downstream stand in for further checks (CODEBASE.md "Authorization model").
 */
@Injectable()
export class GraphService {
  constructor(
    private readonly indexer: IndexerHttpClient,
    private readonly ownership: OwnershipResolver
  ) {}

  async getTree(userId: string, repoId: string, query: TreeQuery): Promise<TreeResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getTree(userId, repoId, query);
  }

  async getFolders(userId: string, repoId: string, query: GraphFoldersQuery): Promise<GraphResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getGraphFolders(userId, repoId, query);
  }

  async getDependencies(userId: string, repoId: string, query: GraphDependenciesQuery): Promise<GraphResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getGraphDependencies(userId, repoId, query);
  }

  async getSymbols(userId: string, repoId: string, query: GraphSymbolsQuery): Promise<GraphResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getGraphSymbols(userId, repoId, query);
  }

  async getNeighbors(
    userId: string,
    repoId: string,
    nodeId: string,
    query: GraphNeighborsQuery
  ): Promise<GraphResponse> {
    await this.ownership.assertOwnership(userId, repoId);
    return this.indexer.getGraphNeighbors(userId, repoId, nodeId, query);
  }
}
