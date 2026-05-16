from __future__ import annotations

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.analytics.service import build_workspace_analytics
from app.domains.books.models import Book, Chapter, Scene
from app.domains.collaboration.schemas import ApprovalDecisionCreate, ApprovalRequestCreate, WorkspaceCommentCreate
from app.domains.collaboration.service import create_approval_request, create_comment, decide_approval, list_scene_timeline
from app.domains.commercial.schemas import WorkspaceSubscriptionCreate
from app.domains.commercial.service import build_commercial_summary, upsert_workspace_subscription
from app.domains.events.schemas import EventRecordCreate
from app.domains.events.service import list_workspace_events, record_event
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.provider_gateway.schemas import ProviderConfigCreate
from app.domains.provider_gateway.service import create_provider_config, list_provider_configs, resolve_provider
from app.domains.workspaces.schemas import WorkspaceCreate, WorkspaceMemberCreate
from app.domains.workspaces.service import (
    WorkspaceSeatLimitError,
    create_workspace,
    create_workspace_member,
    list_workspace_members,
)


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    """使用 SQLite 内存库验证 Phase 3 服务闭环。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_workspace_and_collaboration_service_flow(session: Session) -> None:
    """工作区、席位限制、评论审批和事件流可以通过服务层跑通。"""

    workspace = create_workspace(session, WorkspaceCreate(title="星海协作组", description="第三阶段协作试点", seat_limit=2))
    owner = create_workspace_member(session, workspace.id, WorkspaceMemberCreate(display_name="林岚", role="owner", status="active"))
    reviewer = create_workspace_member(session, workspace.id, WorkspaceMemberCreate(display_name="顾潮", role="reviewer", status="active"))

    with pytest.raises(WorkspaceSeatLimitError):
        create_workspace_member(session, workspace.id, WorkspaceMemberCreate(display_name="季衡", role="editor", status="active"))

    assert [member.display_name for member in list_workspace_members(session, workspace.id)] == ["林岚", "顾潮"]

    book = Book(title="灯塔余烬", status="draft", premise="追查信号", workspace_id=workspace.id)
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚进入旧港")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚等待回应。")
    session.add(scene)
    session.commit()

    comment = create_comment(
        session,
        WorkspaceCommentCreate(
            workspace_id=workspace.id,
            scene_id=scene.id,
            member_id=owner.id,
            body="建议加强旧伤带来的动作限制。",
        ),
    )
    approval = create_approval_request(
        session,
        ApprovalRequestCreate(
            workspace_id=workspace.id,
            scene_id=scene.id,
            requester_member_id=owner.id,
            reviewer_member_id=reviewer.id,
            summary="请确认旧伤设定是否已体现。",
        ),
    )
    decision = decide_approval(
        session,
        approval.id,
        ApprovalDecisionCreate(member_id=reviewer.id, decision="approved", note="可以进入下一轮。"),
    )

    timeline = list_scene_timeline(session, scene.id)
    events = list_workspace_events(session, workspace.id)

    assert comment.id > 0
    assert approval.status == "approved"
    assert decision.decision == "approved"
    assert [item.item_type for item in timeline] == ["comment", "approval"]
    assert [item.event_type for item in events] == ["approval_decided", "approval_requested", "comment_created"]


def test_commercial_provider_and_analytics_service_flow(session: Session) -> None:
    """商业化控制、Provider Gateway 和分析扩展能聚合同一工作区数据。"""

    workspace = create_workspace(session, WorkspaceCreate(title="分析扩展", description="Phase 3 验收", seat_limit=3))
    owner = create_workspace_member(session, workspace.id, WorkspaceMemberCreate(display_name="林岚", role="owner", status="active"))
    reviewer = create_workspace_member(session, workspace.id, WorkspaceMemberCreate(display_name="顾潮", role="reviewer", status="active"))

    book = Book(title="灯塔余烬", status="draft", premise="追查信号", workspace_id=workspace.id)
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚进入旧港")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚等待回应。")
    session.add(scene)
    session.flush()

    approval = create_approval_request(
        session,
        ApprovalRequestCreate(
            workspace_id=workspace.id,
            scene_id=scene.id,
            requester_member_id=owner.id,
            reviewer_member_id=reviewer.id,
            summary="请确认旧伤设定是否已体现。",
        ),
    )
    decide_approval(
        session,
        approval.id,
        ApprovalDecisionCreate(member_id=reviewer.id, decision="approved", note="通过"),
    )
    create_comment(
        session,
        WorkspaceCommentCreate(
            workspace_id=workspace.id,
            scene_id=scene.id,
            member_id=owner.id,
            body="补强动作限制。",
        ),
    )

    session.add_all(
        [
            JobRun(book_id=book.id, scene_id=scene.id, job_type="generate", status="completed", progress={"token_usage": 120}),
            JobRun(book_id=book.id, scene_id=scene.id, job_type="judge", status="partial_failed", progress={"token_usage": 40}),
            JudgeIssue(scene_id=scene.id, scene_packet_id=None, job_run_id=None, issue_type="setting_conflict", severity="high", status="open", description="设定冲突", payload={}),
            JudgeIssue(scene_id=scene.id, scene_packet_id=None, job_run_id=None, issue_type="style_drift", severity="medium", status="resolved", description="文风漂移", payload={}),
        ]
    )
    session.flush()
    session.add_all(
        [
            RepairPatch(judge_issue_id=1, scene_id=scene.id, status="accepted", patch={"target_span": "A", "replacement_text": "B"}, rationale="修复", version=1),
            RepairPatch(judge_issue_id=2, scene_id=scene.id, status="requires_rejudge", patch={"target_span": "C", "replacement_text": "D"}, rationale="修复", version=1),
        ]
    )
    session.commit()

    record_event(
        session,
        EventRecordCreate(
            workspace_id=workspace.id,
            book_id=book.id,
            scene_id=scene.id,
            member_id=owner.id,
            event_type="manual_audit_marked",
            source="phase3_acceptance",
            payload={"note": "补充验收事件"},
        ),
    )

    upsert_workspace_subscription(
        session,
        workspace.id,
        WorkspaceSubscriptionCreate(
            plan_code="team-basic",
            seat_limit=2,
            monthly_job_limit=1,
            monthly_token_limit=150,
            monthly_price=99,
        ),
    )
    commercial_summary = build_commercial_summary(session, workspace.id)
    assert commercial_summary.active_member_count == 2
    assert commercial_summary.current_job_count == 2
    assert commercial_summary.current_token_estimate == 160
    assert commercial_summary.within_limits is False

    create_provider_config(
        session,
        ProviderConfigCreate(
            provider_name="openai-global",
            priority=50,
            capabilities=["llm", "embedding"],
            model_aliases={"writer": "gpt-5.5"},
            credential_ref="vault://global/openai",
        ),
    )
    create_provider_config(
        session,
        ProviderConfigCreate(
            workspace_id=workspace.id,
            provider_name="anthropic-team",
            priority=10,
            capabilities=["llm"],
            model_aliases={"reviewer": "claude-sonnet"},
            credential_ref="vault://workspace/anthropic",
        ),
    )

    providers = list_provider_configs(session, workspace.id)
    resolution = resolve_provider(session, "llm", workspace.id)
    assert [provider.provider_name for provider in providers] == ["anthropic-team", "openai-global"]
    assert resolution.provider_name == "anthropic-team"
    assert resolution.model_aliases["reviewer"] == "claude-sonnet"

    analytics = build_workspace_analytics(session, workspace.id)
    assert analytics.active_member_count == 2
    assert analytics.comment_count == 1
    assert analytics.pending_approval_count == 0
    assert analytics.approval_pass_rate == 1.0
    assert analytics.repair_acceptance_rate == 0.5
    assert analytics.job_success_rate == 0.5
    assert analytics.recent_event_count == 4
    assert analytics.active_provider_count == 2
    assert [item.model_dump() for item in analytics.failure_categories] == [
        {"issue_type": "setting_conflict", "count": 1},
        {"issue_type": "style_drift", "count": 1},
    ]
