#!/usr/bin/env bash
# StoryForge 数据库迁移辅助脚本。
#
# 用途：
#   - 在本地或部署环境一键运行 alembic upgrade head，复用容器同款的
#     Postgres advisory lock 防止并发冲突。
#   - 可作为 CI/CD 的部署阶段调用。
#
# 用法：
#   scripts/migrate.sh                       # 等价于 alembic upgrade head
#   scripts/migrate.sh downgrade -1          # 回滚一个版本
#   scripts/migrate.sh current               # 查看当前版本
#   ALEMBIC_CMD="upgrade head" scripts/migrate.sh   # 通过环境变量传命令
#
# 环境变量：
#   DATABASE_URL                  必填，Postgres 连接串
#   STORYFORGE_MIGRATION_TIMEOUT  等待数据库可用的秒数（默认 120）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"

if [ ! -d "$API_DIR/alembic" ]; then
    echo "[migrate.sh] 未找到 $API_DIR/alembic，请确认仓库布局" >&2
    exit 1
fi

cd "$API_DIR"

# 选择可用的 Python 入口：优先使用容器内安装的 storyforge-migrate（含 advisory lock）。
# 本地开发时使用 uv 运行同一脚本以保持行为一致。
if command -v storyforge-migrate >/dev/null 2>&1; then
    exec storyforge-migrate "$@"
fi

if command -v uv >/dev/null 2>&1; then
    exec uv run python docker/migrate.py "$@"
fi

echo "[migrate.sh] 既无 storyforge-migrate 也无 uv，回退到直接 alembic（无 advisory lock）" >&2
exec alembic "${@:-upgrade head}"
