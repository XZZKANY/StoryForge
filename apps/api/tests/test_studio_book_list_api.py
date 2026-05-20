from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.jobs.models import JobRun
from app.domains.workspaces.models import Workspace
from app.main import app


def seed_book(
    session_factory: sessionmaker[Session],
    *,
    title: str,
    workspace_id: int | None = None,
    chapter_ordinals: list[int] | None = None,
) -> int:
    """创建 Studio 作品列表 API 所需的作品和章节事实。"""

    with session_factory() as session:
        book = Book(title=title, status="draft", premise="用于 Studio 作品列表。", workspace_id=workspace_id)
        session.add(book)
        session.flush()
        for ordinal in chapter_ordinals or []:
            session.add(Chapter(book_id=book.id, ordinal=ordinal, title=f"第 {ordinal} 章", status="planned"))
        session.commit()
        session.refresh(book)
        return book.id


def seed_workspace(session_factory: sessionmaker[Session], title: str) -> int:
    """创建工作区以验证作品列表的 int workspace_id 过滤。"""

    with session_factory() as session:
        workspace = Workspace(title=title, slug=title.lower(), status="active", seat_limit=5)
        session.add(workspace)
        session.commit()
        session.refresh(workspace)
        return workspace.id


def test_list_studio_books_returns_id_title_and_recent_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio 作品列表 API 返回作品 ID、标题和最近章节编号。"""

    book_id = seed_book(session_factory, title="星海纪元", chapter_ordinals=[1, 3, 2])

    response = client.get("/api/studio/books")

    assert response.status_code == 200, response.text
    books = response.json()
    assert books == [
        {
            "id": book_id,
            "title": "星海纪元",
            "recent_chapter_ordinal": 3,
        }
    ]


def test_list_studio_books_filters_by_workspace(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """workspace_id 使用现有 int 主键过滤作品列表。"""

    workspace_id = seed_workspace(session_factory, "alpha")
    kept_book_id = seed_book(session_factory, title="工作区内作品", workspace_id=workspace_id, chapter_ordinals=[1])
    seed_book(session_factory, title="其他作品", workspace_id=None, chapter_ordinals=[5])

    response = client.get(f"/api/studio/books?workspace_id={workspace_id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": kept_book_id,
            "title": "工作区内作品",
            "recent_chapter_ordinal": 1,
        }
    ]


def test_list_studio_books_returns_empty_list(client: TestClient) -> None:
    """没有作品时返回空列表，供 Studio 页面展示空态。"""

    response = client.get("/api/studio/books")

    assert response.status_code == 200, response.text
    assert response.json() == []



def test_read_studio_chapter_goal_returns_target_summary_and_constraints(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节目标 API 读取目标章节、上一章摘要和连续性约束。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="追查旧航线。")
        session.add(book)
        session.flush()
        previous = Chapter(book_id=book.id, ordinal=1, title="旧港线索", status="approved", summary="林岚确认旧港信号。")
        target = Chapter(book_id=book.id, ordinal=2, title="灯塔谈判", status="planned", summary="争取维修窗口。")
        session.add_all([previous, target])
        session.flush()
        session.add(
            ContinuityRecord(
                book_id=book.id,
                scene_id=None,
                record_type="next_chapter_constraints",
                subject="下一章继承约束",
                status="active",
                payload={"value": ["隐藏左臂旧伤", "副官留在门外"], "chapter_id": previous.id},
                version=1,
            )
        )
        session.commit()
        book_id = book.id

    response = client.get(f"/api/studio/chapter-goals?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book_id,
        "target_chapter_id": target.id,
        "target_chapter_ordinal": 2,
        "target_chapter_title": "灯塔谈判",
        "chapter_goal": "争取维修窗口。",
        "previous_chapter_summary": "林岚确认旧港信号。",
        "continuity_constraints": ["隐藏左臂旧伤", "副官留在门外"],
    }



def test_read_studio_chapter_goal_returns_404_for_missing_target(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节目标不存在时返回 404，供 Web 展示可重试错误摘要。"""

    book_id = seed_book(session_factory, title="无目标章节作品", chapter_ordinals=[1])

    response = client.get(f"/api/studio/chapter-goals?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "章节目标不存在，无法读取 Studio 章节目标。"}



def test_read_studio_scene_packet_returns_packet_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio Scene Packet API 读取已组装包的证据和预算摘要。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="追查旧港信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=2, title="旧港谈判", status="draft", summary="争取维修窗口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="planned", content=None)
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={
                "章节目标": "林岚争取维修窗口。",
                "证据链接": [{"source_ref": "asset:1"}, {"source_ref": "retrieval:1:1"}],
                "上下文预算": {"token_budget": 120, "used_tokens": 80, "truncated": False},
                "compiled_context_id": "ctx_unit_scene_packet",
            },
            version=1,
        )
        session.add(scene_packet)
        session.commit()
        book_id = book.id
        packet_id = scene_packet.id
        scene_id = scene.id

    response = client.get(f"/api/studio/scene-packets?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book_id,
        "target_chapter_ordinal": 2,
        "scene_id": scene_id,
        "scene_packet_id": packet_id,
        "job_run_id": None,
        "status": "assembled",
        "chapter_goal": "林岚争取维修窗口。",
        "evidence_count": 2,
        "compiled_context_id": "ctx_unit_scene_packet",
        "budget_summary": {"token_budget": 120, "used_tokens": 80, "truncated": False},
    }



def test_read_studio_scene_packet_returns_404_when_packet_missing(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Scene Packet 未组装时返回 404，供 Web 展示可重试错误摘要。"""

    book_id = seed_book(session_factory, title="暂无上下文包作品", chapter_ordinals=[1])

    response = client.get(f"/api/studio/scene-packets?book_id={book_id}&target_ordinal=1")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Scene Packet 不存在，无法读取 Studio Scene Packet。"}



def test_read_studio_judge_review_returns_review_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio Judge 评审 API 读取已持久化问题摘要，不触发 Repair。"""

    with session_factory() as session:
        book = Book(title="雾港评审", status="draft", premise="验证 Judge 摘要。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=3, title="港口审稿", status="draft", summary="检查草稿问题。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="旧港对峙", status="draft", content="林岚举起左臂完好无损。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "保持旧伤约束。"}, version=1)
        session.add(scene_packet)
        session.flush()
        issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=scene_packet.id,
            issue_type="setting_conflict",
            severity="high",
            status="open",
            description="正文与必含事实“左臂受伤”冲突。",
            payload={
                "span_start": 4,
                "span_end": 10,
                "recommended_repair_mode": "replace_span",
                "evidence_links": [{"source_ref": "asset://character/lin-lan#v1"}],
            },
        )
        session.add(issue)
        session.commit()
        scene_packet_id = scene_packet.id
        issue_id = issue.id

    response = client.get(f"/api/studio/judge-reviews?scene_packet_id={scene_packet_id}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "scene_packet_id": scene_packet_id,
        "status": "open",
        "issue_count": 1,
        "highest_severity": "high",
        "score": 60,
        "issues": [
            {
                "id": issue_id,
                "category": "setting_conflict",
                "severity": "high",
                "summary": "正文与必含事实“左臂受伤”冲突。",
                "span_start": 4,
                "span_end": 10,
                "recommended_repair_mode": "replace_span",
            }
        ],
    }



def test_read_studio_judge_review_returns_404_when_review_missing(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Judge 评审不存在时返回 404，供 Web 展示可重试错误摘要。"""

    with session_factory() as session:
        book = Book(title="暂无评审作品", status="draft", premise="验证 Judge 缺失。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="待评审章节", status="draft", summary="等待评审。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="待评审场景", status="draft", content="草稿。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "等待评审。"}, version=1)
        session.add(scene_packet)
        session.commit()
        scene_packet_id = scene_packet.id

    response = client.get(f"/api/studio/judge-reviews?scene_packet_id={scene_packet_id}")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Judge 评审不存在，无法读取 Studio Judge 评审。"}


def test_read_studio_repair_patches_returns_patch_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio Repair 修订 API 读取已生成补丁摘要，不触发新修复。"""

    with session_factory() as session:
        book = Book(title="雾港修订", status="draft", premise="验证 Repair 摘要。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=4, title="修订章节", status="draft", summary="等待修订。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="修订场景", status="draft", content="林岚的左臂毫发无损。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "保持旧伤约束。"}, version=1)
        session.add(scene_packet)
        session.flush()
        issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=scene_packet.id,
            issue_type="setting_conflict",
            severity="high",
            status="requires_rejudge",
            description="左臂状态违背旧伤设定。",
            payload={"span_start": 3, "span_end": 10, "recommended_repair_mode": "replace_span"},
        )
        session.add(issue)
        session.flush()
        patch = RepairPatch(
            judge_issue_id=issue.id,
            scene_id=scene.id,
            status="requires_rejudge",
            patch={
                "target_span": "的左臂毫发无",
                "replacement_text": "压低受伤左臂",
                "requires_rejudge": True,
                "span_start": 3,
                "span_end": 10,
            },
            rationale="将“的左臂毫发无”替换为“压低受伤左臂”，使正文回到必含事实约束。",
            version=1,
        )
        session.add(patch)
        session.commit()
        scene_packet_id = scene_packet.id
        patch_id = patch.id
        issue_id = issue.id

    response = client.get(f"/api/studio/repair-patches?scene_packet_id={scene_packet_id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": patch_id,
            "issue_id": issue_id,
            "status": "requires_rejudge",
            "target_span": "的左臂毫发无",
            "replacement_text": "压低受伤左臂",
            "reason": "将“的左臂毫发无”替换为“压低受伤左臂”，使正文回到必含事实约束。",
            "requires_rejudge": True,
        }
    ]


def test_read_studio_repair_patches_returns_404_when_patch_missing(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Repair 修订补丁不存在时返回 404，供 Web 展示可重试错误摘要。"""

    with session_factory() as session:
        book = Book(title="暂无修订作品", status="draft", premise="验证 Repair 缺失。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="待修订章节", status="draft", summary="等待修订。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="待修订场景", status="draft", content="草稿。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "等待修订。"}, version=1)
        session.add(scene_packet)
        session.commit()
        scene_packet_id = scene_packet.id

    response = client.get(f"/api/studio/repair-patches?scene_packet_id={scene_packet_id}")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Repair 修订补丁不存在，无法读取 Studio Repair 修订。"}


def test_read_studio_approval_summary_returns_scene_packet_eligibility(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """批准回写摘要通过 Scene Packet 返回可批准对象和目标章节。"""

    with session_factory() as session:
        book = Book(title="批准摘要", status="draft", premise="验证批准摘要。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=5, title="批准章节", status="draft", summary="等待批准。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="批准场景", status="draft", content="待回写正文。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "等待批准。"}, version=1)
        session.add(scene_packet)
        session.commit()
        scene_packet_id = scene_packet.id
        scene_id = scene.id
        chapter_id = chapter.id

    response = client.get(f"/api/studio/approval-summary?scene_packet_id={scene_packet_id}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "can_approve": True,
        "approvable_object": {
            "object_type": "scene_packet",
            "id": scene_packet_id,
            "status": "assembled",
            "scene_id": scene_id,
        },
        "target_chapter": {
            "id": chapter_id,
            "ordinal": 5,
            "title": "批准章节",
            "status": "draft",
        },
        "writeback_status": "未回写",
        "unavailable_reason": None,
    }


def test_read_studio_approval_summary_returns_unavailable_for_blocked_patch(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """批准回写摘要通过 Repair Patch 返回不可批准原因，不执行写回。"""

    with session_factory() as session:
        book = Book(title="不可批准摘要", status="draft", premise="验证不可批准。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=6, title="阻塞章节", status="draft", summary="等待修订。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="阻塞场景", status="draft", content="草稿。")
        session.add(scene)
        session.flush()
        issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=None,
            issue_type="style",
            severity="medium",
            status="open",
            description="仍需修订。",
            payload={},
        )
        session.add(issue)
        session.flush()
        patch = RepairPatch(
            judge_issue_id=issue.id,
            scene_id=scene.id,
            status="rejected",
            patch={"target_span": "草稿", "replacement_text": "修订稿"},
            rationale="已被拒绝。",
            version=1,
        )
        session.add(patch)
        session.commit()
        patch_id = patch.id

    response = client.get(f"/api/studio/approval-summary?repair_patch_id={patch_id}")

    assert response.status_code == 200, response.text
    assert response.json()["can_approve"] is False
    assert response.json()["approvable_object"]["object_type"] == "repair_patch"
    assert response.json()["writeback_status"] == "未回写"
    assert response.json()["unavailable_reason"] == "Repair Patch 状态暂不可批准。"


def test_read_studio_approval_summary_requires_single_identifier(client: TestClient) -> None:
    """批准回写摘要没有输入对象时返回只读不可用摘要。"""

    response = client.get("/api/studio/approval-summary")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "can_approve": False,
        "approvable_object": None,
        "target_chapter": None,
        "writeback_status": "不可判定",
        "unavailable_reason": "需要提供 Scene Packet ID 或 Repair Patch ID。",
    }


def test_read_studio_recovery_summary_returns_recoverable_checkpoint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """失败恢复摘要返回失败节点、checkpoint、可恢复步骤和错误摘要。"""

    with session_factory() as session:
        job = JobRun(
            job_type="generation_runtime",
            status="failed",
            progress={
                "thread_id": "studio-thread-1",
                "current_node": "repair_writer",
                "approval_status": "pending",
                "recoverable_steps": ["重新读取 Repair Patch", "从修订节点继续执行"],
            },
            error_message="Repair 节点调用模型失败。",
        )
        session.add(job)
        session.commit()
        job_run_id = job.id

    response = client.get(f"/api/studio/recovery-summary?job_run_id={job_run_id}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "can_recover": True,
        "failed_node": "repair_writer",
        "checkpoint": {
            "thread_id": "studio-thread-1",
            "current_node": "repair_writer",
            "approval_status": "pending",
        },
        "recoverable_steps": ["重新读取 Repair Patch", "从修订节点继续执行"],
        "error_summary": "Repair 节点调用模型失败。",
        "unrecoverable_reason": None,
    }


def test_read_studio_recovery_summary_returns_unrecoverable_for_running_job(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未失败任务返回不可恢复原因，不触发恢复动作。"""

    with session_factory() as session:
        job = JobRun(
            job_type="generation_runtime",
            status="running",
            progress={"thread_id": "studio-thread-2", "current_node": "draft_writer"},
            error_message=None,
        )
        session.add(job)
        session.commit()
        job_run_id = job.id

    response = client.get(f"/api/studio/recovery-summary?job_run_id={job_run_id}")

    assert response.status_code == 200, response.text
    assert response.json()["can_recover"] is False
    assert response.json()["failed_node"] == "draft_writer"
    assert response.json()["unrecoverable_reason"] == "任务尚未失败，无需执行失败恢复。"
