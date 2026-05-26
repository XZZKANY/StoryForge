# syntax=docker/dockerfile:1.7

# ---------- Stage 1: deps ----------
# Install workspace dependencies with pnpm using the lockfile from the repo root.
# The build context must be the repository root so the lockfile and workspace
# packages are visible.
FROM node:20-alpine AS deps

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@storyforge/web..."

# ---------- Stage 2: builder ----------
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NEXT_TELEMETRY_DISABLED=1 \
    STORYFORGE_WEB_STANDALONE=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @storyforge/web build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache tini curl \
    && addgroup --system --gid 1001 storyforge \
    && adduser --system --uid 1001 --ingroup storyforge --shell /sbin/nologin storyforge

WORKDIR /app

# Next.js `output: 'standalone'` emits a self-contained server with only the
# minimal dependencies needed to serve the built app.
COPY --from=builder --chown=storyforge:storyforge /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=storyforge:storyforge /repo/apps/web/.next/static ./apps/web/.next/static
# The /public directory is optional; copy it only when it exists in the source.
# Recent web app does not ship a public dir, so we skip the COPY rather than fail the build.

USER storyforge

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
