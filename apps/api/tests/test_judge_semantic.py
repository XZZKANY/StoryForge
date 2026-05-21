from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import DetectedIssue, semantic_judge


def test_judge_detects_location_fact_conflict(client: TestClient, session: Session) -> None:
    """Judge 必须识别非受伤类设定冲突，而不是只覆盖左右臂模板。"""

    book = Book(title="灯塔余烬", status="draft", premise="林岚追查灯塔港信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="错港", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="误入荒原", status="draft", content=None)
    session.add(scene)
    session.flush()
    packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"必须包含事实": ["地点：灯塔港"]}, version=1)
    session.add(packet)
    session.commit()

    response = client.post(
        "/api/judge/issues",
        json={
            "scene_id": scene.id,
            "scene_packet_id": packet.id,
            "content": "林岚确认地点：荒原城，随后开始寻找失真的灯塔信号。",
            "required_facts": ["地点：灯塔港"],
            "style_rules": [],
            "evidence_links": [{"source_ref": "world://location/lighthouse-port", "rationale": "设定地点为灯塔港。"}],
        },
    )

    assert response.status_code == 201, response.text
    issues = response.json()
    assert len(issues) == 1
    assert issues[0]["category"] == "setting_conflict"
    assert issues[0]["severity"] == "high"
    assert "地点：灯塔港" in issues[0]["summary"]


def test_semantic_judge_accepts_injected_provider_without_remote_llm() -> None:
    """Judge LLM 路径必须可注入 provider，避免测试依赖真实远程模型。"""

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：荒原城，随后开始寻找失真的灯塔信号。",
        required_facts=["地点：灯塔港"],
        style_rules=[],
        evidence_links=[],
    )

    def provider(request_payload: JudgeIssueCreate) -> list[dict[str, object]]:
        assert request_payload is payload
        return [
            {
                "category": "setting_conflict",
                "severity": "high",
                "span_start": 4,
                "span_end": 10,
                "summary": "模型识别地点冲突。",
                "expected_text": "地点：灯塔港",
                "replacement_text": "地点：灯塔港",
                "matched_text": "地点：荒原城",
            }
        ]

    issues = semantic_judge(payload, provider=provider)

    assert issues == [
        DetectedIssue(
            category="setting_conflict",
            severity="high",
            span_start=4,
            span_end=10,
            summary="模型识别地点冲突。",
            recommended_repair_mode="replace_span",
            expected_text="地点：灯塔港",
            replacement_text="地点：灯塔港",
            matched_text="地点：荒原城",
        )
    ]
