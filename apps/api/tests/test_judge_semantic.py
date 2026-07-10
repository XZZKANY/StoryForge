from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.common import llm_client
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import DetectedIssue, semantic_judge, semantic_judge_with_status


def _install_fake_transport(
    monkeypatch,
    *,
    content: str,
    captured: dict[str, object] | None = None,
) -> None:
    def fake_request(
        source,
        payload,
        *,
        timeout_seconds=None,
        max_attempts=None,
    ):
        if captured is not None:
            captured.update(
                {
                    "source": dict(source),
                    "json": payload,
                    "timeout": timeout_seconds,
                    "max_attempts": max_attempts,
                }
            )
        return {"choices": [{"message": {"content": content}}]}, 0.0

    monkeypatch.setattr(llm_client, "_request_chat_completions", fake_request)


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


def test_semantic_judge_preserves_cross_chapter_categories_from_provider() -> None:
    """跨章语义新维度应能从 provider 结果进入内部 DetectedIssue。"""

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="沈砚说铜钟密钥从未出现。",
        required_facts=["已知事实：铜钟密钥由沈砚持有"],
        style_rules=[],
        evidence_links=[{"source": "story_state_ledger", "fact": "铜钟密钥由沈砚持有"}],
    )

    def provider(_request_payload: JudgeIssueCreate) -> list[dict[str, object]]:
        return [
            {
                "category": "cross_chapter_state_conflict",
                "severity": "high",
                "span_start": 3,
                "span_end": 12,
                "summary": "正文否认已在 story_state 中确立的持有事实。",
                "expected_text": "铜钟密钥由沈砚持有",
                "replacement_text": "沈砚摸到袖中的铜钟密钥。",
                "matched_text": "铜钟密钥从未出现",
            }
        ]

    issues = semantic_judge(payload, provider=provider)

    assert issues[0].category == "cross_chapter_state_conflict"
    assert issues[0].severity == "high"
    assert issues[0].expected_text == "铜钟密钥由沈砚持有"


def test_semantic_judge_posts_llm_request_through_common_client(monkeypatch) -> None:
    """远程 Judge 必须把原 payload 与单次尝试参数交给 common LLM 通道。"""

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：荒原城，随后开始寻找失真的灯塔信号。",
        required_facts=["地点：灯塔港"],
        style_rules=["克制"],
        evidence_links=[{"source": "story_state_ledger", "fact": "地点：灯塔港"}],
    )
    captured: dict[str, object] = {}

    _install_fake_transport(
        monkeypatch,
        content=(
            '[{"category":"setting_conflict","severity":"high",'
            '"span_start":4,"span_end":10,"summary":"模型识别地点冲突。",'
            '"expected_text":"地点：灯塔港","replacement_text":"地点：灯塔港",'
            '"matched_text":"地点：荒原城"}]'
        ),
        captured=captured,
    )

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://llm.example/v1/")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS", "12.5")

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
    assert captured["max_attempts"] == 1
    request_source = captured["source"]
    assert isinstance(request_source, dict)
    assert request_source["STORYFORGE_LLM_BASE_URL"] == "https://llm.example/v1"
    assert request_source["STORYFORGE_LLM_API_KEY"] == "test-key"
    assert request_source["STORYFORGE_LLM_AUTH_HEADER"] == "bearer"
    request_json = captured["json"]
    assert isinstance(request_json, dict)
    assert set(request_json) == {"model", "messages", "temperature"}
    assert request_json["temperature"] == 0
    system_message = request_json["messages"][0]
    assert system_message["role"] == "system"
    assert "JSON" in system_message["content"]
    assert "character_voice_violation" in system_message["content"]
    assert "cross_chapter_state_conflict" in system_message["content"]
    assert "foreshadow_payoff_gap" in system_message["content"]
    assert "地点：灯塔港" in str(request_json["messages"][1]["content"])
    assert "story_state_ledger" in str(request_json["messages"][1]["content"])


def test_semantic_judge_parses_markdown_fenced_json_without_degradation(monkeypatch) -> None:
    """真实模型把 JSON 包在 markdown 代码块中时，Judge 不应降级。"""

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：荒原城，随后开始寻找失真的灯塔信号。",
        required_facts=["地点：灯塔港"],
        style_rules=["克制"],
        evidence_links=[],
    )

    _install_fake_transport(
        monkeypatch,
        content=(
            "```json\n"
            "[{\"category\":\"setting_conflict\",\"severity\":\"high\","
            "\"span_start\":4,\"span_end\":10,\"summary\":\"模型识别地点冲突。\","
            "\"expected_text\":\"地点：灯塔港\",\"replacement_text\":\"地点：灯塔港\","
            "\"matched_text\":\"地点：荒原城\"}]\n"
            "```"
        ),
    )

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://llm.example/v1/")

    outcome = semantic_judge_with_status(payload)

    assert outcome.failed is False
    assert outcome.issues == [
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


def test_semantic_judge_normalizes_base_url_before_request(monkeypatch) -> None:
    """运行时 Base URL 含空白时，Judge 应清洗后再拼接 chat/completions。"""

    captured: dict[str, object] = {}
    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：灯塔港。",
        required_facts=["地点：灯塔港"],
        style_rules=[],
        evidence_links=[],
    )

    _install_fake_transport(monkeypatch, content="[]", captured=captured)

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://llm.example/v1 \n")

    outcome = semantic_judge_with_status(payload)

    assert outcome.failed is False
    assert captured["source"]["STORYFORGE_LLM_BASE_URL"] == "https://llm.example/v1"


def test_semantic_judge_reads_llm_provider_config_file_override(tmp_path, monkeypatch) -> None:
    """无 JUDGE_* 专属 env 时，Judge 必须吃 llm-provider.json 覆盖链（桌面端写盘换模型即生效）。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(
        '{"provider": "openai-compatible", "baseUrl": "https://desktop.example/v1",'
        ' "model": "desktop-model", "apiKey": "desktop-key"}',
        encoding="utf-8",
    )
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    captured: dict[str, object] = {}
    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：灯塔港。",
        required_facts=["地点：灯塔港"],
        style_rules=[],
        evidence_links=[],
    )

    _install_fake_transport(monkeypatch, content="[]", captured=captured)

    outcome = semantic_judge_with_status(payload)

    assert outcome.failed is False
    assert captured["source"]["STORYFORGE_LLM_BASE_URL"] == "https://desktop.example/v1"
    assert captured["source"]["STORYFORGE_LLM_API_KEY"] == "desktop-key"
    assert captured["source"]["STORYFORGE_LLM_AUTH_HEADER"] == "bearer"
    assert captured["json"]["model"] == "desktop-model"
    assert captured["max_attempts"] == 1


def test_semantic_judge_env_overrides_still_win_over_config_file(tmp_path, monkeypatch) -> None:
    """STORYFORGE_JUDGE_LLM_* 专属 env 仍是最高优先级，压过 llm-provider.json。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(
        '{"baseUrl": "https://desktop.example/v1", "model": "desktop-model", "apiKey": "desktop-key"}',
        encoding="utf-8",
    )
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "judge-key")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://judge.example/v1")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_MODEL", "judge-model")

    captured: dict[str, object] = {}
    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content="林岚确认地点：灯塔港。",
        required_facts=["地点：灯塔港"],
        style_rules=[],
        evidence_links=[],
    )

    _install_fake_transport(monkeypatch, content="[]", captured=captured)

    outcome = semantic_judge_with_status(payload)

    assert outcome.failed is False
    assert captured["source"]["STORYFORGE_LLM_BASE_URL"] == "https://judge.example/v1"
    assert captured["source"]["STORYFORGE_LLM_API_KEY"] == "judge-key"
    assert captured["source"]["STORYFORGE_LLM_AUTH_HEADER"] == "bearer"
    assert captured["json"]["model"] == "judge-model"


def _span_payload(content: str, required_facts: list[str] | None = None) -> JudgeIssueCreate:
    return JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content=content,
        required_facts=required_facts or [],
        style_rules=[],
        evidence_links=[],
    )


def test_semantic_judge_relocates_span_from_matched_text() -> None:
    """模型自报字符偏移不可靠：matched_text 能在正文反查到时，以反查偏移为准。"""

    content = "林岚走进值房。\n沈曜擦拭主灯的透镜。\n她举起右臂敲了敲窗。"

    def provider(request_payload: JudgeIssueCreate) -> list[dict[str, object]]:
        return [
            {
                "category": "setting_conflict",
                "severity": "high",
                "span_start": 0,
                "span_end": 2,
                "matched_text": "举起右臂",
                "expected_text": "右臂受伤",
                "replacement_text": "举起左臂",
                "summary": "右臂受伤不应能举起。",
            }
        ]

    issues = semantic_judge(_span_payload(content, ["右臂受伤"]), provider=provider)

    expected_start = content.index("举起右臂")
    assert issues[0].span_start == expected_start
    assert issues[0].span_end == expected_start + len("举起右臂")
    assert issues[0].matched_text == "举起右臂"


def test_semantic_judge_relocation_picks_occurrence_nearest_reported_span() -> None:
    """matched_text 多处出现时，取距模型自报位置最近的一处，避免定位跳到别处。"""

    content = "他点灯。屋外潮声起。他点灯。"
    second = content.index("点灯", content.index("点灯") + 1)

    def provider(request_payload: JudgeIssueCreate) -> list[dict[str, object]]:
        return [
            {
                "category": "setting_conflict",
                "severity": "high",
                "span_start": second + 1,
                "span_end": second + 2,
                "matched_text": "点灯",
                "expected_text": "涨潮夜不点灯",
                "replacement_text": "熄灯",
                "summary": "涨潮夜点灯违反铁律。",
            }
        ]

    issues = semantic_judge(_span_payload(content), provider=provider)

    assert issues[0].span_start == second
    assert issues[0].span_end == second + len("点灯")


def test_semantic_judge_keeps_clamped_span_when_matched_text_absent() -> None:
    """模型转述（原文里找不到 matched_text）时回退钳位后的自报 span，转述文本原样保留。"""

    content = "她沉默地走过长廊。"

    def provider(request_payload: JudgeIssueCreate) -> list[dict[str, object]]:
        return [
            {
                "category": "style_drift",
                "severity": "medium",
                "span_start": 3,
                "span_end": 9_999,
                "matched_text": "原文里不存在的转述句",
                "expected_text": "",
                "replacement_text": "",
                "summary": "转述定位。",
            }
        ]

    issues = semantic_judge(_span_payload(content), provider=provider)

    assert issues[0].span_start == 3
    assert issues[0].span_end == len(content)
    assert issues[0].matched_text == "原文里不存在的转述句"


def test_semantic_judge_unconfigured_sets_configured_false() -> None:
    """未配置 API key 时 configured=False 且 failed=False：调用方据此区分「没跑」与「干净通过」。"""

    outcome = semantic_judge_with_status(_span_payload("正文。"), llm_env={})

    assert outcome.configured is False
    assert outcome.failed is False
    assert outcome.issues == []


def test_semantic_judge_provider_path_reports_configured_true() -> None:
    """注入 provider 的路径视为已配置。"""

    outcome = semantic_judge_with_status(_span_payload("正文。"), provider=lambda payload: [])

    assert outcome.configured is True
    assert outcome.failed is False


def test_semantic_judge_serializes_voice_constraints_as_json(monkeypatch) -> None:
    """角色声音约束必须以合法 JSON 进 prompt（与 few-shot 同形状），不是 Python repr。"""

    import json as jsonlib

    captured: dict[str, object] = {}

    _install_fake_transport(monkeypatch, content="[]", captured=captured)

    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "test-key")

    constraints = [
        {"name": "林岚", "path": "人物/林岚.md", "notes": "语气克制，说话从不超过三句。"},
        {"name": "沈曜", "voice_traits": {"语气": "平静"}},
    ]
    semantic_judge_with_status(_span_payload("正文。"), character_voice_constraints=constraints)

    user_content = str(captured["json"]["messages"][1]["content"])
    assert jsonlib.dumps(constraints, ensure_ascii=False, default=str) in user_content
    assert "{'name'" not in user_content


def test_semantic_judge_input_shares_required_facts_limit() -> None:
    """入参类型与截断逻辑共用 REQUIRED_FACTS_MAX_LENGTH：到上限可过，超一条即校验拒绝。"""

    import pytest
    from pydantic import ValidationError

    from app.domains.judge.schemas import REQUIRED_FACTS_MAX_LENGTH, SemanticJudgeInput

    facts = [f"事实{i}" for i in range(REQUIRED_FACTS_MAX_LENGTH)]
    assert len(SemanticJudgeInput(content="正文。", required_facts=facts).required_facts) == REQUIRED_FACTS_MAX_LENGTH
    with pytest.raises(ValidationError):
        SemanticJudgeInput(content="正文。", required_facts=[*facts, "越界"])
