# =============================================================================
# LifeOps MCP server — production image.
#
# Multi-stage build: install deps + compile TS in a builder image, then copy
# only the compiled JS and production node_modules into a slim final image.
#
# AgentCore Runtime requires the server to listen on 0.0.0.0:8000 at /mcp.
# The container ENTRYPOINT respects that by default.
#
# NOTE: better-sqlite3 has a native module. We use node:22-slim (glibc) not
# node:22-alpine (musl) so that the prebuilt binaries load without recompiling.
# =============================================================================

# ---------- Stage 1: build ----------
FROM node:22-slim AS builder

WORKDIR /build

# Copy package manifests first so the layer caches when only source changes.
COPY package.json package-lock.json* ./
COPY services/mcp-server/package.json ./services/mcp-server/
COPY apps/web/package.json ./apps/web/

# Install ALL deps (dev + prod) so we can compile TS.
# --ignore-scripts prevents postinstalls from network-blocked hosts in CI.
RUN npm ci --workspaces --include-workspace-root --no-audit --no-fund

# Copy sources.
COPY services/mcp-server ./services/mcp-server

# Compile TypeScript.
RUN npm --workspace services/mcp-server run build

# ---------- Stage 2: production ----------
FROM node:22-slim AS runtime

# Install tini so signals propagate cleanly for a clean shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Create an unprivileged runtime user.
RUN groupadd --system --gid 1001 lifeops \
 && useradd  --system --uid 1001 --gid lifeops --create-home lifeops

WORKDIR /app

# Copy the compiled server and its production node_modules.
COPY --from=builder /build/services/mcp-server/dist        ./services/mcp-server/dist
COPY --from=builder /build/services/mcp-server/package.json ./services/mcp-server/
COPY --from=builder /build/package.json                     ./
COPY --from=builder /build/node_modules                     ./node_modules

# Data dir owned by the runtime user; in AWS this would be a mounted EFS/
# volume, in AgentCore Runtime it's ephemeral.
RUN mkdir -p /app/services/mcp-server/data \
 && chown -R lifeops:lifeops /app

USER lifeops

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    MCP_PATH=/mcp \
    DATABASE_URL=file:/app/services/mcp-server/data/lifeops.db \
    DEMO_MODE=true \
    LOG_LEVEL=info

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+ (process.env.PORT||8000) +'/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "services/mcp-server/dist/index.js"]
