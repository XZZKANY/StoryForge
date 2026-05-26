#!/bin/sh
# StoryForge workflow container entrypoint.
# Wraps the upstream CMD with tini-friendly signal handling and prepares the
# runtime directory used by the LangGraph checkpoint store.
set -eu

mkdir -p /app/.runtime

exec "$@"
