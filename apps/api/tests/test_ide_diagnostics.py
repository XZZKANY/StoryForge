from __future__ import annotations

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.domains.books.models import Book, Chapter, Scene
from app.domains.judge.models import JudgeIssue


def test_list_diagnostics_maps_open_judge_issues(client: TestClient, session: Session) -> None:
    """IDE diagnostics 应把 JudgeIssue 映射为 Problems 面板可消费的契约。"""

    book = Book(title="诊断作品", status="draft", premise="验证诊断。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="码头", status="draft", content="林岚抵达旧港。")
    session.add(scene)
    session.flush()
    issue = JudgeIssue(
        scene_id=scene.id,
        issue_type="setting_conflict",
        severity="high",
        status="open",
        description="灯塔位置与设定冲突。",
        payload={
            "span_start": 2,
            "span_end": 6,
            "evidence_links": [{"source_ref": "asset:1", "quote": "灯塔在北岸"}],
        },
    )
    session.add(issue)
    session.commit()

    response = client.get(f"/api/ide/diagnostics?scene_id={scene.id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": f"judge:{issue.id}",
            "severity": "error",
            "code": "setting_conflict",
            "message": "灯塔位置与设定冲突。",
            "range": {"start": 2, "end": 6},
            "source": "judge",
            "evidence": [{"source_ref": "asset:1", "quote": "灯塔在北岸"}],
            "quickFixes": [
                {
                    "command_id": "judge.repair",
                    "title": "生成定向修复",
                    "args": {"issue_id": issue.id, "scene_id": scene.id},
                }
            ],
        }
    ]


def test_list_diagnostics_returns_empty_list_for_scene_without_issues(client: TestClient) -> None:
    """没有 JudgeIssue 时 Problems 面板应收到可直接渲染的空列表。"""

    response = client.get("/api/ide/diagnostics?scene_id=999")

    assert response.status_code == 200, response.text
    assert response.json() == []




def test_read_ide_scene_returns_scene_content_for_workbench(client: TestClient, session: Session) -> None:
    """IDE scene 端点应返回 JudgeRepairWorkbench 所需的场景正文。"""

    book = Book(title="正文作品", status="draft", premise="验证正文读取。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="灯塔", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="南岸", status="draft", content="林岚走向北岸灯塔。")
    session.add(scene)
    session.commit()

    response = client.get(f"/api/ide/scenes/{scene.id}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": scene.id,
        "chapter_id": chapter.id,
        "book_id": book.id,
        "title": "南岸",
        "status": "draft",
        "content": "林岚走向北岸灯塔。",
    }


def test_read_ide_scene_returns_404_for_missing_scene(client: TestClient) -> None:
    """缺失场景必须显式返回 404，避免 IDE 伪造空正文。"""

    response = client.get("/api/ide/scenes/999999")

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "场景不存在，无法读取 IDE 场景正文。"
