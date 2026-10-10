from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from fastapi.testclient import TestClient

from app.domains.agent_runs.fs.knowledge_entries import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
)
from app.domains.agent_runs.fs.knowledge_proposals import project_file_evidence_hash
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
)
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantContextBundle
from app.domains.ide import review_reasoning

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

KNOWLEDGE_ID = "pk_22222222-2222-4222-8222-222222222222"
TAIL_RULE = "TAIL_CONSTRAINT_SENTINEL：仅夜间有效，白天不得使用。"


def _pinned_knowledge(
    project: Path, *, long_claim: bool = False, excerpt_chars: int | None = None, current_evidence: bool = False
) -> dict[str, object]:
    claim = ("夜航规则。" * 570 if long_claim else "夜航规则。") + TAIL_RULE
    if excerpt_chars is not None:
        claim = "规" * (excerpt_chars - len("## 夜航规则\n\n") - len(TAIL_RULE)) + TAIL_RULE
    entry = KnowledgeEntry(
        id=KNOWLEDGE_ID,
        status="active",
        kind="world_rule",
        evidence_state="current",
        title="夜航规则",
        claim=claim,
        sources=(
            KnowledgeSource(
                type="project_file",
                path="设定/人物.md",
                content_sha256=project_file_evidence_hash(str(project), "设定/人物.md")
                if current_evidence
                else "sha256:" + "0" * 64,
            ),
        ),
        claim_fingerprint=knowledge_claim_fingerprint("夜航规则", claim),
        created_at="2026-10-04T00:00:00Z",
        updated_at="2026-10-04T00:00:00Z",
    )
    folder = project / "knowledge"
    folder.mkdir(exist_ok=True)
    (folder / "夜航.md").write_text(render_knowledge_entry(entry), encoding="utf-8")
    return {
        "project_root": str(project),
        "current_file": "正文/第01章.md",
        "files": [{"relative_path": "knowledge/夜航.md", "kind": "knowledge", "excerpt": "author pin"}],
    }


def _snapshot(bundle: dict[str, object], **kwargs: object) -> dict[str, object]:
    return build_llm_context_snapshot(
        run_state=None,
        intent="file.create",
        user_message="按夜航规则写第二章",
        file_path="正文/第02章.md",
        content="",
        context_bundle=bundle,
        **kwargs,
    )


def test_pinned_knowledge_tail_survives_snapshot_and_prompt_projection(novel_project: Path) -> None:
    snapshot = _snapshot(_pinned_knowledge(novel_project, long_claim=True))
    knowledge = snapshot["context_files"][0]
    assert 2000 < knowledge["excerpt_chars"] < 4000
    assert TAIL_RULE in knowledge["excerpt"]
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    assert TAIL_RULE in bundle["files"][0]["excerpt"]
    assert bundle["files"][0]["excerpt"] == knowledge["excerpt"]
    AssistantContextBundle.model_validate(bundle)


def test_full_4000_char_knowledge_slot_keeps_tail_and_separate_state_metadata(novel_project: Path) -> None:
    snapshot = _snapshot(_pinned_knowledge(novel_project, excerpt_chars=4000))
    assert snapshot["context_files"][0]["excerpt_chars"] == 4000
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    assert len(bundle["files"][0]["excerpt"]) == 4000
    assert bundle["files"][0]["excerpt"].endswith(TAIL_RULE)
    assert bundle["budget"]["truncated"] is False
    assert "stale" in bundle["files"][1]["excerpt"]
    AssistantContextBundle.model_validate(bundle)


def test_budget_exhausted_knowledge_reports_truncation(novel_project: Path) -> None:
    bundle = llm_context_snapshot_to_prompt_context_bundle(
        _snapshot(_pinned_knowledge(novel_project, excerpt_chars=5000)),
    )
    assert TAIL_RULE not in bundle["files"][0]["excerpt"]
    assert bundle["budget"]["truncated"] is True
    AssistantContextBundle.model_validate(bundle)


@pytest.mark.parametrize("current_evidence", [False, True])
def test_knowledge_identity_selection_and_exact_evidence_state_reach_prompt(
    novel_project: Path, current_evidence: bool
) -> None:
    snapshot = _snapshot(_pinned_knowledge(novel_project, current_evidence=current_evidence))
    expected = "current" if current_evidence else "stale"
    assert snapshot["context_files"][0]["evidence_state"] == expected
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    delivered = "\n".join(item["excerpt"] for item in bundle["files"])
    assert KNOWLEDGE_ID in delivered
    assert "knowledge/夜航.md" in delivered
    metadata = next(
        json.loads(line)
        for line in bundle["files"][1]["excerpt"].splitlines()
        if line.startswith("{") and KNOWLEDGE_ID in line
    )
    assert metadata["knowledge_id"] == KNOWLEDGE_ID
    assert metadata["relative_path"] == "knowledge/夜航.md"
    assert metadata["evidence_state"] == expected
    assert metadata["selection_source"] == "author_pinned"
    assert "author_pinned" in delivered
    assert str(novel_project) not in delivered
    AssistantContextBundle.model_validate(bundle)


def test_review_summary_reaches_prompt_without_raw_report_payload() -> None:
    snapshot = _snapshot(
        {"files": []},
        review_report={
            "kind": "review_report",
            "issues": [
                {
                    "id": "plot-2",
                    "severity": "high",
                    "message": "REVIEW_SENTINEL：代价不明确",
                    "evidence": "他轻易拿到了钥匙。",
                    "suggested_action": "增加阻碍。",
                    "raw_payload": {"permission_payload": "RAW_REPORT_SHOULD_NOT_APPEAR"},
                }
            ],
            "suggested_actions": ["补清人物付出的代价。"],
        },
    )
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    delivered = "\n".join(item["excerpt"] for item in bundle["files"])
    assert "plot-2" in delivered
    assert "REVIEW_SENTINEL" in delivered
    assert "增加阻碍" in delivered
    assert "RAW_REPORT_SHOULD_NOT_APPEAR" not in delivered
    AssistantContextBundle.model_validate(bundle)


@pytest.mark.parametrize("upstream_truncated", [False, True])
def test_prompt_budget_reports_actual_excerpt_and_upstream_truncation(upstream_truncated: bool) -> None:
    bundle = llm_context_snapshot_to_prompt_context_bundle(
        _snapshot(
            {
                "files": [{"relative_path": "设定/规则.md", "kind": "setting", "excerpt": "规则" * 1800}],
                "budget": {"truncated": upstream_truncated},
            }
        )
    )
    assert bundle["budget"]["truncated"] is True
    assert bundle["budget"]["char_count"] == sum(len(item["excerpt"]) for item in bundle["files"])
    AssistantContextBundle.model_validate(bundle)


def test_upstream_truncation_survives_even_when_delivered_excerpts_fit() -> None:
    bundle = llm_context_snapshot_to_prompt_context_bundle(
        _snapshot(
            {
                "files": [{"relative_path": "设定/规则.md", "kind": "setting", "excerpt": "短规则"}],
                "budget": {"truncated": True},
            }
        )
    )
    assert bundle["budget"]["truncated"] is True
    AssistantContextBundle.model_validate(bundle)


def test_synthetic_truncation_does_not_leak_internal_markers_or_mutate_snapshot() -> None:
    snapshot = _snapshot(
        {
            "story_memory": {"items": [{"fact": "记忆" * 450} for _ in range(8)]},
            "chapter_context": {"summary": "章节摘要"},
        }
    )
    original = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    assert bundle["budget"]["truncated"] is True
    assert len(bundle["files"]) == 2
    assert json.dumps(snapshot, ensure_ascii=False, sort_keys=True) == original
    assert llm_context_snapshot_to_prompt_context_bundle(snapshot) == bundle
    AssistantContextBundle.model_validate(bundle)


def test_review_budget_omits_whole_issues_and_reports_incomplete_delivery() -> None:
    snapshot = _snapshot(
        {"files": []},
        review_report={
            "kind": "review_report",
            "issues": [
                {
                    "id": f"issue-{index}",
                    "message": "问题" * 300,
                    "evidence": "引文" * 300,
                    "suggested_action": "修复" * 300,
                }
                for index in range(12)
            ],
        },
    )
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    report = json.loads(bundle["files"][0]["excerpt"])
    assert 0 < len(report["issues"]) < 12
    assert report["omitted_issue_count"] == 12 - len(report["issues"])
    assert report["issues"][0]["evidence"] == "引文" * 300
    assert bundle["budget"]["truncated"] is True
    AssistantContextBundle.model_validate(bundle)


def test_context_file_count_limit_is_not_reported_as_complete() -> None:
    bundle = llm_context_snapshot_to_prompt_context_bundle(
        _snapshot(
            {
                "files": [
                    {"relative_path": f"设定/规则-{index}.md", "kind": "setting", "excerpt": "短规则"}
                    for index in range(9)
                ],
            }
        )
    )
    assert len([item for item in bundle["files"] if item["kind"] != "context_sources"]) == 8
    assert bundle["budget"]["truncated"] is True
    AssistantContextBundle.model_validate(bundle)


def test_synthetic_sections_are_redacted_before_prompt_delivery() -> None:
    bundle = llm_context_snapshot_to_prompt_context_bundle(
        _snapshot(
            {
                "story_memory": {"items": [{"fact": "API_KEY=sk-memory-delivery-secret"}]},
                "chapter_context": {"summary": "API_KEY=sk-chapter-delivery-secret"},
            },
            review_report={
                "kind": "review_report",
                "issues": [{"id": "plot-1", "message": "API_KEY=sk-review-delivery-secret"}],
            },
        )
    )
    delivered = "\n".join(item["excerpt"] for item in bundle["files"])
    assert "sk-memory-delivery-secret" not in delivered
    assert "sk-chapter-delivery-secret" not in delivered
    assert "sk-review-delivery-secret" not in delivered
    assert "[REDACTED]" in delivered
    AssistantContextBundle.model_validate(bundle)


@pytest.mark.parametrize("tool_name,path", [("file_create", "正文/第02章.md"), ("file_revise", "正文/第01章.md")])
def test_actual_chat_writer_receives_pinned_tail_and_stale_status(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
    tool_name: str,
    path: str,
) -> None:
    prompts: list[str] = []
    original_chapter = (novel_project / "正文/第01章.md").read_bytes()

    def fake_inner_call(source, *, system_prompt, user_prompt):  # noqa: ANN001
        prompts.append(user_prompt)
        return {"content": "林岚在夜里登上船。", "completion_tokens": 10, "latency_ms": 5}

    _enable_loop_env(monkeypatch)
    for seam in ("_call_llm", "_call_llm_streamed"):
        monkeypatch.setattr(assistant_service, seam, fake_inner_call)
    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "fake-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )
    monkeypatch.setattr(
        review_reasoning,
        "_call_llm",
        lambda *args, **kwargs: {
            "content": json.dumps(
                [
                    {
                        "message": "REVIEW_DELIVERY_SENTINEL：明确登船代价。",
                        "evidence": "灯塔第三十三次错误闪光。",
                        "severity": "high",
                    }
                ]
            ),
            "completion_tokens": 4,
            "latency_ms": 1,
        },
    )
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "review-before-writing",
                        "type": "function",
                        "function": {
                            "name": "file_review",
                            "arguments": json.dumps({"path": "正文/第01章.md"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "write-with-pinned-tail",
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": json.dumps({"path": path, "instruction": "按夜航规则写"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "补丁等你确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    received = _send_chat_message(
        client,
        run_id=f"run-context-delivery-{tool_name}",
        project_path=str(novel_project),
        message="按夜航规则写",
        context_bundle=_pinned_knowledge(novel_project, long_claim=True),
    )
    result = received[-1]
    assert result["type"] == "agent_result", result
    review_trace = next(item for item in result["tool_trace"] if item["tool_name"] == "file.review")
    assert review_trace["status"] == "completed", review_trace
    assert len(prompts) == 1
    assert TAIL_RULE in prompts[0]
    assert KNOWLEDGE_ID in prompts[0]
    assert '"evidence_state":"stale"' in prompts[0]
    assert "author_pinned" in prompts[0]
    assert "REVIEW_DELIVERY_SENTINEL" in prompts[0]
    assert "plot-1" in prompts[0]
    trace = next(item for item in result["tool_trace"] if item["tool_name"] == tool_name.replace("_", "."))
    provenance = trace["input_summary"]["context_provenance"]
    assert provenance["knowledge_entries"][0]["evidence_state"] == "stale"
    encoded = json.dumps(trace, ensure_ascii=False)
    assert TAIL_RULE not in encoded
    assert str(novel_project) not in encoded
    assert "REVIEW_DELIVERY_SENTINEL" not in encoded
    assert (novel_project / "正文/第01章.md").read_bytes() == original_chapter
    assert not (novel_project / "正文/第02章.md").exists()
    assert result["proposed_patch"]["requires_confirmation"] is True
