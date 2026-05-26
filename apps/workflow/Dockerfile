# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

COPY storyforge_workflow ./storyforge_workflow

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev || uv sync --no-dev

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    STORYFORGE_ENV=production \
    WORKFLOW_RUNTIME_MODE=local

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 storyforge \
    && useradd --system --uid 1000 --gid 1000 --home /app --shell /usr/sbin/nologin storyforge

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app /app
COPY docker/entrypoint.sh /usr/local/bin/storyforge-workflow-entrypoint
RUN chmod +x /usr/local/bin/storyforge-workflow-entrypoint \
    && mkdir -p /app/.runtime \
    && chown -R storyforge:storyforge /app

USER storyforge

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/storyforge-workflow-entrypoint"]
# Default to an idle loop so the container stays available for `docker compose run`
# or `docker exec` invocations of the longform CLI. Override with e.g.:
#   docker run ... storyforge-workflow python -m storyforge_workflow.longform --help
CMD ["python", "-c", "import signal, time; signal.signal(signal.SIGTERM, lambda *_: exit(0)); print('storyforge-workflow runner idle; exec a CLI to drive it', flush=True); time.sleep(2**31)"]
