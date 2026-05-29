from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge import service as judge_service
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


def test_semantic_judge_posts_llm_request_with_httpx_client(monkeypatch) -> None:
    """远程 Judge 调用必须通过 httpx Client 发送结构化 JSON 请求。"""

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：荒原城，随后开始寻找失真的灯塔信号。",
        required_facts=["地点：灯塔港"],
        style_rules=["克制"],
        evidence_links=[],
    )
    captured: dict[str, object] = {}

    class FakeResponse:
        def json(self) -> dict[str, object]:
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '[{"category":"setting_conflict","severity":"high",'
                                '"span_start":4,"span_end":10,"summary":"模型识别地点冲突。",'
                                '"expected_text":"地点：灯塔港","replacement_text":"地点：灯塔港",'
                                '"matched_text":"地点：荒原城"}]'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *, timeout: float) -> None:
            captured["timeout"] = timeout

        def __enter__(self) -> FakeClient:
            captured["entered"] = True
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            captured["closed"] = True

        def post(self, url: str, *, json: dict[str, object], headers: dict[str, str]) -> FakeResponse:
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://llm.example/v1/")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS", "12.5")
    monkeypatch.setattr(judge_service.httpx, "Client", FakeClient)

    issues = semantic_judge(payload)

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
    assert captured["timeout"] == 12.5
    assert captured["entered"] is True
    assert captured["closed"] is True
    assert captured["url"] == "https://llm.example/v1/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer test-key"}
    request_json = captured["json"]
    assert isinstance(request_json, dict)
    assert request_json["temperature"] == 0
    system_message = request_json["messages"][0]
    assert system_message["role"] == "system"
    assert "JSON" in system_message["content"]
    assert "character_voice_violation" in system_message["content"]
    assert "地点：灯塔港" in str(request_json["messages"][1]["content"])
