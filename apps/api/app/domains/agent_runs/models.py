from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.assistant.models import AssistantSession


class AgentRun(IdMixin, TimestampMixin, Base):
    """AgentRun 记录一次作者目标在控制平面内的完整运行。"""

    __tablename__ = "agent_runs"

    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    session_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    assistant_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("assistant_sessions.id", ondelete="SET NULL"),
        index=True,
    )
    book_run_id: Mapped[int | None] = mapped_column(ForeignKey("book_runs.id", ondelete="SET NULL"), index=True)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    permission_profile: Mapped[str] = mapped_column(String(40), nullable=False, default="risk_confirm")
    budget: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="running", index=True)
    root_plan: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    current_step: Mapped[str | None] = mapped_column(String(160))

    assistant_session: Mapped[AssistantSession | None] = relationship()
    events: Mapped[list[AgentRunEvent]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentRunEvent.id",
    )
    subagent_runs: Mapped[list[SubagentRun]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="SubagentRun.id",
        foreign_keys="SubagentRun.run_id",
    )
    artifacts: Mapped[list[AgentArtifact]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentArtifact.id",
    )


class AgentRunEvent(IdMixin, TimestampMixin, Base):
    """AgentRunEvent 是 WebSocket、SSE 和 REST 共用的运行事实源。"""

    __tablename__ = "agent_run_events"
    # 事件重放与 save-point 推导都依赖 run 内 sequence 单调：
    # 并发写（流式线程 + 控制消息）读到相同 max(sequence) 时靠唯一索引拒掉后写方。
    __table_args__ = (Index("uq_agent_run_events_run_sequence", "run_id", "sequence", unique=True),)

    run_id: Mapped[int] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    run: Mapped[AgentRun] = relationship(back_populates="events")


class SubagentRun(IdMixin, TimestampMixin, Base):
    """SubagentRun 记录 Root Agent 分发给专业子代理的任务摘要。"""

    __tablename__ = "subagent_runs"

    run_id: Mapped[int] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False)
    parent_run_id: Mapped[int | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"), index=True)
    role: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    input: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="completed", index=True)

    run: Mapped[AgentRun] = relationship(back_populates="subagent_runs", foreign_keys=[run_id])


class AgentArtifact(IdMixin, TimestampMixin, Base):
    """AgentArtifact 记录 Root Agent 产出的报告、补丁和 checkpoint 摘要。"""

    __tablename__ = "agent_artifacts"

    run_id: Mapped[int] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    run: Mapped[AgentRun] = relationship(back_populates="artifacts")
