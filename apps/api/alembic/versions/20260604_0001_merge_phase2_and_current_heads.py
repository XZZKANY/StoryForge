"""合并 Phase 2 记忆模型与当前主线迁移头。"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "20260604_0001"
down_revision: tuple[str, str] = ("20260514_phase2", "20260602_0003")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """合并迁移图分支，不执行额外结构变更。"""


def downgrade() -> None:
    """回退 mergepoint 时交由 Alembic 回到两个父 revision。"""
