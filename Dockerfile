# syntax=docker/dockerfile:1.7
# dikw-web production image: serves the built SPA and the Pi-Agent + web sidecar
# from a single Node process. Since the ADK migration the server bundle
# (dist-server/standalone.mjs) is built with esbuild --packages=external, so it
# imports its dependencies (@google/adk, @mikro-orm/sqlite, native sqlite3,
# @opentelemetry/*, @anthropic-ai/sdk, undici, ...) from node_modules at RUNTIME
# — ADK cannot be bundled (dynamic driver import() + native addons). The runtime
# image therefore ships a production node_modules with a working native sqlite3.
#
# Base image: node:24-slim (Debian glibc) for every stage. sqlite3's N-API
# prebuilts are reliably published for glibc (no compile / no build toolchain),
# and a single libc across builder + runtime guarantees the native .node loads.
# LLM credentials and optional web-tool keys are injected via environment
# variables. Connects to an external dikw-core whose URL is supplied per request
# by the browser (Settings page).

# --- Builder: full install + build (dist/ + dist-server/standalone.mjs) -------
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# --- Production deps: prune devDeps, keep native sqlite3 built for Debian -----
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --omit=dev drops vite/esbuild/playwright/etc.; package.json `overrides`
# (node-gyp, tar) are honored by npm ci and clear the HIGH npm-audit CVEs. The
# native sqlite3 addon is fetched/built here for the same Debian glibc the
# runtime stage uses.
RUN npm ci --omit=dev

# --- Runtime: built SPA + server bundle + production node_modules -------------
FROM node:24-slim AS runtime
WORKDIR /app
# Apply Debian security updates so OS-package CVEs in the base image (e.g.
# libgnutls30 lagging the bookworm-security patch) don't fail the Trivy
# HIGH/CRITICAL scan or ship in the image. Runs before USER node (needs root).
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*
# The runtime only ever runs `node dist-server/standalone.mjs` (and the node-based
# HEALTHCHECK) — npm is never invoked here. node:24-slim bundles npm with an
# undici < 6.27.0 (CVE-2026-12151, WebSocket fragment-count DoS) that Trivy flags
# as a shipped vulnerable file even though it's unreachable at runtime. `npm i -g
# npm@latest` does NOT clear it (latest npm still bundles undici 6.26.0); removing
# npm/npx does, and keeps future npm-bundled-dep CVEs out of the image entirely.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production \
    DIKW_WEB_HOST=0.0.0.0 \
    DIKW_WEB_PORT=4321 \
    DIKW_WEB_STATIC_DIR=/app/dist \
    DIKW_AGENT_SESSIONS_DIR=/data/agent-sessions
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server/standalone.mjs ./dist-server/standalone.mjs
COPY --from=prod-deps /app/node_modules ./node_modules
# package.json is required at runtime: Node ESM reads "type":"module" and uses it
# to resolve the bare imports inside standalone.mjs.
COPY package.json ./package.json
RUN mkdir -p /data/agent-sessions \
 && chown -R node:node /data/agent-sessions /app
USER node
EXPOSE 4321
VOLUME ["/data/agent-sessions"]
# node:24-slim ships neither wget nor curl; probe with the always-present node.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/agent/sessions').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/standalone.mjs"]
