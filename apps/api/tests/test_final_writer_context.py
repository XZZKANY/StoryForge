"""Every live writing facade admits current sources, not an earlier adapter bundle."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import agent_result

from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantContinueRequest, AssistantDraftRequest, AssistantReviseRequest
from app.domains.ide import review_reasoning

OLD = "OLD_FINAL_SEAM：灯塔仅冬季开放。"
NEW = "NEW_FINAL_SEAM：灯塔全年开放。"
ORIGINAL = "林岚站在门前。"


def context_bundle(root):
    return {
        "project_root": str(root),
        "current_file": "正文.md",
        "files": [
            {
                "path": "设定/灯塔.md",
                "relative_path": "设定/灯塔.md",
                "kind": "setting",
                "title": "灯塔",
                "excerpt": OLD,
            }
        ],
    }


@pytest.mark.parametrize("entry", ["http-revise", "draft", "continue"])
@pytest.mark.parametrize("state", ["changed", "deleted"])
def test_direct_writer_revalidates_ordinary_sources(client, session, tmp_path, monkeypatch, entry, state):
    _enable_loop_env(monkeypatch)
    (tmp_path / "设定").mkdir()
    if state == "changed":
        (tmp_path / "设定/灯塔.md").write_text(NEW, encoding="utf-8")
    target = tmp_path / "正文.md"
    target.write_text(ORIGINAL, encoding="utf-8")
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": ORIGINAL}
    )
    common = {
        "file_path": str(target),
        "project_root": str(tmp_path),
        "instruction": "接着写",
        "context_bundle": context_bundle(tmp_path),
    }
    if entry == "http-revise":
        response = client.post("/api/assistant/revise", json={**common, "content": ORIGINAL})
        assert response.status_code == 200, response.text
    elif entry == "draft":
        service.draft_file_content(session, AssistantDraftRequest(**{**common, "file_path": str(tmp_path / "新章.md")}))
    else:
        service.draft_continuation(session, AssistantContinueRequest(**common, content=ORIGINAL, cursor_line=1))
    assert len(prompts) == 1 and OLD not in prompts[0]
    assert (NEW in prompts[0]) == (state == "changed")
    assert "Context Sources" in prompts[0]
    assert target.read_text(encoding="utf-8") == ORIGINAL
    assert not (tmp_path / "新章.md").exists()


@pytest.mark.parametrize("state", ["changed", "deleted"])
def test_fixed_revision_refreshes_after_review_not_only_context_load(client, tmp_path, monkeypatch, state):
    _enable_loop_env(monkeypatch)
    (tmp_path / "设定").mkdir()
    source = tmp_path / "设定/灯塔.md"
    source.write_text(OLD, encoding="utf-8")
    target = tmp_path / "正文.md"
    target.write_text(ORIGINAL, encoding="utf-8")
    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: [])
    monkeypatch.setattr(review_reasoning, "resolved_llm_env", lambda: {})
    reviews = []

    def review(*_, **__):
        reviews.append(True)
        if state == "changed":
            source.write_text(NEW, encoding="utf-8")
        elif source.exists():
            source.unlink()
        return {"content": json.dumps([])}

    monkeypatch.setattr(review_reasoning, "_call_llm", review)
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": ORIGINAL}
    )
    result = agent_result(
        client,
        "fixed-fresh",
        run_id="fixed-fresh",
        intent="file.revise",
        user_message="修订这一段",
        args={
            "project_path": str(tmp_path),
            "file_path": str(target),
            "content": ORIGINAL,
            "context_bundle": context_bundle(tmp_path),
        },
    )
    assert result["type"] == "agent_result", result
    assert reviews and len(prompts) == 1 and OLD not in prompts[0]
    assert (NEW in prompts[0]) == (state == "changed")
    assert target.read_text(encoding="utf-8") == ORIGINAL
    trace = next(item for item in result["tool_trace"] if item["tool_name"] == "file.revise")
    provenance = trace["input_summary"]["context_provenance"]
    assert provenance["selected_content_sha256"] == hashlib.sha256(ORIGINAL.encode()).hexdigest()
    source = next(item for item in provenance["source_manifest"] if item["relative_path"] == "设定/灯塔.md")
    assert source["disposition"] == ("delivered" if state == "changed" else "omitted")
    assert source["source_text_sha256"] == (hashlib.sha256(NEW.encode()).hexdigest() if state == "changed" else None)


def test_prepared_backend_context_preserves_synthetic_channels_without_second_collection(
    session, tmp_path, monkeypatch
):
    from dataclasses import FrozenInstanceError

    from app.domains.agent_runs.llm_context import build_llm_context_snapshot
    from app.domains.assistant import writing_context

    _enable_loop_env(monkeypatch)
    request = AssistantDraftRequest(file_path=str(tmp_path / "新章.md"), project_root=str(tmp_path), instruction="起草")
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.create",
        user_message="起草",
        file_path=request.file_path,
        content="",
        context_bundle={
            "project_root": str(tmp_path),
            "story_memory": {"items": [{"text": "BACKEND_MEMORY_SENTINEL"}]},
            "chapter_context": {"goal": "BACKEND_CHAPTER_SENTINEL"},
        },
    )
    prepared = writing_context.writing_context_from_snapshot(
        snapshot, project_root=str(tmp_path), file_path=request.file_path, content="", intent="file.create"
    )
    detached = prepared.context_bundle
    detached.files.clear()
    with pytest.raises(FrozenInstanceError):
        prepared.bundle_json = "{}"
    from app.domains.agent_runs import llm_context

    monkeypatch.setattr(
        llm_context, "build_llm_context_snapshot", lambda **kw: pytest.fail("prepared handoff collected twice")
    )
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": ORIGINAL}
    )
    service.draft_file_content(session, request, prepared_context=prepared)
    assert len(prompts) == 1 and "BACKEND_MEMORY_SENTINEL" in prompts[0] and "BACKEND_CHAPTER_SENTINEL" in prompts[0]


@pytest.mark.parametrize("change", ["root", "file", "body", "intent", "forged-dict"])
def test_prepared_handoff_cannot_be_reused_for_another_target(session, tmp_path, monkeypatch, change):
    from app.common.exceptions import ConflictError
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot
    from app.domains.assistant.writing_context import writing_context_from_snapshot

    _enable_loop_env(monkeypatch)
    request = AssistantReviseRequest(
        file_path=str(tmp_path / "正文.md"), project_root=str(tmp_path), content=ORIGINAL, instruction="修订"
    )
    intent = "file.create" if change == "intent" else "file.revise"
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent=intent,
        user_message="修订",
        file_path=request.file_path,
        content=ORIGINAL,
        context_bundle={"project_root": str(tmp_path)},
    )
    prepared = writing_context_from_snapshot(
        snapshot, project_root=str(tmp_path), file_path=request.file_path, content=ORIGINAL, intent=intent
    )
    if change == "root":
        request.project_root = str(tmp_path / "other")
    elif change == "file":
        request.file_path = str(tmp_path / "other.md")
    elif change == "body":
        request.content += "作者新增。"
    elif change == "forged-dict":
        prepared = {"identity": prepared.identity, "bundle_json": prepared.bundle_json}
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: pytest.fail("mismatched context reached provider")
    )
    with pytest.raises(ConflictError, match="上下文.*不匹配"):
        service.revise_file_content(session, request, prepared_context=prepared)


def test_snapshot_binding_checks_full_body_beyond_excerpt_window(tmp_path):
    from app.common.exceptions import ConflictError
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot
    from app.domains.assistant.writing_context import writing_context_from_snapshot

    content = "长正文。" * 4000
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.revise",
        user_message="修订",
        file_path="正文.md",
        content=content,
        context_bundle={"project_root": str(tmp_path)},
    )
    assert len(snapshot["selected_file"]["content_excerpt"]) < len(content)
    with pytest.raises(ConflictError, match="正文版本不匹配"):
        writing_context_from_snapshot(
            snapshot, project_root=str(tmp_path), file_path="正文.md", content=content + "变动。", intent="file.revise"
        )


def test_http_cannot_supply_backend_prepared_context(client):
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "content": ORIGINAL,
            "instruction": "修订",
            "prepared_context": {"bundle_json": "{}"},
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("field", ["project_root", "file_path", "intent"])
def test_capsule_factory_rejects_a_snapshot_from_another_operation(tmp_path, field):
    from app.common.exceptions import ConflictError
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot
    from app.domains.assistant.writing_context import writing_context_from_snapshot

    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.revise",
        user_message="修订",
        file_path="正文.md",
        content=ORIGINAL,
        context_bundle={"project_root": str(tmp_path)},
    )
    binding = {"project_root": str(tmp_path), "file_path": "正文.md", "content": ORIGINAL, "intent": "file.revise"}
    binding[field] = {"project_root": str(tmp_path / "other"), "file_path": "other.md", "intent": "prose.continue"}[
        field
    ]
    with pytest.raises(ConflictError, match="快照.*不匹配"):
        writing_context_from_snapshot(snapshot, **binding)


def test_model_cannot_supply_the_backend_handoff_flag():
    from app.domains.agent_runs.tools.runtime_arguments import sanitize_loop_tool_arguments

    assert sanitize_loop_tool_arguments({"path": "正文.md", "prepared_context": {"bundle_json": "FORGED"}}) == {
        "path": "正文.md"
    }


@pytest.mark.parametrize("drift", [False, True])
def test_confirmed_chapter_keeps_guarded_sources_through_actual_draft_and_repair(session, tmp_path, monkeypatch, drift):
    from agent_run_test_support import _seed_agent_run
    from chapter_check_test_support import chapter_check_reply

    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import handle_agent_control_message

    _enable_loop_env(monkeypatch)
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定/灯塔.md").write_text(NEW, encoding="utf-8")
    target = tmp_path / "第001章.md"
    target.write_text("", encoding="utf-8")
    checks = []

    def chat(_session, *, user_message, context_block, assistant_session_id):
        if "整理成 Chapter Brief" in user_message:
            return {"reply": '{"goal":"建立冲突","required_beats":["见面"]}'}
        checks.append(user_message)
        if drift and len(checks) == 1:
            (tmp_path / "设定/灯塔.md").write_text(NEW + "作者在检查期间改了设定。", encoding="utf-8")
        issues = (
            [
                {
                    "rule": "missing_required_beat",
                    "severity": "hard",
                    "message": "缺少见面",
                    "line": 1,
                    "evidence": "林岚",
                }
            ]
            if len(checks) == 1
            else []
        )
        return chapter_check_reply(user_message, issues)

    prompts = []
    manuscript = "林岚在门前停步。" * 300
    monkeypatch.setattr(service, "chat_reply", chat)
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": manuscript}
    )
    run = _seed_agent_run(session, public_id="confirmed-context")
    run.permission_profile = "ask"
    session.commit()
    bundle = context_bundle(tmp_path)
    bundle.update(
        story_memory={"items": [{"text": "CONFIRMED_MEMORY_SENTINEL"}]},
        chapter_context={"goal": "CONFIRMED_CHAPTER_SENTINEL"},
    )
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {"project_path": str(tmp_path), "file_path": str(target), "context_bundle": bundle},
        },
    )

    def resume():
        return handle_agent_control_message(
            session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="resume_run",
            payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
        ).resumed_result

    if drift:
        from app.domains.agent_runs.service import AgentRuntimeError

        with pytest.raises(AgentRuntimeError, match="重新生成"):
            resume()
        assert len(prompts) == 1 and len(checks) == 1
        assert target.read_text(encoding="utf-8") == ""
        return
    resumed = resume()
    assert resumed is not None and resumed["proposed_patch"]["after"] == manuscript
    assert len(prompts) == 2 and len(checks) == 2
    for prompt in prompts:
        assert OLD not in prompt and NEW in prompt
        assert "CONFIRMED_MEMORY_SENTINEL" in prompt and "CONFIRMED_CHAPTER_SENTINEL" in prompt
        assert "Context Sources" in prompt
    assert target.read_text(encoding="utf-8") == ""


@pytest.mark.parametrize("entry", ["http", "draft", "continue"])
def test_direct_writers_cannot_follow_a_foreign_bundle_root(client, session, tmp_path, monkeypatch, entry):
    _enable_loop_env(monkeypatch)
    actual = tmp_path / "actual"
    foreign = tmp_path / "foreign"
    for root, content in [(actual, NEW), (foreign, "FOREIGN_ROOT_SENTINEL")]:
        (root / "设定").mkdir(parents=True)
        (root / "设定/灯塔.md").write_text(content, encoding="utf-8")
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": ORIGINAL}
    )
    common = {
        "file_path": str(actual / "正文.md"),
        "project_root": str(actual),
        "instruction": "写",
        "context_bundle": context_bundle(foreign),
    }
    if entry == "http":
        result = client.post("/api/assistant/revise", json={**common, "content": ORIGINAL})
        assert result.status_code == 200, result.text
    elif entry == "draft":
        service.draft_file_content(session, AssistantDraftRequest(**common))
    else:
        service.draft_continuation(session, AssistantContinueRequest(**common, content=ORIGINAL, cursor_line=1))
    assert (
        len(prompts) == 1 and NEW in prompts[0] and "FOREIGN_ROOT_SENTINEL" not in prompts[0] and OLD not in prompts[0]
    )


def test_live_writer_accepts_canonical_project_alias(client, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    actual = tmp_path / "actual"
    actual.mkdir()
    target = actual / "正文.md"
    target.write_text(ORIGINAL, encoding="utf-8")
    alias = tmp_path / "project-alias"
    if os.name == "nt":
        created = subprocess.run(
            ["cmd.exe", "/c", "mklink", "/J", str(alias), str(actual)],
            capture_output=True,
            text=True,
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        assert created.returncode == 0, "test project junction could not be created"
    else:
        alias.symlink_to(actual, target_is_directory=True)
    assert alias.resolve() == actual.resolve()
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["user_prompt"]) or {"content": ORIGINAL}
    )
    _fake_llm_script(
        monkeypatch,
        [
            {
                "tool_calls": [
                    {
                        "id": "alias-write",
                        "type": "function",
                        "function": {
                            "name": "file_revise",
                            "arguments": json.dumps({"path": "正文.md", "instruction": "润色"}),
                        },
                    }
                ]
            },
            {"content": "已生成建议"},
        ],
    )
    result = agent_result(
        client,
        "project-alias",
        run_id="project-alias",
        intent="chat",
        user_message="润色正文",
        args={"project_path": str(alias)},
    )
    assert result["type"] == "agent_result", result
    write_trace = next(item for item in result["tool_trace"] if item["tool_name"] == "file.revise")
    assert write_trace["status"] == "completed", write_trace
    assert len(prompts) == 1, result
    assert result["proposed_patch"]["before"] == ORIGINAL
    assert target.read_text(encoding="utf-8") == ORIGINAL
