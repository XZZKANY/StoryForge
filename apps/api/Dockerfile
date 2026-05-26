# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app

# Cache dependency layer separately from app code.
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

# Copy application source last to maximize cache hits.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev || uv sync --no-dev

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    STORYFORGE_ENV=production \
    WORKERS=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 storyforge \
    && useradd --system --uid 1000 --gid 1000 --home /app --shell /usr/sbin/nologin storyforge

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app /app
COPY docker/entrypoint.sh /usr/local/bin/storyforge-entrypoint
COPY docker/migrate.py /usr/local/bin/storyforge-migrate
RUN chmod +x /usr/local/bin/storyforge-entrypoint /usr/local/bin/storyforge-migrate \
    && chown -R storyforge:storyforge /app

USER storyforge

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/health/live || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/storyforge-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
