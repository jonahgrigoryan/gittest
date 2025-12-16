# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20.17.0
ARG PNPM_VERSION=9.0.0

FROM node:${NODE_VERSION}-bullseye AS builder
ARG WORKSPACE="@poker-bot/orchestrator"
ARG PNPM_VERSION=9.0.0
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Avoid signature lookup issues by pinning pnpm explicitly.
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY config ./config
COPY proto ./proto
COPY services ./services
COPY tools ./tools

RUN pnpm install --frozen-lockfile
RUN pnpm --filter "$WORKSPACE" run build
RUN pnpm deploy --filter "$WORKSPACE" --prod /opt/deploy

FROM node:${NODE_VERSION}-slim AS runner
ARG WORKSPACE
ARG START_COMMAND="node dist/main.js"
ARG GIT_SHA="dev"
ARG BUILD_TS="unknown"
ENV NODE_ENV=production
ENV APP_HOME=/app
ENV APP_WORKSPACE="$WORKSPACE"
ENV APP_START="$START_COMMAND"
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/deploy/ ./
COPY infra/docker/scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

LABEL org.opencontainers.image.source="https://github.com/jonahgrigoryan/gittest" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_TS" \
      org.opencontainers.image.title="poker-bot-$WORKSPACE"

VOLUME ["/config", "/results", "/logs", "/cache"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
