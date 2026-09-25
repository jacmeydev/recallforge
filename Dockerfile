# ============================================================================
# RecallForge — Production Dockerfile
# ============================================================================
# Multi-stage build: Next.js standalone output + better-sqlite3 (compiled in the build stages).
# Usage:
#   docker build -t recallforge .
#   docker run -p 3030:3030 -v rf-data:/app/data -e AUTH_SECRET=... recallforge
#   Agents connect to http://<host>:3030/api/mcp (MCP) or /api/v1 (REST).
# ============================================================================

FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN AUTH_SECRET=build-placeholder-secret AUTH_TRUST_HOST=true npm run build

# ── Production ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3030

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Data directory for SQLite (mount as volume)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs

EXPOSE 3030

CMD ["node", "server.js"]
