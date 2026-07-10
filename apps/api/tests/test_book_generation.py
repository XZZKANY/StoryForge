from __future__ import annotations

import json
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common import llm_client
from app.common.metrics import book_generation_cost_cny_total, book_generation_failure_count_total, judge_calls_total
from app.domains.assets.models import Asset
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    BookGenerationPreflightError,
    _apply_word_count_floor,
    _assert_no_missing_chapters,
    _blueprint_payload,
    _build_judge_payload,
    _count_approved_chapters,
    _create_generation_book,
    _default_planning_arcs,
    _evidence_summary,
    _finalize_scene_decision,
    _generate_chapter,
    _prior_chapters_recap,
    _record_model_run,
    _retry_story_state_changes_schema,
    _seed_consistency_data,
    _strip_reasoning_leak,
    main,
    missing_book_generation_env,
    resume_book_generation,
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
from app.domains.book_runs.book_generation_judge import _record_summary_judge
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.continuity.models import ScenePacket
from app.domains.judge.deterministic import CONFLICT_ONLY_FACT_PREFIX, deterministic_judge_fallback
from app.domains.judge.models import JudgeIssue
from app.domains.model_runs.models import ModelRun
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger
from app.domains.story_state.service import commit_story_state_changes


class _BookGenerationChatHandler(BaseHTTPRequestHandler):
    """模拟 OpenAI 兼容 Chat Completions，用于验证真实协议边界（生成 + Judge）。"""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        self.__class__.requests.append({"headers": dict(self.headers), "payload": payload})
        system_prompt = payload["messages"][0]["content"] if payload["messages"] else ""
        user_prompt = payload["messages"][-1]["content"]
        if "结构化一致性评审员" in system_prompt:
            response_content = "[]"
        else:
            # 按 prompt 中的「N–M 字」区间生成足量正文，确保通过字数硬门禁。
            target_chars = 800
            match = re.search(r"（(\d+)[–\-](\d+)\s*字）", user_prompt)
            if match:
                target_chars = (int(match.group(1)) + int(match.group(2))) // 2
            head = f"真实章节正文：{user_prompt[:32]}。沈砚完成调查并留下证据。"
            filler = "她沿着走廊核对每一处线索，把证据逐条登记入册。" * 200
            prose = (head + filler)[:target_chars]
            response_content = (
                prose
                + "\n【STORY_STATE_CHANGES】\n"
                + json.dumps(
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
                + "\n【/STORY_STATE_CHANGES】"
            )
        body = json.dumps(
            {
                "choices": [{"message": {"content": response_content}}],
                "usage": {"prompt_tokens": 101, "completion_tokens": 222, "total_tokens": 323},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _local_provider_base_url(port: int) -> str:
    return "http" + f"://127.0.0.1:{port}/v1"


def _draft_requests() -> list[dict[str, object]]:
    return [
        item
        for item in _BookGenerationChatHandler.requests
        if _request_system_prompt(item) not in {"结构化一致性评审员", "故事状态 grounding 审查员"}
    ]


def _request_system_prompt(item: dict[str, object]) -> str:
    payload = item["payload"]
    assert isinstance(payload, dict)
    messages = payload["messages"]
    assert isinstance(messages, list)
    first_message = messages[0]
    assert isinstance(first_message, dict)
    content = str(first_message["content"])
    if "结构化一致性评审员" in content:
        return "结构化一致性评审员"
    if "故事状态 grounding 审查员" in content:
        return "故事状态 grounding 审查员"
    return "writer"


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


def _seed_gate_fixture(
    session: Session,
    *,
    content: str,
    word_min: int = 600,
    word_max: int = 1600,
) -> tuple[BookRun, Chapter, Scene]:
    """搭一套最小 book/blueprint/chapter/draft-scene/book_run，用于直接验证门禁函数。"""

    book = Book(title="门禁测试", status="draft", premise="验证门禁。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="验证门禁。",
        tone="克制",
        target_word_count=12000,
        target_chapter_count=10,
        chapter_word_count_min=word_min,
        chapter_word_count_max=word_max,
        status="locked",
        metadata_={},
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    chapter = Chapter(book_id=book.id, ordinal=1, title="第一章", status="planned")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="正文", status="draft", content=content)
    session.add(scene)
    session.commit()
    session.refresh(scene)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        current_chapter_index=1,
        total_chapters=10,
        progress={},
        checkpoint=[],
        token_budget=800000,
        tokens_used=0,
        chapter_budget=10,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    return book_run, chapter, scene


def test_book_generation_judge_payload_uses_story_state_required_facts(session: Session) -> None:
    """Q4：Judge payload 应从 story_state 当前态投影注入冲突-only 已知事实。"""

    book_run, _first_chapter, _first_scene = _seed_gate_fixture(
        session,
        content="林岚左臂受伤。",
        word_min=1,
    )
    commit_story_state_changes(
        session,
        book_id=book_run.book_id,
        book_run_id=book_run.id,
        chapter_index=1,
        prose="林岚左臂受伤。",
        changes=[
            {
                "change_type": "character.status",
                "entity_kind": "character",
                "entity_id": "林岚",
                "canonical_name": "林岚",
                "surface_forms": ["林岚", "左臂受伤"],
                "payload": {"status": "左臂受伤"},
            }
        ],
    )
    chapter = Chapter(
        book_id=book_run.book_id,
        blueprint_id=book_run.blueprint_id,
        ordinal=2,
        title="第二章",
        status="planned",
        summary="验证真相源注入。",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="矛盾正文",
        status="draft",
        content="林岚左臂完好无损，仍然照常完成谈判。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    packet = ScenePacket(scene_id=scene.id, packet={"book_run_id": book_run.id})
    session.add(packet)
    session.commit()
    session.refresh(packet)

    payload = _build_judge_payload(session, scene, packet)
    issues = deterministic_judge_fallback(payload)

    assert f"{CONFLICT_ONLY_FACT_PREFIX}左臂受伤" in payload.required_facts
    assert payload.evidence_links[0]["source"] == "story_state_ledger"
    assert [issue.category for issue in issues] == ["setting_conflict"]
    assert issues[0].matched_text == "左臂完好无损"


def test_conflict_only_story_state_fact_does_not_require_restatement(session: Session) -> None:
    """已知事实只查直接矛盾，不要求每章机械复述。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="林岚沉默地走进港口。", word_min=1)
    packet = ScenePacket(scene_id=scene.id, packet={"book_run_id": book_run.id})
    payload = _build_judge_payload(session, scene, packet).model_copy(
        update={"required_facts": [f"{CONFLICT_ONLY_FACT_PREFIX}左臂受伤"]}
    )

    assert deterministic_judge_fallback(payload) == []


def test_deterministic_judge_flags_forbidden_draft_system_terms(session: Session) -> None:
    """API 真实 judge 自包含检测系统/流程词，不依赖 workflow ForbiddenDraftTermsFilter。"""

    _book_run, _chapter, scene = _seed_gate_fixture(
        session,
        content="林岚推开门，像进入 Phase 测试 workflow，等待模型给出答案。",
        word_min=1,
    )
    packet = ScenePacket(scene_id=scene.id, packet={})
    payload = _build_judge_payload(session, scene, packet)

    issues = deterministic_judge_fallback(payload)

    forbidden_issues = [issue for issue in issues if issue.category == "forbidden_draft_term"]
    assert [issue.matched_text for issue in forbidden_issues] == ["Phase", "测试", "workflow", "模型"]
    assert all(issue.severity == "high" for issue in forbidden_issues)


def test_word_count_floor_caps_score_for_short_chapter(session: Session) -> None:
    """正文低于蓝图下限时，字数硬门禁应把分数压到批准阈值以下并记结构性问题。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="太短的占位正文。", word_min=600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_count_approved_chapters_excludes_unapproved() -> None:
    """计数失真回归：处理过但未批准的章（如失控被拒批）不应计入产出章数，
    避免 run 报「30/30 completed」却丢章而 failure_count=0 误导审计。"""

    completed = [
        {"chapter_index": 1, "approved": True},
        {"chapter_index": 2, "approved": True},
        {"chapter_index": 3, "approved": False},  # 失控/截断被拒批，仅处理未产出
        {"chapter_index": 4, "approved": True},
    ]
    assert _count_approved_chapters(completed) == 3
    assert len(completed) == 4  # 处理数仍是 4，与产出数 3 区分


def test_count_approved_chapters_empty_is_zero() -> None:
    assert _count_approved_chapters([]) == 0


def test_strip_reasoning_leak_removes_paired_think_block() -> None:
    """成对 <think>…</think> 整段剥掉，只留正文。"""

    raw = "<think>我先规划一下本章节奏</think>林岚走进码头，海风很冷。"
    assert _strip_reasoning_leak(raw) == "林岚走进码头，海风很冷。"


def test_strip_reasoning_leak_handles_orphan_closing_tag() -> None:
    """第29章真实事故形态：开标签被上游吞掉，只剩 </think>，其前的推理草稿
    与重写的第一遍正文都应丢弃，只保留最后一个闭合标签之后的成稿。"""

    raw = "审计链又多了一环，准备重写。</think>林岚的冲锋舟切开夜色里的海面。"
    assert _strip_reasoning_leak(raw) == "林岚的冲锋舟切开夜色里的海面。"
    assert "</think>" not in _strip_reasoning_leak(raw)


def test_strip_reasoning_leak_keeps_last_segment_with_multiple_closings() -> None:
    """多个闭合标签时只保留最后一段，避免中间的推理残体混入。"""

    raw = "草稿A</think>草稿B</think>最终正文。"
    assert _strip_reasoning_leak(raw) == "最终正文。"


def test_strip_reasoning_leak_orphan_closing_tag_is_case_insensitive() -> None:
    """大小写变体 </Think> 与小写同语义：切到最后一个闭合标签之后。

    回归背景：旧实现 search 大小写不敏感、rfind 却大小写敏感，遇变体时
    rfind 返回 -1，切片退化为 cleaned[7:]，静默砍掉正文前 7 个字符。"""

    raw = "推理草稿。</Think>林岚推开值房的门。"
    assert _strip_reasoning_leak(raw) == "林岚推开值房的门。"


def test_strip_reasoning_leak_mixed_case_never_decapitates_content() -> None:
    """变体闭合标签在末尾时按同一语义丢弃其前全部内容、返回空串，
    由调用方抛「仅含思维链」明确报错——绝不允许旧实现那种砍头式静默损坏。"""

    raw = "# 第三章 晨渡\n\n正文段落。</THINK>"
    assert _strip_reasoning_leak(raw) == ""


def test_strip_reasoning_leak_preserves_clean_content() -> None:
    """无泄漏的干净正文除首尾空白外原样保留。"""

    raw = "  林岚点了点头。她没追问。  "
    assert _strip_reasoning_leak(raw) == "林岚点了点头。她没追问。"


def test_strip_reasoning_leak_removes_orphan_opening_tag() -> None:
    """有开无闭的孤立 <think> 标记本身抹掉，不让标签裸露在成稿里。"""

    raw = "<think>正文其实从这里开始，标记本不该出现。"
    assert _strip_reasoning_leak(raw) == "正文其实从这里开始，标记本不该出现。"


def test_word_count_floor_passes_chapter_within_bounds(session: Session) -> None:
    """正文落在区间内时，字数门禁不动分数也不加问题。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 900, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_over_target_within_runaway_factor_passes(session: Session) -> None:
    """超目标上限但在失控线（上限 × 2.5）内的密实正文应通过，不再误伤偏长好内容。"""

    # word_max=1600 → 失控线 4000；2400 字超目标上限但远低于失控线。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 2400, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_caps_score_for_runaway_chapter(session: Session) -> None:
    """正文超过失控线（上限 × 2.5）时，仍判失控并压分拒批，保留防重复/失控护栏。"""

    # word_max=1600 → 失控线 4000；4500 字判失控。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 4500, word_min=600, word_max=1600)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_word_count_floor_accepts_chapter_just_under_target_floor(session: Session) -> None:
    """ch8/ch12 回归：完整但略短于蓝图下限（下限×容差以上）的章不再被硬拒，
    否则 1990/2000 这种近下限好章会被判死、导出时丢成空洞。"""

    # 下限 2000 → 截断下限 1600；1990 字完整正文应通过。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 1990, word_min=2000, word_max=2500)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score == 100
    assert issues == []


def test_word_count_floor_still_rejects_truncated_chapter_below_tolerance(session: Session) -> None:
    """容差之下（下限×容差以下）的明显截断仍硬拒，保留防截断护栏不被容差架空。"""

    # 下限 2000 → 截断下限 1600；1200 字判截断。
    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 1200, word_min=2000, word_max=2500)
    score, issues = _apply_word_count_floor(session, book_run, scene, 100, [])
    assert score < 70
    assert any(item["category"] == "word_count_violation" for item in issues)


def test_record_summary_judge_does_not_mark_subthreshold_as_passed(session: Session) -> None:
    """汇总 Judge 记录：分数未达批准阈值时不得误标「章节通过」（ch8/ch12 score=69 却记通过的回归）。"""

    book_run, _chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    packet = ScenePacket(scene_id=scene.id, job_run_id=None, status="assembled", packet={}, version=1)
    session.add(packet)
    session.commit()
    session.refresh(packet)

    sub = _record_summary_judge(session, scene, packet, 69)
    assert sub.issue_type != "phase9b_real_judge_pass"
    assert "章节通过" not in sub.description
    assert "未通过" in sub.description

    ok = _record_summary_judge(session, scene, packet, 100)
    assert ok.issue_type == "phase9b_real_judge_pass"
    assert "章节通过" in ok.description


def test_missing_chapter_guard_blocks_completed_on_gap(session: Session) -> None:
    """缺章护栏：completed_chapters 存在未批准章时拒绝标 completed，并把 run 落为 failed。"""

    book_run, _chapter, _scene = _seed_gate_fixture(session, content="字" * 900)
    completed = [
        {"chapter_index": 1, "approved": True},
        {"chapter_index": 2, "approved": False},  # 被门禁判死，导出会丢成空洞
        {"chapter_index": 3, "approved": True},
    ]
    with pytest.raises(BookGenerationError, match="缺章护栏"):
        _assert_no_missing_chapters(session, book_run.id, 3, completed, 1234)
    session.refresh(book_run)
    assert book_run.status == "failed"


def test_missing_chapter_guard_passes_when_all_approved(session: Session) -> None:
    """全部章批准产出时护栏放行，不抛错、不改 run 状态。"""

    book_run, _chapter, _scene = _seed_gate_fixture(session, content="字" * 900)
    completed = [{"chapter_index": index, "approved": True} for index in range(1, 4)]
    _assert_no_missing_chapters(session, book_run.id, 3, completed, 0)
    session.refresh(book_run)
    assert book_run.status == "running"


def test_finalize_scene_decision_refuses_subthreshold_chapter(session: Session) -> None:
    """门禁后置：评分低于阈值的章节不批准、不进上下文、不进导出。"""

    from app.domains.book_runs.book_context import clear_book_context_cache, get_book_context

    book_run, chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    clear_book_context_cache(chapter.book_id)
    approved = _finalize_scene_decision(session, chapter, scene, 40)
    assert approved is False
    session.refresh(scene)
    session.refresh(chapter)
    assert scene.status == "needs_revision"
    assert chapter.status != "approved"
    context = get_book_context(session, chapter.book_id)
    assert all(ch.chapter_id != chapter.id for ch in context.approved_chapters)


def test_finalize_scene_decision_approves_passing_chapter(session: Session) -> None:
    """评分达标的章节批准、章节状态置 approved 并进上下文。"""

    from app.domains.book_runs.book_context import clear_book_context_cache, get_book_context

    book_run, chapter, scene = _seed_gate_fixture(session, content="字" * 900)
    clear_book_context_cache(chapter.book_id)
    approved = _finalize_scene_decision(session, chapter, scene, 100)
    assert approved is True
    session.refresh(scene)
    session.refresh(chapter)
    assert scene.status == "approved"
    assert chapter.status == "approved"
    context = get_book_context(session, chapter.book_id)
    assert any(ch.chapter_id == chapter.id for ch in context.approved_chapters)


def test_book_generation_truncates_long_model_run_summaries(session: Session) -> None:
    """长程 prompt 超过 ModelRun schema 上限时，只裁剪入库摘要，不阻断运行。"""

    book = Book(title="长摘要测试", status="draft", premise="验证长程 prompt 入库摘要。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="验证长程 prompt 入库摘要。",
        tone="克制",
        target_word_count=35000,
        target_chapter_count=30,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
        status="locked",
        metadata_={},
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    chapter = Chapter(book_id=book.id, ordinal=21, title="真实生成 21", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="真实 LLM 正文", status="approved", content="正文")
    session.add(scene)
    session.commit()
    session.refresh(scene)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        current_chapter_index=1,
        total_chapters=30,
        progress={},
        checkpoint=[],
        token_budget=800000,
        tokens_used=0,
        chapter_budget=30,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    prompt = "prompt-start-" + ("甲" * 60000) + "-prompt-end"
    content = "content-start-" + ("乙" * 60000) + "-content-end"

    model_run = _record_model_run(
        session,
        book_run,
        scene,
        {
            "STORYFORGE_LLM_PROVIDER": "openai-compatible",
            "STORYFORGE_LLM_MODEL": "local-model",
        },
        {
            "prompt": prompt,
            "content": content,
            "latency_ms": 123,
            "token_usage": 456,
            "token_usage_source": "provider_usage",
        },
    )

    assert len(model_run.input_summary) <= 50000
    assert len(model_run.output_summary or "") <= 50000
    assert "prompt-start-" in model_run.input_summary
    assert "-prompt-end" in model_run.input_summary
    assert "content-start-" in (model_run.output_summary or "")
    assert "-content-end" in (model_run.output_summary or "")
    assert "摘要已截断" in model_run.input_summary
    assert model_run.payload["input_summary_original_length"] == len(prompt)
    assert model_run.payload["output_summary_original_length"] == len(content)
    assert model_run.payload["input_summary_truncated"] is True
    assert model_run.payload["output_summary_truncated"] is True


def test_book_generation_resume_continues_after_existing_approved_chapters(session: Session) -> None:
    """断点续跑应复用已批准章节，只从下一章继续生成并导出完整证据。"""

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
        partial = run_book_generation(
            session,
            chapter_count=2,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
            env=env,
        )
        partial.book_run.status = "running"
        partial.book_run.total_chapters = 4
        partial.book_run.chapter_budget = 4
        partial.book_run.progress = {"completed_chapters": []}
        for chapter in session.query(Chapter).order_by(Chapter.ordinal).all():
            chapter.blueprint_id = partial.book_run.blueprint_id
        session.commit()

        for ordinal in (3, 4):
            session.add(
                Chapter(
                    book_id=partial.book_run.book_id,
                    blueprint_id=partial.book_run.blueprint_id,
                    ordinal=ordinal,
                    title=f"真实生成 {ordinal}",
                    status="planned",
                    summary=f"第 {ordinal} 章继续推进调查。",
                    required_beats=[],
                )
            )
        session.commit()
        _BookGenerationChatHandler.requests = []

        result = resume_book_generation(
            session,
            book_run_id=partial.book_run.id,
            chapter_count=4,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
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
    assert result.book_run.current_chapter_index == 4
    assert result.book_run.total_chapters == 4
    assert len(result.book_run.progress["completed_chapters"]) == 4
    assert [item["chapter_index"] for item in result.book_run.progress["completed_chapters"]] == [1, 2, 3, 4]
    assert [item["quality_score"] for item in result.book_run.progress["completed_chapters"][:2]] == [100, 100]
    assert session.query(ModelRun).count() == 4
    assert len(_draft_requests()) == 2
    assert "第 3 章" in str(result.markdown_artifact.payload)
    assert "第 4 章" in str(result.markdown_artifact.payload)


class _FakeSession:
    def __enter__(self) -> str:
        return "fake-session"

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


def _seed_recap_chapters(session: Session, *, count: int, body_chars: int) -> int:
    book = Book(title="recap", status="draft", premise="验证有界 recap。")
    session.add(book)
    session.commit()
    session.refresh(book)
    for ordinal in range(1, count + 1):
        chapter = Chapter(
            book_id=book.id,
            ordinal=ordinal,
            title=f"第{ordinal}章",
            status="approved",
            summary=f"第{ordinal}章梗概：林岚推进调查到阶段{ordinal}。",
        )
        session.add(chapter)
        session.commit()
        session.refresh(chapter)
        scene = Scene(
            chapter_id=chapter.id,
            ordinal=1,
            title=f"第{ordinal}章正文",
            status="approved",
            content=f"CH{ordinal}_BODY_" + ("正" * body_chars),
        )
        session.add(scene)
    session.commit()
    return book.id


def test_prior_chapters_recap_is_bounded_and_keeps_recent_full_text(session: Session) -> None:
    """有界 recap：最近 N 章给完整正文，更早章节只出梗概，总长受上限约束。"""

    book_id = _seed_recap_chapters(session, count=5, body_chars=2000)

    # 为第 6 章构建上文（前 5 章已批准）。
    recap = _prior_chapters_recap(session, book_id, ordinal=6, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000

    # 最近 2 章（第 4、5 章）正文必须在内。
    assert "CH5_BODY_" in recap
    assert "CH4_BODY_" in recap
    # 更早章节（第 1-3 章）只出梗概，不出完整正文。
    assert "CH3_BODY_" not in recap
    assert "CH1_BODY_" not in recap
    assert "前情提要" in recap
    assert "第3章梗概" in recap


def test_prior_chapters_recap_length_stays_bounded_as_chapters_grow(session: Session) -> None:
    """章数从 5 增到 20 时，recap 长度仍受同一上限约束，不随章数膨胀。"""

    book_id = _seed_recap_chapters(session, count=20, body_chars=2000)
    recap = _prior_chapters_recap(session, book_id, ordinal=21, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000


def test_prior_chapters_recap_returns_none_for_first_chapter(session: Session) -> None:
    book_id = _seed_recap_chapters(session, count=3, body_chars=50)
    assert _prior_chapters_recap(session, book_id, ordinal=1) is None



def test_book_generation_cli_prints_summary_without_secret() -> None:
    """CLI 入口应输出可粘贴到验证报告的摘要，且不能泄露密钥。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 10
        assert token_budget == 1000
        assert target_word_count == 50000
        assert chapter_word_count_min == 3000
        assert chapter_word_count_max == 5000
        assert max_chapter_count == 30
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=7, status="completed", tokens_used=323, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=8, name="book.md"),
            audit_artifact=SimpleNamespace(id=9, name="audit_report.json"),
            chapter_count=10,
        )

    exit_code = main(
        [
            "--chapter-count",
            "10",
            "--token-budget",
            "1000",
            "--target-word-count",
            "50000",
            "--chapter-word-count-min",
            "3000",
            "--chapter-word-count-max",
            "5000",
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    summary = json.loads(output.getvalue())
    assert summary == {
        "book_run_id": 7,
        "status": "completed",
        "chapter_count": 10,
        "tokens_used": 323,
        "estimated_cost": 0.0,
        "markdown_artifact_id": 8,
        "markdown_artifact_name": "book.md",
        "audit_artifact_id": 9,
        "audit_artifact_name": "audit_report.json",
    }
    assert error.getvalue() == ""
    assert "test-private-credential" not in output.getvalue()


def test_book_generation_cli_allows_q9_chapter_band_with_parameterized_cap() -> None:
    """Q9 16-18 章长跑不应被旧 10 章 CLI 上限卡住；上限需显式可配。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 18
        assert token_budget == 200000
        assert target_word_count == 40000
        assert chapter_word_count_min == 2000
        assert chapter_word_count_max == 2500
        assert max_chapter_count == 18
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=18, status="completed", tokens_used=1000, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=19, name="book.md"),
            audit_artifact=SimpleNamespace(id=20, name="audit_report.json"),
            chapter_count=18,
        )

    exit_code = main(
        [
            "--chapter-count",
            "18",
            "--token-budget",
            "200000",
            "--target-word-count",
            "40000",
            "--chapter-word-count-min",
            "2000",
            "--chapter-word-count-max",
            "2500",
            "--max-chapter-count",
            "18",
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    assert error.getvalue() == ""
    assert json.loads(output.getvalue())["chapter_count"] == 18


def test_book_generation_cli_writes_redacted_summary_file(tmp_path: Path) -> None:
    """CLI 应写入脱敏 summary.json，供真实 smoke 产物验收。"""

    output = StringIO()
    error = StringIO()
    summary_path = tmp_path / "summary.json"
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    book_md = (
        "---\n"
        "book_run_id: 11\n"
        "---\n\n"
        "# \u6d4b\u8bd5\u4e66\n\n"
        "## \u7b2c 1 \u7ae0 \u8d77\u70b9\n\n"
        "\u7b2c\u4e00\u7ae0\u6b63\u6587\n\n"
        "## \u7b2c 2 \u7ae0 \u8f6c\u6298\n\n"
        "\u7b2c\u4e8c\u7ae0\u66f4\u957f\u6b63\u6587"
    )

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 2
        assert token_budget == 60000
        assert target_word_count == 1200
        assert chapter_word_count_min == 600
        assert chapter_word_count_max == 1600
        assert max_chapter_count == 30
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=11,
                status="completed",
                tokens_used=456,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": 1,
                            "token_usage": 200,
                            "quality_score": 92,
                            "quality_issues": [],
                            "elapsed_time_sec": 17,
                            "repair_rounds": 0,
                            "story_state_changes_source": "tool_call",
                            "story_state_tool_call_count": 1,
                        },
                        {
                            "chapter_index": 2,
                            "token_usage": 256,
                            "quality_score": 88,
                            "quality_issues": [{"summary": "需人工复核"}],
                            "elapsed_time_sec": 23,
                            "repair_rounds": 1,
                            "story_state_changes_source": "json_block",
                            "story_state_tool_call_count": 0,
                        },
                    ],
                    "budget": {"tokens_used": 456, "estimated_cost": 0.0, "elapsed_time_sec": 17},
                },
            ),
            markdown_artifact=SimpleNamespace(id=12, name="book.md", payload={"content": book_md}),
            audit_artifact=SimpleNamespace(
                id=13,
                name="audit_report.json",
                payload={
                    "chapters": [{"chapter_index": 1}, {"chapter_index": 2}],
                    "quality_summary": {"issue_count": 1},
                    "integration_metrics": {
                        "context_cache_hit_rate": 0.96,
                        "memory_recall_budget_used": 7999,
                        "arc_completion_rate": 0.71,
                        "db_query_count_per_chapter": 3,
                        "chapter_generation_time_p50": 19,
                        "concurrent_chapter_utilization": 0.61,
                    },
                },
            ),
            chapter_count=2,
        )

    exit_code = main(
        [
            "--chapter-count",
            "2",
            "--token-budget",
            "60000",
            "--target-word-count",
            "1200",
            "--chapter-word-count-min",
            "600",
            "--chapter-word-count-max",
            "1600",
            "--summary-output",
            str(summary_path),
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    assert error.getvalue() == ""
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mode"] == "real_llm_smoke"
    assert summary["book_run_id"] == 11
    assert summary["book_run_status"] == "completed"
    assert summary["target_chapter_count"] == 2
    assert summary["actual_chapter_count"] == 2
    assert summary["target_word_count"] == 1200
    assert summary["chapter_word_count_min"] == 600
    assert summary["chapter_word_count_max"] == 1600
    assert summary["tokens_used"] == 456
    assert summary["estimated_cost"] == 0.0
    assert summary["actual_total_chars"] == len(book_md)
    assert summary["per_chapter_char_counts"] == [
        {"chapter_index": 1, "char_count": len("第一章正文")},
        {"chapter_index": 2, "char_count": len("第二章更长正文")},
    ]
    assert summary["markdown_artifact_id"] == 12
    assert summary["audit_artifact_id"] == 13
    assert [
        {
            key: metric[key]
            for key in (
                "chapter_index",
                "token_usage",
                "quality_score",
                "quality_issue_count",
                "elapsed_time_sec",
                "repair_rounds",
                "story_state_changes_source",
                "story_state_tool_call_count",
            )
        }
        for metric in summary["per_chapter_metrics"]
    ] == [
        {
            "chapter_index": 1,
            "token_usage": 200,
            "quality_score": 92,
            "quality_issue_count": 0,
            "elapsed_time_sec": 17,
            "repair_rounds": 0,
            "story_state_changes_source": "tool_call",
            "story_state_tool_call_count": 1,
        },
        {
            "chapter_index": 2,
            "token_usage": 256,
            "quality_score": 88,
            "quality_issue_count": 1,
            "elapsed_time_sec": 23,
            "repair_rounds": 1,
            "story_state_changes_source": "json_block",
            "story_state_tool_call_count": 0,
        },
    ]
    assert summary["prompt_tokens_used"] == 0
    assert summary["completion_tokens_used"] == 0
    assert summary["cost_breakdown"]["currency"] == "CNY"
    assert summary["failure_count"] == 0
    assert summary["repair_round_count"] == 1
    assert summary["artifact_hashes"]["book_md_sha256"]
    assert summary["artifact_hashes"]["audit_report_sha256"]
    assert summary["integration_metrics"] == {
        "context_cache_hit_rate": 0.96,
        "memory_recall_budget_used": 7999,
        "arc_completion_rate": 0.71,
        "db_query_count_per_chapter": 3,
        "chapter_generation_time_p50": 19,
        "concurrent_chapter_utilization": 0.61,
    }
    serialized = json.dumps(summary, ensure_ascii=False)
    assert "test-private-credential" not in serialized
    assert "provider.test" not in serialized


def test_book_generation_cli_rejects_non_positive_target_word_count() -> None:
    """CLI 应在会话创建前拒绝非正数总字数目标。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def session_factory() -> _FakeSession:
        raise AssertionError("参数校验失败时不应创建数据库会话。")

    exit_code = main(
        ["--chapter-count", "10", "--token-budget", "1000", "--target-word-count", "-1"],
        session_factory=session_factory,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 2
    assert output.getvalue() == ""
    assert "target_word_count" in error.getvalue()
    assert "test-private-credential" not in error.getvalue()


def test_book_generation_module_registers_relationship_models_for_direct_cli() -> None:
    """直接导入 CLI 模块后应能配置 mapper，覆盖真实命令行入口路径。"""

    script = (
        "from sqlalchemy.orm import configure_mappers; "
        "import app.domains.book_runs.book_generation; "
        "configure_mappers()"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=False)

    assert result.returncode == 0, result.stderr




def test_book_generation_persistent_schema_contains_workspace_columns(engine) -> None:
    """持久化迁移路径需要包含工作区表和 books.workspace_id，匹配真实 CLI 使用的 ORM 模型。"""

    inspector = inspect(engine)

    assert "workspaces" in inspector.get_table_names()
    book_columns = {column["name"] for column in inspector.get_columns("books")}
    assert "workspace_id" in book_columns


def test_book_generation_failure_increments_prometheus_counter(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成章节失败时应在 /metrics 可观测 failure_count，而不是只写 BookRun progress。"""

    import app.domains.book_runs.book_generation as generation

    failure_metric_before = book_generation_failure_count_total._value.get()

    def _fail_generation(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise BookGenerationError("provider timeout")

    monkeypatch.setattr(generation, "_generate_chapter", _fail_generation)
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "http://127.0.0.1:1/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    with pytest.raises(BookGenerationError, match="第 1 章失败"):
        run_book_generation(session, chapter_count=2, token_budget=1000, env=env)

    book_run = session.query(BookRun).one()
    assert book_run.status == "failed"
    assert book_run.progress["failure"]["chapter_index"] == 1
    assert book_generation_failure_count_total._value.get() == failure_metric_before + 1


def test_book_generation_interrupt_marks_paused_not_orphan_running(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成期间被 Ctrl-C / SystemExit 中断时，BookRun 应落为 paused_by_user，而非孤儿 running。"""

    import app.domains.book_runs.book_generation as generation

    def _interrupt(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise KeyboardInterrupt

    monkeypatch.setattr(generation, "_generate_chapter", _interrupt)
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "http://127.0.0.1:1/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    with pytest.raises(KeyboardInterrupt):
        run_book_generation(session, chapter_count=3, token_budget=1000, env=env)

    book_run = session.query(BookRun).one()
    assert book_run.status == "paused_by_user"
    assert book_run.current_chapter_index == 1
    assert book_run.progress["completed_chapters"] == []
    assert "中断" in book_run.progress["pause_reason"]
