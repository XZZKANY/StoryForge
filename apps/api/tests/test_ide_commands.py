from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.testclient import TestClient
from test_book_runs import seed_locked_blueprint

import app.models  # noqa: F401
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch


@pytest.fixture()
def ide_judge_context(session_factory: sessionmaker[Session]) -> dict[str, int | str]:
    """准备 IDE 命令闭环需要的章节、场景和上下文包。"""

    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤，港口风声却仍很低。"
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=content)
        session.add(scene)
        session.flush()
        packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={"必须包含事实": ["左臂受伤"], "风格规则": ["克制"]},
            version=1,
        )
        session.add(packet)
        session.commit()
        return {
            "scene_id": scene.id,
            "scene_packet_id": packet.id,
            "chapter_id": chapter.id,
            "content": content,
        }


def test_judge_approve_ide_command_rejects_missing_patch(client: TestClient) -> None:
    """批准写回命令必须拒绝不存在的补丁，避免把薄壳 accepted 误当写回成功。"""

    response = client.post(
        "/api/ide/commands/judge.approve",
        json={"args": {"repair_patch_id": 32}},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Repair Patch 不存在，无法执行批准写回。"}


def test_unknown_ide_command_returns_404(client: TestClient) -> None:
    """命令薄壳必须显式拒绝未知命令，避免前端误判为成功。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}


def test_ide_judge_repair_approve_commands_execute_real_writeback(
    client: TestClient,
    session_factory: sessionmaker[Session],
    ide_judge_context: dict[str, int | str],
) -> None:
    """IDE 命令必须串起 Judge、Repair 与 Approve 的真实写回闭环。"""

    content = str(ide_judge_context["content"])
    judge_response = client.post(
        "/api/ide/commands/judge.run",
        json={
            "args": {
                "scene_id": ide_judge_context["scene_id"],
                "scene_packet_id": ide_judge_context["scene_packet_id"],
                "content": content,
                "required_facts": ["左臂受伤"],
                "style_rules": ["克制"],
                "evidence_links": [{"source_ref": "asset://character/lin-lan#v1", "rationale": "角色资产要求左臂仍受伤。"}],
            }
        },
    )

    assert judge_response.status_code == 200, judge_response.text
    judge_body = judge_response.json()
    assert judge_body["command_id"] == "judge.run"
    assert judge_body["status"] == "accepted"
    assert judge_body["audit_event_id"].startswith("ide-command-event:")
    assert {issue["category"] for issue in judge_body["payload"]["issues"]} == {"setting_conflict", "style_drift"}
    setting_issue = next(issue for issue in judge_body["payload"]["issues"] if issue["category"] == "setting_conflict")

    repair_response = client.post(
        "/api/ide/commands/judge.repair",
        json={"args": {"issue_id": setting_issue["id"], "content": content}},
    )

    assert repair_response.status_code == 200, repair_response.text
    repair_body = repair_response.json()
    assert repair_body["command_id"] == "judge.repair"
    assert repair_body["audit_event_id"].startswith("ide-command-event:")
    patch = repair_body["payload"]["patch"]
    assert patch["issue_id"] == setting_issue["id"]
    assert patch["target_span"] == "左臂完好无损"
    assert patch["replacement_text"] == "左臂仍然受伤"
    assert patch["requires_rejudge"] is True

    approve_response = client.post(
        "/api/ide/commands/judge.approve",
        json={"args": {"repair_patch_id": patch["id"]}},
    )

    assert approve_response.status_code == 200, approve_response.text
    approve_body = approve_response.json()
    assert approve_body["command_id"] == "judge.approve"
    assert approve_body["audit_event_id"].startswith("ide-command-event:")
    approval = approve_body["payload"]["approval"]
    assert approval["writeback_status"] == "已回写"
    assert approval["approved_object"]["object_type"] == "repair_patch"
    assert approval["approved_object"]["status"] == "accepted"
    assert approval["target_chapter"]["status"] == "approved"

    with session_factory() as session:
        scene = session.get(Scene, int(ide_judge_context["scene_id"]))
        issue = session.get(JudgeIssue, setting_issue["id"])
        stored_patch = session.get(RepairPatch, patch["id"])
        continuity_records = session.scalars(select(ContinuityRecord).order_by(ContinuityRecord.id)).all()

    assert scene is not None
    assert scene.content == content.replace("左臂完好无损", "左臂仍然受伤", 1)
    assert scene.status == "approved"
    assert issue is not None
    assert issue.status == "closed"
    assert stored_patch is not None
    assert stored_patch.status == "accepted"
    assert [record.record_type for record in continuity_records] == ["chapter_approval"]


def test_bookrun_control_ide_commands_update_real_status(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun IDE 控制命令必须更新真实状态，不能只返回 accepted 薄壳。"""

    scope = seed_locked_blueprint(session_factory)
    start_response = client.post(
        "/api/ide/commands/bookrun.start",
        json={"args": {"book_id": scope["book_id"], "blueprint_id": scope["blueprint_id"], "token_budget": 900}},
    )

    assert start_response.status_code == 200, start_response.text
    started = start_response.json()
    assert started["command_id"] == "bookrun.start"
    assert started["audit_event_id"].startswith("ide-command-event:")
    assert started["payload"]["writing_run"]["scope"] == "full_book"
    assert started["payload"]["writing_run"]["mode"] == "managed"
    assert started["payload"]["writing_run"]["status"] == "running"
    assert started["payload"]["writing_run_id"] == started["payload"]["book_run_id"]
    book_run_id = started["payload"]["book_run"]["id"]
    assert started["payload"]["book_run_id"] == book_run_id
    assert started["payload"]["writing_run"]["book_run_id"] == book_run_id
    assert started["payload"]["book_run"]["status"] == "running"
    assert started["payload"]["book_run"]["token_budget"] == 900

    pause_response = client.post(
        "/api/ide/commands/bookrun.pause",
        json={"args": {"book_run_id": book_run_id, "reason": "人工暂停"}},
    )

    assert pause_response.status_code == 200, pause_response.text
    paused = pause_response.json()
    assert paused["audit_event_id"].startswith("ide-command-event:")
    assert paused["payload"]["writing_run"]["status"] == "paused_by_user"
    assert paused["payload"]["writing_run_id"] == book_run_id
    assert paused["payload"]["book_run"]["status"] == "paused_by_user"
    assert paused["payload"]["book_run"]["progress"]["pause_reason"] == "人工暂停"

    resume_response = client.post(
        "/api/ide/commands/bookrun.resume",
        json={"args": {"book_run_id": book_run_id}},
    )

    assert resume_response.status_code == 200, resume_response.text
    resumed = resume_response.json()
    assert resumed["payload"]["writing_run"]["status"] == "running"
    assert resumed["payload"]["book_run"]["status"] == "running"
    assert resumed["payload"]["book_run"]["progress"]["resume_from_chapter_index"] == 1

    stop_response = client.post(
        "/api/ide/commands/bookrun.stop",
        json={"args": {"book_run_id": book_run_id, "reason": "人工停止"}},
    )

    assert stop_response.status_code == 200, stop_response.text
    stopped = stop_response.json()
    assert stopped["audit_event_id"].startswith("ide-command-event:")
    assert stopped["payload"]["writing_run"]["status"] == "stopped"
    assert stopped["payload"]["book_run"]["status"] == "stopped"
    assert stopped["payload"]["book_run"]["progress"]["stop_reason"] == "人工停止"

    with session_factory() as session:
        stored = session.get(BookRun, book_run_id)
    assert stored is not None
    assert stored.status == "stopped"


def test_bookrun_retry_from_checkpoint_command_resumes_next_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """从 checkpoint 重试命令必须恢复到最近 checkpoint 的下一章。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "paused_by_budget",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                    {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                ],
                "budget": {"tokens_used": 840, "estimated_cost": 0.42},
            },
        },
    )

    response = client.post(
        "/api/ide/commands/bookrun.retry_from_checkpoint",
        json={"args": {"book_run_id": created["id"]}},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["command_id"] == "bookrun.retry_from_checkpoint"
    assert body["audit_event_id"].startswith("ide-command-event:")
    assert body["payload"]["writing_run"]["status"] == "running"
    assert body["payload"]["writing_run"]["scope"] == "full_book"
    assert body["payload"]["writing_run"]["mode"] == "managed"
    book_run = body["payload"]["book_run"]
    assert body["payload"]["writing_run_id"] == book_run["id"]
    assert book_run["status"] == "running"
    assert book_run["current_chapter_index"] == 3
    assert book_run["progress"]["retry_from_checkpoint"]["chapter_index"] == 2
    assert book_run["progress"]["retry_from_chapter_index"] == 3


def test_bookrun_control_ide_commands_reject_invalid_state(client: TestClient) -> None:
    """BookRun 控制命令必须拒绝缺失参数和不存在的运行记录。"""

    missing_response = client.post("/api/ide/commands/bookrun.pause", json={"args": {}})

    assert missing_response.status_code == 400
    assert missing_response.json() == {"detail": "BookRun 命令缺少 book_run_id。"}

    retry_response = client.post(
        "/api/ide/commands/bookrun.retry_from_checkpoint",
        json={"args": {"book_run_id": 999999}},
    )

    assert retry_response.status_code == 400
    assert retry_response.json() == {"detail": "BookRun 不存在。"}
