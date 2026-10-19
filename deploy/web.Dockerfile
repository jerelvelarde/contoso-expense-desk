# syntax=docker/dockerfile:1
#
# Expense Desk dashboard: Vite build of web/ served by deploy/web/server.mjs.
# Build context is the REPO ROOT (web/ imports ../seed/*.json):
#
#   docker build -f deploy/web.Dockerfile -t expense-desk-web \
#     --build-arg VITE_SHOW_DEMO_CONTROLS=true .
#   docker run --rm -p 4630:8080 expense-desk-web
#
# Every VITE_* build arg is inlined into the public JavaScript bundle.
# Never pass a secret as a VITE_* value. Runtime settings (basic auth, agent
# proxy) are plain env vars read by server.mjs; see deploy/README.md.

FROM node:24-alpine AS build
WORKDIR /src

COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix web --no-audit --no-fund

COPY seed/ seed/
COPY web/ web/

# Demo mode: leave VITE_COPILOTKIT_RUNTIME_URL unset (scripted agent, no backend)
# and set VITE_SHOW_DEMO_CONTROLS=true. Live mode: VITE_COPILOTKIT_RUNTIME_URL=/copilotkit.
# On Railway, service variables with these names are passed in automatically.
ARG VITE_COPILOTKIT_RUNTIME_URL
ARG VITE_COPILOTKIT_LICENSE_KEY
ARG VITE_INTELLIGENCE_DASHBOARD_URL
ARG VITE_SHOW_DEMO_CONTROLS
RUN npm --prefix web run build

COPY deploy/web/precompress.mjs deploy/web/precompress.mjs
RUN node deploy/web/precompress.mjs web/dist


FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY deploy/web/server.mjs ./server.mjs
COPY --from=build /src/web/dist ./dist
USER node
EXPOSE 8080
# Railway uses its own health check (/healthz, set on the service); this one is for plain Docker.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "server.mjs"]
