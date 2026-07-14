from __future__ import annotations

import json
from http.server import HTTPServer
from threading import Thread

import pytest
from book_generation_test_support import (
    _BookGenerationChatHandler,
    _draft_requests,
    _local_provider_base_url,
)
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common import llm_client
from app.common.metrics import book_generation_cost_cny_total, judge_calls_total
from app.domains.assets.models import Asset
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.book_generation import (
    BookGenerationPreflightError,
    _blueprint_payload,
    _create_generation_book,
    _default_planning_arcs,
    _evidence_summary,
    _generate_chapter,
    _retry_story_state_changes_schema,
    _seed_consistency_data,
    missing_book_generation_env,
    run_book_generation,
)
from app.domains.book_runs.book_generation_changes import (
    StoryStateRosterEntry,
    append_story_state_changes_instruction,
    extract_story_state_changes_from_content,
    extract_story_state_changes_from_tool_calls,
    normalize_story_state_changes_with_roster,
    stable_story_state_entity_id,
)
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.judge.models import JudgeIssue
from app.domains.model_runs.models import ModelRun
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger


def test_book_generation_reports_missing_private_env(session: Session) -> None:
    """缺少私有真实 LLM 配置时应明确阻止冒烟，且不触碰外部网络。"""

    assert missing_book_generation_env({}) == [
        "STORYFORGE_LLM_API_KEY",
        "STORYFORGE_LLM_BASE_URL",
        "STORYFORGE_LLM_MODEL",
        "STORYFORGE_LLM_PROVIDER",
    ]

    with pytest.raises(BookGenerationPreflightError, match="STORYFORGE_LLM_API_KEY"):
        run_book_generation(session, chapter_count=1, token_budget=1000, env={})


def test_book_generation_defaults_do_not_seed_demo_story_terms(session: Session) -> None:
    """真实生成默认题材不得继续播种 30 章退回里的 demo 词。"""

    book = _create_generation_book(session, chapter_count=18)
    _seed_consistency_data(session, book.id)
    payload = _blueprint_payload(book.id, 18)
    character = session.query(CharacterBibleEntry).one()
    style_pack = session.query(Asset).filter(Asset.asset_type == "style_pack").one()
    arcs = payload.metadata["planning_arcs"]
    serialized_defaults = json.dumps(
        {
            "book_premise": book.premise,
            "blueprint": payload.model_dump(),
            "character": {
                "name": character.canonical_name,
                "aliases": character.aliases,
                "forbidden_traits": character.forbidden_traits,
            },
            "style_pack": {"name": style_pack.name, "payload": style_pack.payload},
        },
        ensure_ascii=False,
    )

    for forbidden in ("林岚", "灯塔", "审计链"):
        assert forbidden not in serialized_defaults
    assert payload.metadata["pov"] == "沈砚"
    assert payload.metadata["location"] == "苍岭城"
    assert len(arcs) >= 3
    assert len({arc["arc_id"] for arc in arcs}) == len(arcs)
    assert all(arc["target_chapters"] != list(range(1, 19)) for arc in arcs)
    assert {arc["payoff_chapter"] for arc in arcs}


def test_story_state_changes_block_is_stripped_from_generated_content() -> None:
    """模型可在正文后附 CHANGES JSON；后端应剥离区块并保留结构化 changes。"""

    content = (
        "沈砚在钟楼下停步。\n"
        "【STORY_STATE_CHANGES】\n"
        '[{"change_type":"character.status","entity_kind":"character","entity_id":"沈砚","surface_forms":["沈砚"],"payload":{"status":"停步"}}]\n'
        "【/STORY_STATE_CHANGES】"
    )

    cleaned, changes = extract_story_state_changes_from_content(content)

    assert cleaned == "沈砚在钟楼下停步。"
    assert changes[0]["change_type"] == "character.status"


def test_story_state_changes_tool_calls_are_extracted() -> None:
    """OpenAI-compatible tool_calls 可作为 CHANGES 的结构化传输通道。"""

    tool_calls = [
        {
            "function": {
                "name": "record_story_state_changes",
                "arguments": json.dumps(
                    {
                        "changes": [
                            {
                                "change_type": "character.status",
                                "entity_kind": "character",
                                "entity_id": "沈砚",
                                "surface_forms": ["沈砚"],
                                "payload": {"status": "沈砚通过工具调用记录状态。"},
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
            }
        }
    ]

    changes = extract_story_state_changes_from_tool_calls(tool_calls)

    assert changes[0]["change_type"] == "character.status"
    assert changes[0]["payload"] == {"status": "沈砚通过工具调用记录状态。"}


def test_generate_chapter_prefers_story_state_tool_calls(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """模型同时返回 tool call 与正文 JSON block 时，应优先使用 tool call。"""

    import app.domains.book_runs.book_generation as generation

    book = Book(title="工具调用测试书", status="draft", premise="沈砚追查钟楼。")
    session.add(book)
    session.flush()
    chapter = Chapter(
        book_id=book.id,
        ordinal=1,
        title="钟楼下",
        status="planned",
        summary="沈砚在钟楼下发现新线索。",
        pov="沈砚",
        location="苍岭城",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    calls: list[dict[str, object]] = []

    def fake_call_llm(
        source,
        *,
        system_prompt: str,
        user_prompt: str,
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | dict[str, object] | None = None,
    ) -> dict[str, object]:
        calls.append(
            {
                "source": source,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "tools": tools,
                "tool_choice": tool_choice,
            }
        )
        block_change = {
            "change_type": "character.status",
            "entity_kind": "character",
            "entity_id": "沈砚",
            "surface_forms": ["沈砚"],
            "payload": {"status": "不应采用正文 JSON block。"},
        }
        tool_change = {
            "change_type": "character.status",
            "entity_kind": "character",
            "entity_id": "沈砚",
            "surface_forms": ["沈砚"],
            "payload": {"status": "应采用工具调用。"},
        }
        return {
            "content": (
                "沈砚在钟楼下停步。\n"
                "【STORY_STATE_CHANGES】\n"
                f"{json.dumps([block_change], ensure_ascii=False)}\n"
                "【/STORY_STATE_CHANGES】"
            ),
            "tool_calls": [
                {
                    "function": {
                        "name": "record_story_state_changes",
                        "arguments": json.dumps({"changes": [tool_change]}, ensure_ascii=False),
                    }
                }
            ],
            "token_usage": 30,
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "token_usage_source": "provider_usage",
            "cost_cny_estimated": 0.0,
            "cost_breakdown": {},
            "latency_ms": 1,
        }

    monkeypatch.setattr(generation, "_call_llm", fake_call_llm)

    generated = _generate_chapter(session, {}, 1, chapter)

    assert calls[0]["tools"][0]["function"]["name"] == "record_story_state_changes"
    assert calls[0]["tool_choice"] == "auto"
    assert generated["content"] == "沈砚在钟楼下停步。"
    assert generated["story_state_changes_source"] == "tool_call"
    assert generated["story_state_tool_call_count"] == 1
    assert generated["story_state_changes"][0]["payload"] == {"status": "应采用工具调用。"}


def test_story_state_changes_prompt_uses_roster_and_normalizes_stable_ids() -> None:
    """Writer prompt 应给出稳定 ID 花名册，后端提交前按花名册归一自由名。"""

    stable_id = stable_story_state_entity_id("character", "沈砚")
    roster = [
        StoryStateRosterEntry(
            entity_kind="character",
            entity_id=stable_id,
            canonical_name="沈砚",
            aliases=("山城巡检官",),
        )
    ]

    prompt = append_story_state_changes_instruction("正文 prompt", roster=roster)
    changes = normalize_story_state_changes_with_roster(
        [
            {
                "change_type": "character.status",
                "entity_kind": "character",
                "entity_id": "沈砚",
                "canonical_name": "沈砚",
                "surface_forms": ["沈砚"],
                "payload": {"status": "沈砚继续追查。"},
            }
        ],
        roster,
    )

    assert "故事状态花名册" in prompt
    assert stable_id in prompt
    assert changes[0]["entity_id"] == stable_id
    assert changes[0]["canonical_name"] == "沈砚"
    assert "山城巡检官" in changes[0]["aliases"]


def test_story_state_changes_schema_retry_repairs_json_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """CHANGES schema 不合格时只重试修 JSON，不重写章节正文。"""

    import app.domains.book_runs.book_generation as generation

    stable_id = stable_story_state_entity_id("character", "沈砚")
    roster = [StoryStateRosterEntry(entity_kind="character", entity_id=stable_id, canonical_name="沈砚")]
    calls: list[dict[str, object]] = []

    def fake_call_llm(source, *, system_prompt: str, user_prompt: str):
        calls.append({"source": source, "system_prompt": system_prompt, "user_prompt": user_prompt})
        return {
            "content": json.dumps(
                [
                    {
                        "change_type": "character.status",
                        "entity_kind": "character",
                        "entity_id": "沈砚",
                        "canonical_name": "沈砚",
                        "surface_forms": ["沈砚"],
                        "payload": {"status": "沈砚完成调查并留下证据。"},
                    }
                ],
                ensure_ascii=False,
            )
        }

    monkeypatch.setattr(generation, "_call_llm", fake_call_llm)

    changes = _retry_story_state_changes_schema(
        {"STORYFORGE_LLM_MODEL": "test"},
        prose="沈砚完成调查并留下证据。",
        invalid_changes=[{"entity_kind": "character", "entity_id": "沈砚"}],
        schema_errors=["第 1 条 change_type: Field required"],
        roster=roster,
    )

    assert calls
    assert "不要改写正文" in calls[0]["user_prompt"]
    assert changes[0]["entity_id"] == stable_id
    assert changes[0]["payload"]["status"] == "沈砚完成调查并留下证据。"


def test_default_planning_arcs_are_multi_arc_and_bounded() -> None:
    """默认弧线应是多 arc、目标章有界，避免单 arc 全书覆盖空转。"""

    arcs = _default_planning_arcs(18)
    all_targets = list(range(1, 19))

    assert len(arcs) == 3
    assert {arc["arc_id"] for arc in arcs} == {
        "missing_bellsmith_case",
        "patrol_oath_pressure",
        "city_bell_rule",
    }
    assert all(arc["target_chapters"] != all_targets for arc in arcs)
    assert all(1 <= chapter <= 18 for arc in arcs for chapter in arc["target_chapters"])
    assert all(arc["payoff_chapter"] in arc["target_chapters"] for arc in arcs)


def test_book_generation_runs_one_chapter_and_records_evidence(session: Session) -> None:
    """1 章真实 LLM 生成应完成 BookRun、记录 token，并导出可审计制品。"""

    _BookGenerationChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "700",
    }
    import os
    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_book_generation(session, chapter_count=1, token_budget=1000, env=env)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.total_chapters == 1
    assert result.book_run.tokens_used == 323
    assert result.markdown_artifact.name == "book.md"
    assert result.audit_artifact.name == "audit_report.json"
    assert len(_draft_requests()) == 1
    draft_request = _draft_requests()[0]
    assert draft_request["payload"]["max_completion_tokens"] == 700
    assert draft_request["headers"]["Authorization"] == "Bearer" + " test-private-credential"
    assert "结构化一致性评审员" not in draft_request["payload"]["messages"][0]["content"]
    assert "STORY_STATE_CHANGES" in draft_request["payload"]["messages"][-1]["content"]

    model_run = session.query(ModelRun).one()
    assert model_run.provider_name == "openai-compatible"
    assert model_run.model_name == "test-real-model"
    assert model_run.token_usage == 323
    assert model_run.payload["book_run_id"] == result.book_run.id
    assert model_run.payload["token_usage_source"] == "provider_usage"

    scene = session.query(Scene).one()
    assert scene.status == "approved"
    assert "真实章节正文" in scene.content
    assert "STORY_STATE_CHANGES" not in scene.content
    assert "test-private-credential" not in str(result.audit_artifact.payload)

    audit = result.audit_artifact.payload
    assert audit["quality_summary"]["average_score"] == 100
    assert audit["quality_summary"]["scored_chapter_count"] == 1
    assert audit["chapters"][0]["quality_score"] == 100

    stable_character_id = stable_story_state_entity_id("character", "沈砚")
    state_event = session.query(StoryStateEvent).filter(StoryStateEvent.entity_id == stable_character_id).one()
    state_ledger = session.query(StoryStateLedger).filter(StoryStateLedger.entity_id == stable_character_id).one()
    assert state_event.book_run_id == result.book_run.id
    assert state_event.chapter_index == 1
    assert state_event.change_type == "character.status"
    assert state_event.grounding["canonical_name"] == "沈砚"
    assert state_event.grounding["hard"] == "pass"
    assert state_ledger.book_run_id == result.book_run.id
    assert state_ledger.canonical_name == "沈砚"
    assert state_ledger.state["status"] == "沈砚完成调查并留下证据。"

    judge = session.query(JudgeIssue).one()
    assert judge.payload["story_state_commit"]["status"] == "committed"
    assert judge.payload["story_state_commit"]["event_count"] >= 1
    completed = result.book_run.progress["completed_chapters"][0]
    assert completed["story_state_commit"]["status"] == "committed"
    assert completed["memory_atom_ids"]
    assert completed["memory_recall_chars"] == 0


def test_book_generation_supports_api_key_auth_and_cost_breakdown(session: Session) -> None:
    """Token Plan 路径应支持 api-key 鉴权，并按输入/输出 token 估算人民币成本。"""

    _BookGenerationChatHandler.requests = []
    judge_metric_before = judge_calls_total._value.get()
    cost_metric_before = book_generation_cost_cny_total._value.get()
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_AUTH_HEADER": "api-key",
        "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "3.00",
        "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "6.00",
        "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": "0.025",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_book_generation(session, chapter_count=1, token_budget=1000, env=env)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    draft_request = _BookGenerationChatHandler.requests[0]
    request_headers = {str(key).lower(): value for key, value in draft_request["headers"].items()}
    assert request_headers["api-key"] == "test-private-credential"
    assert "authorization" not in request_headers

    model_run = session.query(ModelRun).one()
    assert model_run.payload["prompt_tokens"] == 101
    assert model_run.payload["completion_tokens"] == 222
    assert model_run.payload["total_tokens"] == 323
    assert model_run.payload["cost_cny_estimated"] == pytest.approx(0.001635, rel=1e-6)
    assert model_run.payload["cost_source"] == "provider_usage"

    completed = result.book_run.progress["completed_chapters"][0]
    assert completed["prompt_tokens"] == 101
    assert completed["completion_tokens"] == 222
    assert completed["generation_latency_ms"] >= 0
    assert completed["cost_estimate"] == pytest.approx(0.001635, rel=1e-6)
    assert result.book_run.estimated_cost == pytest.approx(0.001635, rel=1e-6)

    summary = _evidence_summary(
        result,
        target_word_count=1000,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
    )
    assert summary["prompt_tokens_used"] == 101
    assert summary["completion_tokens_used"] == 222
    assert summary["cost_cny_estimated"] == pytest.approx(0.001635, rel=1e-6)
    assert summary["cost_breakdown"]["input_cny"] == pytest.approx(0.000303, rel=1e-6)
    assert summary["cost_breakdown"]["output_cny"] == pytest.approx(0.001332, rel=1e-6)
    assert summary["total_latency_ms"] >= 0
    assert summary["failure_count"] == 0
    assert summary["repair_round_count"] == 0
    assert summary["per_chapter_metrics"][0]["story_state_changes_source"] == "json_block"
    assert summary["per_chapter_metrics"][0]["story_state_tool_call_count"] == 0
    assert judge_calls_total._value.get() == judge_metric_before + 1
    assert book_generation_cost_cny_total._value.get() == pytest.approx(cost_metric_before + 0.001635, rel=1e-6)


def test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """确定性与本地一致性门禁通过时，语义 Judge 仍跑一遍，但只作为咨询信号。"""

    _BookGenerationChatHandler.requests = []
    semantic_requests: list[dict[str, object]] = []
    original_request = llm_client._request_chat_completions

    def capture_semantic_request(
        source,
        payload,
        *,
        timeout_seconds=None,
        max_attempts=None,
    ):
        system_prompt = str(payload["messages"][0]["content"])
        if "结构化一致性评审员" in system_prompt or "故事状态 grounding 审查员" in system_prompt:
            semantic_requests.append(
                {
                    "source": dict(source),
                    "payload": payload,
                    "timeout_seconds": timeout_seconds,
                    "max_attempts": max_attempts,
                }
            )
            return {"choices": [{"message": {"content": "[]"}}]}, 0.0
        return original_request(
            source,
            payload,
            timeout_seconds=timeout_seconds,
            max_attempts=max_attempts,
        )

    monkeypatch.setattr(llm_client, "_request_chat_completions", capture_semantic_request)
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_API_KEY", "judge-private-credential")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_BASE_URL", "https://judge.example/v1")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_MODEL", "judge-test-model")
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_book_generation(session, chapter_count=1, token_budget=1000, env=env)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert len(_draft_requests()) == 1
    assert len(semantic_requests) == 2
    assert semantic_requests[0]["source"]["STORYFORGE_LLM_BASE_URL"] == "https://judge.example/v1"
    assert all(request["max_attempts"] == 1 for request in semantic_requests)
    assert any(
        "故事状态 grounding 审查员" in request["payload"]["messages"][0]["content"]
        for request in semantic_requests
    )

    judge = session.query(JudgeIssue).one()
    assert judge.issue_type == "phase9b_real_judge_pass"
    assert judge.payload["judge_fast_path"] == "local_gate_passed_semantic_advisory"
    assert judge.payload["semantic_advisory"] == {
        "mode": "advisory",
        "required": True,
        "failed": False,
        "issue_count": 0,
        "issues": [],
    }
    assert judge.payload["story_state_commit"]["status"] == "committed"
    assert result.book_run.progress["completed_chapters"][0]["quality_score"] == 100
    assert result.book_run.progress["completed_chapters"][0]["quality_issues"] == []


def test_book_generation_runs_ten_chapters_with_word_targets(session: Session) -> None:
    """10 章真实 LLM 生成应把字数目标写入蓝图和 prompt，并产出完整 audit。"""

    _BookGenerationChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_book_generation(
            session,
            chapter_count=10,
            token_budget=10000,
            target_word_count=50000,
            chapter_word_count_min=3000,
            chapter_word_count_max=5000,
            env=env,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 10
    assert result.book_run.total_chapters == 10
    assert result.book_run.tokens_used == 3230

    blueprint = session.query(BookBlueprint).one()
    assert blueprint.target_word_count == 50000
    assert blueprint.target_chapter_count == 10
    assert blueprint.chapter_word_count_min == 3000
    assert blueprint.chapter_word_count_max == 5000

    draft_requests = _draft_requests()
    assert len(draft_requests) == 10
    assert all("3000–5000 字" in item["payload"]["messages"][-1]["content"] for item in draft_requests)
    assert all(item["headers"]["Authorization"] == "Bearer" + " test-private-credential" for item in _BookGenerationChatHandler.requests)

    assert session.query(ModelRun).count() == 10
    audit = result.audit_artifact.payload
    assert len(audit["chapters"]) == 10
    assert audit["quality_summary"]["scored_chapter_count"] == 10
    assert audit["skill_chain"]["summary"]["completed_chapter_count"] == 10
    assert audit["integration_metrics"]["context_cache_hit_rate"] >= 0.95
    assert 0 < audit["integration_metrics"]["memory_recall_budget_used"] < 8000
    assert audit["integration_metrics"]["arc_completion_rate"] >= 0.7
    assert audit["integration_metrics"]["db_query_count_per_chapter"] <= 3
    assert audit["integration_metrics"]["chapter_generation_time_p50"] < 20
    assert audit["integration_metrics"]["concurrent_chapter_utilization"] == 0.0
    assert audit["quality_summary"]["integration_metrics"] == audit["integration_metrics"]
    assert result.book_run.progress["integration_metrics"]["metric_scope"] == "phase9b_direct_smoke_serial"
    completed = result.book_run.progress["completed_chapters"]
    assert all(item["memory_atom_ids"] for item in completed)
    assert completed[0]["memory_recall_chars"] == 0
    assert completed[1]["memory_recall_chars"] > 0
    assert "test-private-credential" not in str(result.audit_artifact.payload)
