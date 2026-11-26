# ──────────────────────────────────────────────────────────
# FinCore Web (Next.js) — Multi-stage Docker build
# ──────────────────────────────────────────────────────────

# ── Stage 1: Dev / Dependencies ──
FROM node:22-alpine AS dev

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build

# Copy workspace root files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all workspace packages (matches pnpm-lock.yaml importers)
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @fincore/web...

# Copy source
COPY packages/ packages/
COPY apps/web/ apps/web/

# ── Stage 2: Production Builder ──
FROM dev AS builder

ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @fincore/contracts run build && \
    pnpm --filter @fincore/web run build

# ── Stage 3: Runner ──
FROM node:22-alpine AS runner

RUN apk update && apk upgrade --no-cache && apk add --no-cache curl tini && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Create non-root user
RUN addgroup -S fincore && adduser -S fincore -G fincore

WORKDIR /app

# Copy Next.js standalone output
COPY --from=builder --chown=fincore:fincore /build/apps/web/.next/standalone ./
COPY --from=builder --chown=fincore:fincore /build/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=fincore:fincore /build/apps/web/public ./apps/web/public

USER fincore

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/web/server.js"]
