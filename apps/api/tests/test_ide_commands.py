from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.testclient import TestClient

import app.models  # noqa: F401
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


def test_bookrun_commands_stay_unregistered() -> None:
    """bookrun.* 桌面入口已摘除（2026-08-01 作者拍板退役批量整书）。

    只摘注册、不删实现：`_execute_bookrun_command` 与 book_runs service / REST 全留着，
    回滚 = 把 5 行 IdeCommandDefinition 加回 command_registry。底层「控制必须真更新状态」
    的覆盖仍在 test_book_run_controls.py（REST 层），本刀没有削掉那份保证。
    """

    from app.domains.ide.command_registry import _BUILTIN_COMMANDS

    leaked = sorted(cid for cid in _BUILTIN_COMMANDS if cid.startswith("bookrun."))
    assert not leaked, f"bookrun 命令又被注册回来了：{leaked}"
