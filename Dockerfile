# syntax=docker/dockerfile:1.7
# dikw-web production image: serves the built SPA and Pi-Agent sidecar from a
# single Node process. The server is bundled into one .mjs (no node_modules at
# runtime). LLM credentials and optional web-tool keys are injected via
# environment variables. Connects to an external dikw-core whose URL is
# supplied per request by the browser (Settings page).

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DIKW_WEB_HOST=0.0.0.0 \
    DIKW_WEB_PORT=4321 \
    DIKW_WEB_STATIC_DIR=/app/dist \
    DIKW_AGENT_SESSIONS_DIR=/data/agent-sessions
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server/standalone.mjs ./dist-server/standalone.mjs
# Runtime does not invoke npm; the server is a single esbuild bundle. Removing
# the global npm tree drops ~10MB and eliminates CVEs that ship with the base
# image's bundled package manager (e.g. picomatch ReDoS in npm@latest).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && mkdir -p /data/agent-sessions \
 && chown -R node:node /data/agent-sessions /app
USER node
EXPOSE 4321
VOLUME ["/data/agent-sessions"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4321/agent/sessions >/dev/null 2>&1 || exit 1
CMD ["node", "dist-server/standalone.mjs"]
