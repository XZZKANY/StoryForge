#!/bin/sh
# StoryForge API container entrypoint.
# - Optionally runs Alembic migrations under a Postgres advisory lock so multi-instance startup is safe.
# - Then exec's the upstream CMD (default: uvicorn app.main:app).
#
# Toggle behavior with environment variables:
#   STORYFORGE_AUTO_MIGRATE=1   run `alembic upgrade head` before serving (default: 1)
#   STORYFORGE_AUTO_MIGRATE=0   skip migrations
#   WORKERS=N                   number of uvicorn workers (default: 2) when CMD is uvicorn
set -eu

: "${STORYFORGE_AUTO_MIGRATE:=1}"
: "${WORKERS:=2}"

if [ "$STORYFORGE_AUTO_MIGRATE" = "1" ]; then
    echo "[entrypoint] running alembic upgrade head under advisory lock"
    # The migration script wraps `alembic upgrade head` with a Postgres advisory lock.
    /usr/local/bin/storyforge-migrate
else
    echo "[entrypoint] STORYFORGE_AUTO_MIGRATE=$STORYFORGE_AUTO_MIGRATE — skipping migrations"
fi

# Inject --workers from $WORKERS when the user runs the default uvicorn command without specifying it.
if [ "${1:-}" = "uvicorn" ] && ! echo "$*" | grep -q -- "--workers"; then
    set -- "$@" "--workers" "$WORKERS"
fi

exec "$@"
