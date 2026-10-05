"""Synthetic channels must describe what the inner writer actually receives."""

from __future__ import annotations

import hashlib
import json

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message

from app.domains.agent_runs.knowledge_context import CollectedProjectKnowledge
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot_from_collected,
    llm_context_snapshot_to_prompt_context_bundle,
)
from app.domains.assistant import service


def snapshot(bundle, report=None):
    return build_llm_context_snapshot_from_collected(
        knowledge=CollectedProjectKnowledge(),
        run_state=None,
        intent="file.create",
        user_message="写",
        file_path="正文.md",
        content="",
        context_bundle=bundle,
        review_report=report,
    )


def memory_items(count=9):
    return [{"text": f"MEMORY_{i}_START " + "规" * 760 + f" MEMORY_{i}_END"} for i in range(count)]


def test_memory_projection_never_delivers_a_partial_fact():
    value = snapshot({"story_memory": {"items": memory_items()}})
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    text = next(item["excerpt"] for item in bundle["files"] if item["kind"] == "story_memory")
    for i in range(9):
        assert (f"MEMORY_{i}_START" in text) == (f"MEMORY_{i}_END" in text), text
    ref = next(row for row in value["source_manifest"] if row["purpose"] == "story_memory")
    assert ref["requested_count"] == 9
    assert ref["delivered_count"] == 5
    assert ref["omitted_count"] == 4 and ref["truncated"] is True
    assert ref["source_state"] == "unverified", "injected memory is not a revalidated manuscript source"
    assert ref["excerpt_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert ref["delivered_chars"] == len(text)
    assert bundle["budget"]["truncated"] is True
    sources = next(item["excerpt"] for item in bundle["files"] if item["kind"] == "context_sources")
    assert '"omitted_count":4' in sources


@pytest.mark.parametrize("channel", ["story_memory", "chapter_context", "review_report"])
def test_synthetic_selection_loss_is_visible_at_final_projection(channel):
    if channel == "story_memory":
        value = snapshot({"story_memory": {"items": [{"text": "量" * 900}]}})
    elif channel == "chapter_context":
        value = snapshot({"chapter_context": {"goal": "目标" * 900, "beats": ["约束"] * 14}})
    else:
        value = snapshot({}, {"issues": [], "suggested_actions": [f"ACTION_{i}" for i in range(15)]})
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    ref = next(row for row in value["source_manifest"] if row["purpose"] == channel)
    assert ref["truncated"] is True
    assert bundle["budget"]["truncated"] is True
    if channel == "story_memory":
        # An overlong atom is not a shorter fact. Omit it instead of sending
        # an incomplete rule; budget evidence remains visible to the writer.
        assert not any(item["kind"] == channel for item in bundle["files"])
        assert ref["disposition"] == "omitted" and ref["delivered_count"] == 0
        assert ref["omitted_count"] == 1 and ref["excerpt_sha256"] is None
        return
    delivered = next(item for item in bundle["files"] if item["kind"] == channel)
    assert ref["excerpt_sha256"] == hashlib.sha256(delivered["excerpt"].encode()).hexdigest()
    if channel == "review_report":
        report = json.loads(delivered["excerpt"])
        assert report["omitted_action_count"] == 3
        assert ref["requested_action_count"] == 15 and ref["delivered_action_count"] == 12


@pytest.mark.parametrize("tool", ["file_create", "file_revise", "prose_continue"])
def test_chat_writer_trace_matches_actual_synthetic_delivery(client, tmp_path, monkeypatch, tool):
    _enable_loop_env(monkeypatch)
    target = tmp_path / "正文.md"
    if tool != "file_create":
        target.write_text("原正文。", encoding="utf-8")
    _fake_llm_script(
        monkeypatch,
        [
            {
                "tool_calls": [
                    {
                        "id": "create",
                        "type": "function",
                        "function": {
                            "name": tool,
                            "arguments": json.dumps({"path": "正文.md", "instruction": "写"}),
                        },
                    }
                ]
            },
            {"content": "请确认建议"},
        ],
    )
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": "新正文。"}
    )
    result = _send_chat_message(
        client,
        run_id="synthetic-delivery",
        project_path=str(tmp_path),
        message="写正文",
        context_bundle={"files": [], "story_memory": {"items": memory_items()}},
    )[-1]
    registry_name = {"file_create": "file.create", "file_revise": "file.revise", "prose_continue": "prose.continue"}[
        tool
    ]
    trace = next(item for item in result["tool_trace"] if item["tool_name"] == registry_name)
    assert trace["status"] == "completed", trace
    assert len(prompts) == 1
    refs = trace["input_summary"]["context_provenance"]["source_manifest"]
    ref = next(row for row in refs if row["purpose"] == "story_memory")
    actual = prompts[0].split("### Story Memory", 1)[1].split("<<<CONTEXT\n", 1)[1].split("\nCONTEXT>>>", 1)[0]
    assert ref["excerpt_sha256"] == hashlib.sha256(actual.encode()).hexdigest()
    assert ref["delivered_count"] == 5 and ref["omitted_count"] == 4
    if tool == "file_create":
        assert not target.exists()
    else:
        assert target.read_text(encoding="utf-8") == "原正文。"


def test_synthetic_manifest_does_not_copy_source_text_or_secrets():
    secret = "sk-" + "q" * 48
    value = snapshot({"story_memory": {"items": [{"text": f"PRIVATE_FACT api_key={secret}"}]}})
    ref = next(row for row in value["source_manifest"] if row["purpose"] == "story_memory")
    assert "PRIVATE_FACT" not in json.dumps(ref) and secret not in str(value)
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    text = next(row["excerpt"] for row in bundle["files"] if row["kind"] == "story_memory")
    assert "[REDACTED]" in text and ref["excerpt_sha256"] == hashlib.sha256(text.encode()).hexdigest()


def test_redaction_precedes_memory_text_budget():
    secret = "sk-" + "q" * 100
    text = "规" * 690 + f" api_key={secret} END_FACT"
    assert len(text) > 800
    value = snapshot({"story_memory": {"items": [{"text": text}]}})
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    delivered = next(item["excerpt"] for item in bundle["files"] if item["kind"] == "story_memory")
    assert "END_FACT" in delivered and "[REDACTED]" in delivered
    assert secret not in str(value) and secret not in str(bundle)


def test_chapter_projection_preserves_whole_fields_and_counts_the_omission():
    value = snapshot({"chapter_context": {key: "章" * 1100 for key in ("summary", "goal", "outline", "pov")}})
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    text = next(item["excerpt"] for item in bundle["files"] if item["kind"] == "chapter_context")
    ref = next(row for row in value["source_manifest"] if row["purpose"] == "chapter_context")
    assert ref["requested_count"] == 4 and ref["delivered_count"] == 3 and ref["omitted_count"] == 1
    assert all(len(line.split(": ", 1)[1]) == 1100 for line in text.splitlines())
    assert ref["excerpt_sha256"] == hashlib.sha256(text.encode()).hexdigest()


def test_report_source_accounting_survives_artifact_selection():
    value = build_llm_context_snapshot_from_collected(
        knowledge=CollectedProjectKnowledge(),
        run_state=None,
        intent="file.create",
        user_message="写",
        file_path="正文.md",
        content="",
        context_bundle={},
        artifacts=[
            {"kind": "review_report", "payload": {"issues": [], "suggested_actions": [f"A{i}" for i in range(15)]}}
        ],
    )
    ref = next(row for row in value["source_manifest"] if row["purpose"] == "review_report")
    assert ref["requested_action_count"] == 15 and ref["omitted_action_count"] == 3


def test_legacy_synthetic_projection_remains_readable_without_fabricated_source_proof():
    legacy = {"review_report": {"issue_count": 0, "issues": [], "suggested_actions": ["建议"]}}
    from app.domains.agent_runs.llm_prompt_context import synthetic_context_delivery

    files, refs = synthetic_context_delivery(legacy)
    assert json.loads(files[0]["excerpt"])["suggested_actions"] == ["建议"]
    assert refs[0]["requested_action_count"] == refs[0]["delivered_action_count"] == 1
    assert refs[0]["source_state"] == "unverified" and refs[0]["supplied_value_sha256"] is None
    assert "_delivered_action_count" not in files[0]


def test_legacy_memory_budget_loss_is_not_reclassified_as_complete():
    from app.domains.agent_runs.llm_prompt_context import synthetic_context_delivery

    legacy = {"story_memory": {"items": memory_items(8)}}
    files, refs = synthetic_context_delivery(legacy)
    assert refs[0]["requested_count"] == 8 and refs[0]["delivered_count"] == 5
    assert refs[0]["omitted_count"] == 3 and refs[0]["truncated"] is True
    assert files[0]["_truncated"] is True and refs[0]["supplied_value_sha256"] is None


def test_pure_reprojection_does_not_mutate_snapshot():
    value = snapshot({"story_memory": {"items": memory_items()}})
    before = json.dumps(value, ensure_ascii=False, sort_keys=True)
    one = llm_context_snapshot_to_prompt_context_bundle(value)
    two = llm_context_snapshot_to_prompt_context_bundle(value)
    assert one == two and json.dumps(value, ensure_ascii=False, sort_keys=True) == before


def test_source_metadata_overflow_is_an_explicit_refusal_not_silent_loss():
    value = snapshot({"story_memory": {"items": memory_items()}})
    value["source_manifest"] *= 20
    with pytest.raises(ValueError, match="source metadata exceeds delivery budget"):
        llm_context_snapshot_to_prompt_context_bundle(value)


def test_chapter_list_selection_is_reported_even_when_the_final_slot_fits():
    value = snapshot({"chapter_context": {"beats": [f"BEAT_{i}" for i in range(14)]}})
    bundle = llm_context_snapshot_to_prompt_context_bundle(value)
    text = next(item["excerpt"] for item in bundle["files"] if item["kind"] == "chapter_context")
    ref = next(row for row in value["source_manifest"] if row["purpose"] == "chapter_context")
    assert "BEAT_11" in text and "BEAT_12" not in text
    assert ref["truncated"] and "text_or_list_budget" in ref["omission_reasons"]
    assert bundle["budget"]["truncated"] is True


def test_polish_does_not_reintroduce_omitted_or_partial_memory_facts():
    from app.domains.agent_runs.patches.polish_context import polish_constraints_from_context_snapshot

    value = snapshot({"story_memory": {"items": memory_items()}})
    constraints = polish_constraints_from_context_snapshot(value)
    assert len(constraints["required_facts"]) == 5
    assert not any("MEMORY_5_START" in fact for fact in constraints["required_facts"])
    oversize = snapshot({"story_memory": {"items": [{"text": "过长事实" * 300}]}})
    assert polish_constraints_from_context_snapshot(oversize)["required_facts"] == []


def test_actual_polish_provider_receives_only_delivered_memory_atoms(client, tmp_path, monkeypatch):
    from authoring_measurement_support import SyntheticPolishProvider, fixture_resolution, fixture_text

    from app.domains.agent_runs.patches import polishing_service
    from app.platform.ai_sdk.providers.anthropic import AnthropicProvider

    _enable_loop_env(monkeypatch)
    target = tmp_path / "正文.md"
    original = fixture_text(2)
    target.write_text(original, encoding="utf-8")
    monkeypatch.setattr(polishing_service, "resolve_polish_llm", lambda **_: fixture_resolution())
    provider = SyntheticPolishProvider("noop")
    requests = []

    def complete(_, request):
        requests.append(request)
        return provider.complete(request)

    monkeypatch.setattr(AnthropicProvider, "complete", complete)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "tool_calls": [
                    {
                        "id": "polish",
                        "type": "function",
                        "function": {"name": "chapter_polish", "arguments": json.dumps({"path": "正文.md"})},
                    }
                ]
            },
            {"content": "已检查建议"},
        ],
    )
    result = _send_chat_message(
        client,
        run_id="synthetic-polish",
        project_path=str(tmp_path),
        message="润色正文",
        context_bundle={"files": [], "story_memory": {"items": memory_items()}},
    )[-1]
    trace = next(row for row in result["tool_trace"] if row["tool_name"] == "chapter.polish")
    assert trace["status"] == "completed", trace
    assert len(requests) == 1
    actual = requests[0].messages[-1].content
    for i in range(5):
        assert f"MEMORY_{i}_START" in actual and f"MEMORY_{i}_END" in actual
    for i in range(5, 9):
        assert f"MEMORY_{i}_START" not in actual
    ref = next(
        row
        for row in trace["input_summary"]["context_provenance"]["source_manifest"]
        if row["purpose"] == "story_memory"
    )
    assert ref["delivered_count"] == 5 and ref["omitted_count"] == 4
    assert target.read_text(encoding="utf-8") == original
