"""Current ordinary source admission must precede writer snapshot delivery."""

from __future__ import annotations

import hashlib
import json

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from agent_transport import agent_result

from app.domains.agent_runs.llm_context import build_llm_context_snapshot, llm_context_snapshot_to_prompt_context_bundle
from app.domains.assistant import service as assistant_service

OLD = "OLD_RULE_SENTINEL：灯塔仅冬季开放。"
NEW = "CURRENT_RULE_SENTINEL：灯塔全年开放。"


def bundle(root):
    return {"project_root": str(root), "files": [{"relative_path": "设定/灯塔.md", "kind": "setting", "excerpt": OLD}]}


def snapshot(root):
    return build_llm_context_snapshot(
        run_state=None,
        intent="file.create",
        user_message="写第二章",
        file_path="正文/第02章.md",
        content="",
        context_bundle=bundle(root),
    )


@pytest.mark.parametrize("state", ["changed", "deleted", "unchanged"])
def test_current_source_replaces_or_omits_stale_ordinary_excerpt(tmp_path, state):
    (tmp_path / "设定").mkdir()
    path = tmp_path / "设定/灯塔.md"
    if state != "deleted":
        path.write_text(NEW if state == "changed" else OLD, encoding="utf-8")
    value = snapshot(tmp_path)
    delivered = llm_context_snapshot_to_prompt_context_bundle(value)
    assert (OLD in str(delivered)) == (state == "unchanged")
    assert (NEW in str(delivered)) == (state == "changed")
    source = value["source_manifest"][0]
    assert source["relative_path"] == "设定/灯塔.md"
    if state == "deleted":
        assert source["disposition"] == "omitted" and source["source_text_sha256"] is None
    else:
        assert source["source_text_sha256"] == hashlib.sha256((NEW if state == "changed" else OLD).encode()).hexdigest()
        assert source["disposition"] == "delivered"
    assert bool(value["warnings"]) == (state != "unchanged")


@pytest.mark.parametrize("operation", ["file_create", "file_revise", "prose_continue"])
@pytest.mark.parametrize("state", ["changed", "deleted"])
def test_stale_pin_cannot_reach_real_loop_writer(client, tmp_path, monkeypatch, operation, state):
    _enable_loop_env(monkeypatch)
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文").mkdir()
    source = tmp_path / "设定/灯塔.md"
    if state == "changed":
        source.write_text(NEW, encoding="utf-8")
    target = tmp_path / "正文/第01章.md"
    target.write_text("林岚停在门口。", encoding="utf-8")
    prompts = []

    def writer(_source, **kwargs):
        prompts.append(kwargs["user_prompt"])
        return {"content": "林岚停在门口。"}

    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    path = "正文/第02章.md" if operation == "file_create" else "正文/第01章.md"
    _fake_llm_script(
        monkeypatch,
        [
            {
                "tool_calls": [
                    {
                        "id": "writer",
                        "type": "function",
                        "function": {
                            "name": operation,
                            "arguments": json.dumps({"path": path, "instruction": "接着写"}),
                        },
                    }
                ]
            },
            {"content": "补丁等待确认", "tool_calls": []},
        ],
    )
    result = _send_chat_message(
        client, run_id="freshness", project_path=str(tmp_path), message="接着写", context_bundle=bundle(tmp_path)
    )[-1]
    assert result["type"] == "agent_result", result
    assert len(prompts) == 1 and OLD not in prompts[0]
    assert (NEW in prompts[0]) == (state == "changed")
    assert "Context Sources" in prompts[0]
    assert target.read_text(encoding="utf-8") == "林岚停在门口。"
    assert not (tmp_path / "正文/第02章.md").exists()


def test_loop_read_is_revalidated_without_a_frontend_bundle(client, tmp_path, monkeypatch):
    from app.domains.agent_runs import loop_runtime

    _enable_loop_env(monkeypatch)
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文").mkdir()
    source = tmp_path / "设定/灯塔.md"
    source.write_text(OLD, encoding="utf-8")
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "tool_calls": [
                    {
                        "id": "read",
                        "type": "function",
                        "function": {"name": "fs_read", "arguments": json.dumps({"path": "设定/灯塔.md"})},
                    }
                ]
            },
            {
                "tool_calls": [
                    {
                        "id": "write",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps({"path": "正文/第02章.md", "instruction": "写第二章"}),
                        },
                    }
                ]
            },
            {"content": "等待确认", "tool_calls": []},
        ],
    )
    provider = loop_runtime.build_llm_provider({})
    original = provider.complete

    def change_before_writer(request):
        if len(calls) == 1:
            source.write_text(NEW, encoding="utf-8")
        return original(request)

    monkeypatch.setattr(provider, "complete", change_before_writer)
    prompts = []
    monkeypatch.setattr(
        assistant_service,
        "_call_llm_streamed",
        lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": "正文。"},
    )
    result = agent_result(
        client,
        "read-refresh",
        run_id="read-refresh",
        user_message="读取设定后写第二章",
        args={"project_path": str(tmp_path)},
    )
    assert result["type"] == "agent_result", result
    assert len(prompts) == 1 and OLD not in prompts[0] and NEW in prompts[0]
    assert "loop_fs_read" in prompts[0]
    assert source.read_text(encoding="utf-8") == NEW


@pytest.mark.parametrize("relative", ["设定/credentials.md", "设定/cache/old.md", "设定/image.bin", ".git/config"])
def test_ineligible_current_source_never_replaces_a_pin_with_secret_or_cache(tmp_path, relative):
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot

    source = tmp_path / relative
    source.parent.mkdir(parents=True)
    source.write_text("DO_NOT_DELIVER_SENTINEL", encoding="utf-8")
    request = {"project_root": str(tmp_path), "files": [{"relative_path": relative, "kind": "setting", "excerpt": OLD}]}
    value = build_llm_context_snapshot(
        run_state=None, intent="file.create", user_message="写", file_path="正文.md", content="", context_bundle=request
    )
    delivered = llm_context_snapshot_to_prompt_context_bundle(value)
    assert OLD not in str(delivered) and "DO_NOT_DELIVER_SENTINEL" not in str(delivered)


def test_collected_replay_is_immutable_and_performs_no_new_reads(tmp_path, monkeypatch):
    from dataclasses import FrozenInstanceError

    from app.domains.agent_runs.fs import collect_ordinary_context, ordinary_context
    from app.domains.agent_runs.knowledge_context import CollectedProjectKnowledge
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot_from_collected

    (tmp_path / "设定").mkdir()
    path = tmp_path / "设定/灯塔.md"
    path.write_text(OLD, encoding="utf-8")
    files = bundle(tmp_path)["files"]
    collected = collect_ordinary_context(str(tmp_path), context_files=files)
    with pytest.raises(FrozenInstanceError):
        collected.files[0].excerpt = NEW
    path.write_text(NEW, encoding="utf-8")
    monkeypatch.setattr(ordinary_context, "read_project_context_file", lambda *args: pytest.fail("pure replay did I/O"))
    replay = build_llm_context_snapshot_from_collected(
        knowledge=CollectedProjectKnowledge(ordinary=collected),
        run_state=None,
        intent="file.create",
        user_message="写",
        file_path="正文.md",
        content="",
        context_bundle=bundle(tmp_path),
    )
    assert OLD in str(llm_context_snapshot_to_prompt_context_bundle(replay)) and NEW not in str(replay)


def test_selection_budget_has_per_source_omission_in_final_writer_metadata(tmp_path):
    (tmp_path / "设定").mkdir()
    files = []
    for i in range(9):
        relative = f"设定/{i}.md"
        (tmp_path / relative).write_text(f"FACT_{i}", encoding="utf-8")
        files.append({"relative_path": relative, "kind": "setting", "excerpt": f"FACT_{i}"})
    value = build_llm_context_snapshot(
        run_state=None,
        intent="file.create",
        user_message="写",
        file_path="正文.md",
        content="",
        context_bundle={"project_root": str(tmp_path), "files": files},
    )
    omitted = [item for item in value["source_manifest"] if item["disposition"] == "omitted"]
    assert len(omitted) == 1 and omitted[0]["relative_path"] == "设定/8.md"
    assert omitted[0]["omission_reason"] == "selection_budget" and omitted[0]["delivered_chars"] == 0
    delivered = llm_context_snapshot_to_prompt_context_bundle(value)
    assert "selection_budget" in str(delivered) and "FACT_8" not in str(delivered)


def test_manifest_hashes_the_final_redacted_excerpt_not_original_text(tmp_path):
    source = tmp_path / "设定/灯塔.md"
    source.parent.mkdir()
    secret = "sk-" + "z" * 48
    source.write_text(f"  规则。 api_key={secret}\n", encoding="utf-8")
    value = snapshot(tmp_path)
    delivered = llm_context_snapshot_to_prompt_context_bundle(value)
    excerpt = next(item["excerpt"] for item in delivered["files"] if item["kind"] != "context_sources")
    ref = value["source_manifest"][0]
    assert ref["excerpt_sha256"] == hashlib.sha256(excerpt.encode()).hexdigest()
    assert ref["delivered_chars"] == len(excerpt)
    assert secret not in str(value) and secret not in str(delivered)
    assert "[REDACTED]" in excerpt


def test_missing_real_project_root_fails_closed_instead_of_reusing_bundle(tmp_path):
    value = snapshot(tmp_path / "no-project")
    assert OLD not in str(llm_context_snapshot_to_prompt_context_bundle(value))
    assert value["source_manifest"][0]["disposition"] == "omitted"
    assert value["warnings"]


def test_ordinary_oversize_source_is_omitted_with_no_partial_claim(tmp_path):
    source = tmp_path / "设定/灯塔.md"
    source.parent.mkdir()
    source.write_bytes(b"x" * (512 * 1024 + 1))
    value = snapshot(tmp_path)
    assert value["context_files"] == []
    assert OLD not in str(llm_context_snapshot_to_prompt_context_bundle(value))
    assert value["source_manifest"][0]["disposition"] == "omitted"


def test_pure_generator_read_handoff_records_selection_and_omission_without_io(monkeypatch):
    from app.domains.agent_runs import knowledge_context
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot_from_collected

    monkeypatch.setattr(
        knowledge_context, "collect_ordinary_context", lambda *a, **kw: pytest.fail("pure replay did I/O")
    )
    files = ({"relative_path": f"设定/{i}.md", "kind": "setting", "excerpt": f"FACT_{i}"} for i in range(9))
    value = build_llm_context_snapshot_from_collected(
        knowledge=knowledge_context.CollectedProjectKnowledge(),
        run_state=None,
        intent="file.create",
        user_message="写",
        file_path="正文.md",
        content="",
        context_bundle=None,
        extra_context_files=files,
    )
    refs = value["source_manifest"]
    assert len(value["context_files"]) == 8 and len(refs) == 9
    assert refs[0]["selection_source"] == "loop_fs_read"
    assert refs[-1]["selection_source"] == "loop_fs_read"
    assert refs[-1]["relative_path"] == "设定/8.md" and refs[-1]["omission_reason"] == "selection_budget"
