from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker
from starlette.testclient import TestClient

import app.models  # noqa: F401
from app.common.redaction import REDACTED
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.ide.schemas import IdeCommandResult


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


def test_unknown_ide_command_returns_404(client: TestClient) -> None:
    """命令薄壳必须显式拒绝未知命令，避免前端误判为成功。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}


def test_ide_command_result_redacts_sensitive_payload_when_serialized() -> None:
    """旧读 DTO 退役后，live 命令 DTO 仍独立承担嵌套载荷脱敏。"""

    result = IdeCommandResult(
        command_id="audit.open",
        status="accepted",
        payload={"api_key": "test-private-key", "nested": {"token": "test-private-token", "note": "safe"}},
    )

    expected = {"api_key": REDACTED, "nested": {"token": REDACTED, "note": "safe"}}
    assert result.model_dump()["payload"] == expected
    assert result.model_dump(mode="json")["payload"] == expected


def test_bookrun_commands_stay_unregistered() -> None:
    """bookrun.* 桌面入口已摘除（2026-08-01 作者拍板退役批量整书）。

    2026-10-09 整条 BookRun 链已物理删除：`_execute_bookrun_command`、book_runs service /
    REST 与 test_book_run_controls.py 均不复存在，此处已无可回滚的实现，
    本用例退化为「这些命令 id 不得再出现」的防回归闸。
    """

    from app.domains.ide.command_registry import _BUILTIN_COMMANDS

    leaked = sorted(cid for cid in _BUILTIN_COMMANDS if cid.startswith("bookrun."))
    assert not leaked, f"bookrun 命令又被注册回来了：{leaked}"
