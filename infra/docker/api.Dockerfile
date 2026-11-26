# ──────────────────────────────────────────────────────────
# FinCore API — Multi-stage Docker build
# ──────────────────────────────────────────────────────────

# ── Stage 1: Dev / Dependencies ──
FROM node:22-alpine AS dev

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build
ENV CI=true

# Copy workspace root files first (dependency resolution)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all workspace packages (matches pnpm-lock.yaml importers)
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/

# Install dependencies cleanly
RUN pnpm install --frozen-lockfile --filter @fincore/api...

# Copy full source & OpenAPI spec
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY docs/openapi.yaml docs/openapi.yaml

# ── Stage 2: Production Builder ──
FROM dev AS builder

RUN pnpm --filter @fincore/contracts run build && \
    pnpm --filter @fincore/api run build

# Prune dev dependencies for production image
RUN pnpm prune --prod

# ── Stage 3: Runner ──
FROM node:22-alpine AS runner

RUN apk update && apk upgrade --no-cache && apk add --no-cache curl tini

# Create non-root user
RUN addgroup -S fincore && adduser -S fincore -G fincore

WORKDIR /app

# Copy built assets, workspace links, contracts, and production dependencies
COPY --from=builder --chown=fincore:fincore /build/node_modules ./node_modules
COPY --from=builder --chown=fincore:fincore /build/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=fincore:fincore /build/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=fincore:fincore /build/apps/api/package.json ./apps/api/
COPY --from=builder --chown=fincore:fincore /build/packages ./packages
COPY --from=builder --chown=fincore:fincore /build/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=builder --chown=fincore:fincore /build/package.json ./

# Switch to non-root user
USER fincore

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/v1/health/live || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
