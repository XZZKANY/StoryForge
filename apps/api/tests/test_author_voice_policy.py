"""作者声音反例：实际候选不能被标点恢复/本地兜底或启发式硬门禁改写意图。"""

from __future__ import annotations

import json

import pytest
from agent_run_test_support import _seed_agent_run

from app.common.llm_env import ResolvedPolishLlm
from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.patches import evaluate_polish_candidate, polishing_service, run_controlled_polish
from app.domains.agent_runs.prose_scan import check_prose_static_quality
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.assistant.revision import RevisionInput, revise_text
from app.platform.ai_sdk.contracts import ChatResponse
from app.platform.ai_sdk.providers.anthropic import AnthropicProvider

TAIL = "窗外的风卷着碎叶，石阶已经凉透。檐下留着半截烛芯，烛泪凝成一圈白边。门框上新添的划痕还很浅，屋内的一只空杯静静躺在桌角。"


@pytest.mark.parametrize("quality_gate", [None, "polish"])
def test_quote_conversion_and_typo_correction_both_survive(quality_gate):
    original = "“灯还亮着。”她说。\n铜钥匙落在错字的地扳上。\n" + TAIL
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    result = revise_text(
        RevisionInput(
            file_path="正文.md",
            content=original,
            instruction="把中文引号统一成直引号，并纠正地扳这个错字。",
            system_prompt="编辑",
            quality_gate=quality_gate,
        ),
        generate=lambda **_: {"content": candidate},
    )
    assert result.after == candidate


def test_unrequested_quote_conversion_is_still_reverted_on_unedited_lines():
    original = "“灯还亮着。”她说。\n铜钥匙落在地扳上。\n" + TAIL
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    result = revise_text(
        RevisionInput(file_path="正文.md", content=original, instruction="只纠正地扳这个错字。", system_prompt="编辑"),
        generate=lambda **_: {"content": candidate},
    )
    assert result.after == original.replace("地扳", "地板")


@pytest.mark.parametrize(
    "style", ["保留连续的问号和感叹号，不要折成一个。", "明确保留重复问号、重复感叹号的作者习惯。"]
)
@pytest.mark.parametrize("online", [False, True])
def test_local_fallback_honors_explicit_repeated_punctuation(style, online):
    original = "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。\n" + TAIL

    class InvalidProvider:
        def complete(self, request):
            return ChatResponse(content="invalid-json")

    result = run_controlled_polish(
        original, style_instruction=style, online_enabled=online, resolution=_resolution(), provider=InvalidProvider()
    )
    assert "？？？" in result.decision.text and "！！！" in result.decision.text
    assert "门，仍然敞着" in result.decision.text
    assert result.decision.selected_source == "local"
    if online:
        assert result.decision.degraded is True


def test_undetermined_person_is_advisory_not_hard_failure():
    original = "他走到窗前。他停了下来。他拿起杯子。他低声问。\n" + TAIL
    candidate = original.replace("他走到", "人走到", 1)
    result = evaluate_polish_candidate(original, candidate)
    assert result.passed, result.reasons
    assert "narrative_person_uncertain" in result.advisories


def test_confident_unrequested_person_flip_is_still_rejected():
    original = "他走到窗前。他停了下来。他拿起杯子。他低声问。\n" + TAIL
    result = evaluate_polish_candidate(original, original.replace("他", "我"))
    assert not result.passed and "narrative_person_changed" in result.reasons


@pytest.mark.parametrize("opening,closing", [("“", "”"), ('"', '"'), ("「", "」"), ("『", "』")])
def test_valid_quote_forms_do_not_invent_dialogue_density_regression(opening, closing):
    original = "她说：“门外有一道很浅的车辙，车辙绕过井台，一直通往东边那座空仓。”\n" + TAIL
    candidate = original.replace("“", opening).replace("”", closing)
    before = [i for i in check_prose_static_quality(original) if i.dimension == "对白密度"]
    after = [i for i in check_prose_static_quality(candidate) if i.dimension == "对白密度"]
    assert [(i.severity, i.message) for i in after] == [(i.severity, i.message) for i in before]
    assert evaluate_polish_candidate(original, candidate).passed


def test_name_to_unambiguous_pronoun_is_not_a_count_based_hard_failure():
    original = "林岚停在门口。林岚把空杯放下。\n" + TAIL
    candidate = original.replace("林岚把", "她把")
    result = evaluate_polish_candidate(original, candidate, protected_entities=("林岚",))
    assert result.passed, result.reasons
    assert "entity_reference_count_changed" in result.advisories


def test_actual_name_typo_is_still_rejected():
    original = "林岚停在门口。林岚把空杯放下。\n" + TAIL
    result = evaluate_polish_candidate(original, original.replace("林岚把", "林蓝把"), protected_entities=("林岚",))
    assert not result.passed and "protected_entity_changed:林岚" in result.reasons


@pytest.mark.parametrize("candidate_action", ["交给", "递给"])
def test_same_grounded_event_survives_wording_changes(candidate_action):
    original = "林岚把铜钥匙交给顾迟。\n" + TAIL
    result = evaluate_polish_candidate(
        original, original.replace("交给", candidate_action), protected_entities=("林岚", "顾迟")
    )
    assert result.passed, result.reasons


def test_equal_name_counts_do_not_hide_reversed_event_roles():
    original = "林岚把铜钥匙交给顾迟。\n" + TAIL
    candidate = "顾迟把铜钥匙交给林岚。\n" + TAIL
    result = evaluate_polish_candidate(original, candidate, protected_entities=("林岚", "顾迟"))
    assert not result.passed
    assert "event_relation_changed" in result.reasons


def _resolution():
    return ResolvedPolishLlm(
        resolution_source="dedicated",
        provider="anthropic",
        model="fixture-voice",
        source={
            "STORYFORGE_LLM_PROVIDER": "anthropic",
            "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid",
            "STORYFORGE_LLM_MODEL": "fixture-voice",
            "STORYFORGE_LLM_API_KEY": "fixture-only-key",
        },
    )


@pytest.mark.parametrize(
    "statement", ["另一把钥匙不在林岚手中。", "他猜测钥匙不在林岚手中。", "她说：“钥匙不在林岚手中。”"]
)
def test_other_object_speculation_or_dialogue_is_not_a_grounded_fact_contradiction(statement):
    original = "钥匙在林岚手中。" + TAIL
    candidate = "钥匙在林岚手中。" + statement + TAIL
    gate = evaluate_polish_candidate(original, candidate, continuity_facts=({"statement": "钥匙在林岚手中。"},))
    assert "grounded_fact_contradicted" not in gate.reasons


def test_hypothetical_transfer_is_not_a_proved_reversed_event():
    original = "林岚把铜钥匙交给顾迟。\n" + TAIL
    candidate = "她以为顾迟把铜钥匙交给林岚。\n" + TAIL
    gate = evaluate_polish_candidate(original, candidate, protected_entities=("林岚", "顾迟"))
    assert "event_relation_changed" not in gate.reasons


@pytest.mark.parametrize("scenario", ["requirements", "unrelated-negation", "actual-negation"])
def test_actual_chapter_polish_receives_author_requirements_and_distinguishes_negation(
    session, tmp_path, monkeypatch, scenario
):
    original = "钥匙在林岚手中。院里空无一人。\n" + TAIL
    project = tmp_path / "project"
    target = project / "正文/第一章.md"
    target.parent.mkdir(parents=True)
    target.write_text(original, encoding="utf-8")
    (project / "设定").mkdir()
    (project / "设定/钥匙.md").write_text("钥匙在林岚手中。", encoding="utf-8")
    (project / ".storyforge").mkdir()
    author = "AUTHOR_VOICE_SENTINEL：不要抹平问号的停顿，保留重复问号。"
    (project / ".storyforge/agent-instructions.md").write_text(author, encoding="utf-8")
    candidate = original.replace("空无一人", "没有人")
    if scenario == "actual-negation":
        candidate = original.replace("钥匙在林岚手中", "钥匙不在林岚手中")
    requests = []
    monkeypatch.setattr(polishing_service, "resolve_polish_llm", lambda **_: _resolution())

    def complete(_provider, request):
        requests.append(request)
        payload = json.loads(request.messages[-1].content)
        return ChatResponse(
            content=json.dumps(
                {
                    "segments": [
                        {"index": item["index"], "text": item["text"].replace(original, candidate)}
                        for item in payload["segments"]
                    ]
                },
                ensure_ascii=False,
            )
        )

    monkeypatch.setattr(AnthropicProvider, "complete", complete)
    run = _seed_agent_run(session, public_id=f"run-author-voice-{scenario}")
    run.permission_profile = "ask"
    session.commit()
    result = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.polish",
            "user_message": "只润色表达，不改事实。",
            "args": {
                "project_path": str(project),
                "file_path": "正文/第一章.md",
                "content": original,
                "context_bundle": {
                    "project_root": str(project),
                    "files": [
                        {"relative_path": "设定/钥匙.md", "kind": "setting", "excerpt": "钥匙在林岚手中。"},
                        {
                            "relative_path": ".storyforge/agent-instructions.md",
                            "kind": "author_instructions",
                            "excerpt": author,
                        },
                    ],
                },
            },
        },
    )
    assert len(requests) == 1
    delivered = "\n".join(message.content or "" for message in requests[0].messages)
    assert author in delivered
    assert "钥匙在林岚手中" in delivered
    if scenario == "actual-negation":
        assert result.get("proposed_patch") is None
    else:
        assert isinstance(result.get("proposed_patch"), dict)
        assert result["proposed_patch"]["after"] == candidate
    assert target.read_text(encoding="utf-8") == original
