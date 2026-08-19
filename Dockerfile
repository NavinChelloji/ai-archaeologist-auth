# Built from the repository root: `docker build -f services/ai-archaeologist-auth/Dockerfile .`
# Uses turbo's prune recipe so the build context and layer cache stay
# scoped to @aca/ai-archaeologist-auth and the workspace packages it
# actually depends on (WORKSPACE_AND_PACKAGE_STRATEGY.md "Use turbo prune
# --scope to produce a minimal build context per service"). This is
# CODEBASE.md's `api` deployable. Hardening (non-root distroless base,
# multi-arch, etc.) lands in Stage 11.

FROM node:20-slim AS base
RUN corepack enable && npm install -g turbo@^2.3.3
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @aca/ai-archaeologist-auth --docker

FROM base AS installer
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@aca/ai-archaeologist-auth

FROM node:20-slim AS runner
WORKDIR /repo
RUN groupadd --system --gid 1001 aca && useradd --system --uid 1001 --gid aca aca
COPY --from=installer /repo .
USER aca
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "services/ai-archaeologist-auth/dist/main.js"]
