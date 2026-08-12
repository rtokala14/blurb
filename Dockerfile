# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# One image: Bun serves the API and the built SPA from a single process.
# ---------------------------------------------------------------------------

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
# Only the manifests, so this layer is reused until dependencies actually change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
# Produces dist/client (SPA) and dist/server/index.js (self-contained bundle:
# every dependency is inlined, so the runtime stage needs no node_modules).
RUN bun run build

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIR=/app/dist/client

COPY --from=build --chown=bun:bun /app/dist ./dist

USER bun
EXPOSE 3000

# Liveness only — readiness (which checks the database) is a separate endpoint
# for the orchestrator to poll.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --eval "process.exit((await fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/api/health')).ok ? 0 : 1)"

# Bun handles SIGTERM directly and the server drains in-flight requests, so no
# init shim is needed.
CMD ["bun", "dist/server/index.js"]
