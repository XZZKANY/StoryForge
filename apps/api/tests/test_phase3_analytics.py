from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.collaboration.models import ApprovalDecision, ApprovalRequest, WorkspaceComment
from app.domains.events.models import EventLog
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.provider_gateway.models import ProviderConfig
from app.domains.workspaces.models import Workspace, WorkspaceMember
from app.main import app

import pytest


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    def override_get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def analytics_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="分析扩展", slug="analytics-team", status="active", description="分析", seat_limit=3)
        session.add(workspace)
        session.flush()
        owner = WorkspaceMember(workspace_id=workspace.id, display_name="林岚", role="owner", status="active")
        reviewer = WorkspaceMember(workspace_id=workspace.id, display_name="顾潮", role="reviewer", status="active")
        session.add_all([owner, reviewer])
        session.flush()
        book = Book(title="灯塔余烬", status="draft", premise="追查", workspace_id=workspace.id)
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="摘要")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="正文")
        session.add(scene)
        session.flush()
        session.add(WorkspaceComment(workspace_id=workspace.id, scene_id=scene.id, member_id=owner.id, body="补强动作限制", status="open"))
        approval = ApprovalRequest(workspace_id=workspace.id, scene_id=scene.id, requester_member_id=owner.id, reviewer_member_id=reviewer.id, status="approved", summary="请确认版本")
        session.add(approval)
        session.flush()
        session.add(ApprovalDecision(approval_request_id=approval.id, member_id=reviewer.id, decision="approved", note="通过"))
        session.add_all([
            JudgeIssue(scene_id=scene.id, scene_packet_id=None, job_run_id=None, issue_type="setting_conflict", severity="high", status="open", description="设定冲突", payload={}),
            JudgeIssue(scene_id=scene.id, scene_packet_id=None, job_run_id=None, issue_type="style_drift", severity="medium", status="resolved", description="文风漂移", payload={}),
        ])
        session.flush()
        session.add_all([
            RepairPatch(judge_issue_id=1, scene_id=scene.id, status="accepted", patch={"target_span": "A", "replacement_text": "B"}, rationale="修复", version=1),
            RepairPatch(judge_issue_id=2, scene_id=scene.id, status="requires_rejudge", patch={"target_span": "C", "replacement_text": "D"}, rationale="修复", version=1),
        ])
        session.add_all([
            JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="completed", progress={"token_usage": 90}),
            JobRun(book_id=book.id, scene_id=scene.id, job_type="judge", status="partial_failed", progress={"token_usage": 40}),
        ])
        session.add(EventLog(workspace_id=workspace.id, book_id=book.id, scene_id=scene.id, member_id=owner.id, event_type="comment_created", source="collaboration", payload={"comment_id": 1}))
        session.add(ProviderConfig(workspace_id=workspace.id, provider_name="openai-team", status="active", priority=10, capabilities=["llm"], model_aliases={"writer": "gpt-5.5"}, credential_ref="vault://workspace/openai"))
        session.commit()
        return {"workspace_id": workspace.id}


def test_workspace_analytics_dashboard_aggregates_phase3_signals(client: TestClient, analytics_context: dict[str, int]) -> None:
    response = client.get(f"/api/analytics/workspaces/{analytics_context['workspace_id']}/dashboard")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["active_member_count"] == 2
    assert result["comment_count"] == 1
    assert result["pending_approval_count"] == 0
    assert result["approval_pass_rate"] == 1.0
    assert result["repair_acceptance_rate"] == 0.5
    assert result["job_success_rate"] == 0.5
    assert result["recent_event_count"] == 1
    assert result["active_provider_count"] == 1
    assert result["failure_categories"] == [
        {"issue_type": "setting_conflict", "count": 1},
        {"issue_type": "style_drift", "count": 1},
    ]
