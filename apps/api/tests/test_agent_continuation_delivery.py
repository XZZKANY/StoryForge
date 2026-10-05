"""C14–C18: exercise the final writer prompt and pause/resume boundaries."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_run_test_support import _seed_agent_run
from agent_transport import stream_agent_message
from chapter_check_test_support import chapter_check_reply

from app.common.manuscript import previous_chapter_tail
from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
)
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.service import handle_agent_control_message
from app.domains.agent_runs.service_types import AgentRuntimeError
from app.domains.assistant import continuation
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantContinueRequest

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

PREFIX = "PREFIX_SENTINEL：他推开门。"
SUFFIX = "SUFFIX_SENTINEL：门外已经有人在等他。"
PIN = "PIN_SENTINEL：钥匙始终由林岚持有。"
INSERTION = "他停了一步，握紧钥匙。"


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _writer(monkeypatch):
    prompts = []
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def capture(_source, *, system_prompt, user_prompt, **_kwargs):
        prompts.append((system_prompt, user_prompt))
        return {"content": INSERTION, "completion_tokens": 9, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "_call_llm_streamed", capture)
    return prompts


def _bundle(project, *, api=False):
    item = {"relative_path": "设定/钥匙.md", "kind": "setting", "excerpt": PIN}
    if api:
        item.update(path="设定/钥匙.md", title="钥匙")
    return {"project_root": str(project), "current_file": "正文/第01章.md", "files": [item]}


def test_draft_writer_sees_existing_suffix(session, tmp_path, monkeypatch):
    prompts = _writer(monkeypatch)
    assistant_service.draft_continuation(
        session,
        AssistantContinueRequest(file_path="chapter.md", content=f"{PREFIX}\n\n{SUFFIX}", cursor_line=1),
    )
    assert PREFIX in prompts[0][1]
    assert SUFFIX in prompts[0][1], "middle insertion must not be mistaken for EOF"
    assert "只读" in prompts[0][1]


def test_suffix_delivery_is_bounded_and_trace_is_honest(session, monkeypatch):
    prompts = _writer(monkeypatch)
    suffix = "紧邻后文。" * 700 + "OUTSIDE_SUFFIX_WINDOW"
    response = assistant_service.draft_continuation(
        session,
        AssistantContinueRequest(
            file_path="chapter.md",
            content=f"{PREFIX}\n{suffix}",
            cursor_line=1,
        ),
    )
    assert suffix[: continuation.SUFFIX_MAX_CHARS] in prompts[0][1]
    assert "OUTSIDE_SUFFIX_WINDOW" not in prompts[0][1]
    assert "后文超过上下文窗口" in prompts[0][1]
    tool_call = assistant_service.list_assistant_tool_calls(session, response.assistant_session_id)[0]
    assert tool_call.input_summary["suffix_chars"] == continuation.SUFFIX_MAX_CHARS
    assert tool_call.input_summary["suffix_truncated"] is True


@pytest.mark.parametrize("profile", ["auto", "full"])
def test_continue_auto_profile_still_only_proposes(client, novel_project, monkeypatch, profile):
    target = novel_project / "正文/第01章.md"
    target.write_text(PREFIX, encoding="utf-8")
    _enable_loop_env(monkeypatch)
    _writer(monkeypatch)
    loop_calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "continue",
                        "type": "function",
                        "function": {
                            "name": "prose_continue",
                            "arguments": '{"path":"正文/第01章.md"}',
                        },
                    }
                ],
            },
            {"content": "已生成续写补丁。", "tool_calls": []},
        ],
    )
    result = stream_agent_message(
        client,
        "session-continue-auto",
        run_id="run-continue-auto",
        user_message="继续写",
        permission_profile=profile,
        args={"project_path": str(novel_project)},
    )[-1]
    assert result["proposed_patch"]["requires_confirmation"] is False
    assert target.read_text(encoding="utf-8") == PREFIX
    trace = next(t for t in result["tool_trace"] if t["tool_name"] == "prose.continue")
    assert "已按本项目的自动档直接写盘" not in str(loop_calls)
    assert "守卫写回" in str(loop_calls)
    assert trace["input_summary"]["file_path"] == "正文/第01章.md"


@pytest.mark.parametrize("cursor", [0, 1, 99], ids=["start", "middle", "end"])
def test_continue_endpoint_delivers_suffix_and_pin(client, tmp_path, monkeypatch, cursor):
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定/钥匙.md").write_text(PIN, encoding="utf-8")
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured = []

    def stream(_source, payload, **_kwargs):
        captured.append(payload["messages"])
        yield {"type": "delta", "text": INSERTION}
        yield {"type": "done", "content": INSERTION}

    monkeypatch.setattr(assistant_service, "stream_chat_completions", stream)
    response = client.post(
        "/api/assistant/continue",
        json={
            "file_path": str(tmp_path / "正文/第01章.md"),
            "project_root": str(tmp_path),
            "content": f"{PREFIX}\n\n{SUFFIX}",
            "cursor_line": cursor,
            "context_bundle": _bundle(tmp_path, api=True),
        },
    )
    assert response.status_code == 200, response.text
    prompt = captured[0][-1]["content"]
    assert PIN in prompt
    if cursor < 3:
        assert SUFFIX in prompt
        assert "只读" in prompt
    else:
        assert "<<<SUFFIX" not in prompt
    assert "event: done" in response.text


@pytest.mark.parametrize(
    "view_path,explicit_anchor,expected",
    [
        ("same-relative", None, 1),
        ("same-absolute", None, 1),
        ("same-case", None, 1),
        ("other", None, 3),
        ("missing", None, 3),
        ("other", 1, 1),
    ],
)
@pytest.mark.parametrize("pin_source", ["bundle", "loop-read"])
def test_live_continue_uses_only_target_cursor_and_delivers_pin(
    client,
    novel_project,
    monkeypatch,
    view_path,
    explicit_anchor,
    expected,
    pin_source,
):
    target = novel_project / "正文/第01章.md"
    content = f"{PREFIX}\n\n{SUFFIX}"
    target.write_text(content, encoding="utf-8")
    (novel_project / "设定/钥匙.md").write_text(PIN, encoding="utf-8")
    _enable_loop_env(monkeypatch)
    prompts = _writer(monkeypatch)
    arguments = {"path": "正文/第01章.md", "context_bundle": {"files": [{"excerpt": "MODEL_FAKE_PIN"}]}}
    if explicit_anchor is not None:
        arguments["anchor_line"] = explicit_anchor
    script = [
        {
            "content": "",
            "tool_calls": [
                {
                    "id": "continue",
                    "type": "function",
                    "function": {
                        "name": "prose_continue",
                        "arguments": json.dumps(arguments),
                    },
                }
            ],
        },
        {"content": "补丁已生成。", "tool_calls": []},
    ]
    if pin_source == "loop-read":
        script.insert(
            0,
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "read-pin",
                        "type": "function",
                        "function": {
                            "name": "fs_read",
                            "arguments": json.dumps({"path": "设定/钥匙.md"}),
                        },
                    }
                ],
            },
        )
    _fake_llm_script(monkeypatch, script)
    paths = {
        "same-relative": "正文/第01章.md",
        "same-absolute": str(target),
        "same-case": str(target).upper(),
        "other": "正文/第99章.md",
    }
    (novel_project / "正文/第99章.md").write_text("另一份稿件。", encoding="utf-8")
    args = {"project_path": str(novel_project), "context_bundle": _bundle(novel_project)}
    if pin_source == "loop-read":
        args["context_bundle"]["files"] = []
    args["author_view"] = {"cursor_line": 1, "file_path": paths.get(view_path)}
    frames = stream_agent_message(
        client,
        "session-continuation-delivery",
        run_id="run-continuation-delivery",
        user_message="接着写",
        args=args,
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["continue_audit"]["anchor_line"] == expected
    assert len(prompts) == 1
    assert PIN in prompts[0][1], "outer loop pin must reach the actual inner writer"
    assert "MODEL_FAKE_PIN" not in prompts[0][1]
    if expected == 1:
        assert SUFFIX in prompts[0][1]
        assert patch["after"].index(INSERTION) < patch["after"].index(SUFFIX)
    else:
        assert patch["after"].index(INSERTION) > patch["after"].index(SUFFIX)
    assert target.read_text(encoding="utf-8") == content
    assert patch["requires_confirmation"] is True
    trace = next(t for t in result["tool_trace"] if t["tool_name"] == "prose.continue")
    assert all(PIN not in text and str(novel_project) not in text for text in _strings(trace))
    assert trace["input_summary"]["context_provenance"]["context_file_count"] >= 1


@pytest.mark.parametrize("relative", [False, True], ids=["absolute", "relative"])
@pytest.mark.parametrize(
    "name,previous", [("第003章.md", "第002章.md"), ("第002章.md", "第001章.md"), ("第000章.md", None)]
)
def test_unwritten_chapter_gets_reading_order_predecessor(tmp_path, relative, name, previous):
    (tmp_path / "正文").mkdir()
    for filename in ("第001章.md", "第002章.md", "第004章.md"):
        if filename != name:
            (tmp_path / "正文" / filename).write_text(f"{filename}尾部。", encoding="utf-8")
    current = Path("正文") / name
    result = previous_chapter_tail(str(tmp_path), str(current if relative else tmp_path / current))
    if previous is None:
        assert result is None
    else:
        assert result == (f"正文/{previous}", f"{previous}尾部。")
    assert not (tmp_path / current).exists()


@pytest.mark.parametrize(
    "source", ["bundle", "mislabeled-bundle", "previous", "instructions", "canon", "hooks", "new-previous"]
)
def test_brief_resume_refuses_drift_before_draft(session, tmp_path, monkeypatch, source):
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / ".storyforge/canon").mkdir(parents=True)
    previous = tmp_path / "正文/第001章.md"
    previous.write_text("旧的上一章。", encoding="utf-8")
    selected = tmp_path / "设定/钥匙.md"
    selected.write_text(PIN, encoding="utf-8")
    instructions = tmp_path / ".storyforge/agent-instructions.md"
    instructions.write_text("旧的作者要求。", encoding="utf-8")
    canon = tmp_path / ".storyforge/canon/canon.json"
    canon.write_text(
        '{"version":1,"entities":[],"invariants":{"mutually_exclusive":[["红门","蓝门"]]}}', encoding="utf-8"
    )
    hooks = tmp_path / ".storyforge/canon/hooks.json"
    hooks.write_text('{"version":1,"hooks":[]}', encoding="utf-8")
    target = tmp_path / "正文/第003章.md"
    monkeypatch.setattr(assistant_service, "chat_reply", lambda *_a, **_k: {"reply": '{"goal":"追查钥匙"}'})
    draft_calls = []
    monkeypatch.setattr(assistant_service, "draft_file_content", lambda *_a, **_k: draft_calls.append(1))
    run = _seed_agent_run(session, public_id="run-brief-drift")
    run.permission_profile = "ask"
    session.commit()
    bundle = _bundle(tmp_path)
    if source == "mislabeled-bundle":
        bundle["files"][0]["kind"] = "context_sources"
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第三章",
            "args": {
                "project_path": str(tmp_path),
                "file_path": str(target),
                "context_bundle": bundle,
            },
        },
    )
    changed = {
        "bundle": selected,
        "mislabeled-bundle": selected,
        "previous": previous,
        "instructions": instructions,
        "canon": canon,
        "hooks": hooks,
        "new-previous": tmp_path / "正文/第002章.md",
    }[source]
    if source == "canon":
        changed.write_text('{"version":1,"entities":[],"invariants":{}}', encoding="utf-8")
    elif source == "hooks":
        changed.write_text(
            '{"version":1,"hooks":[{"id":"new","status":"open","question":"谁拿了钥匙"}]}', encoding="utf-8"
        )
    else:
        changed.write_text("确认期间修改。", encoding="utf-8")
    # The public recovery interface must reject drift without a second writer call.
    try:
        control = handle_agent_control_message(
            session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="resume_run",
            payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
        )
    except AgentRuntimeError as exc:
        assert "重新生成" in str(exc), str(exc)
    else:
        assert control.resumed_result is not None
        assert "重新生成" in str(control.resumed_result)
    assert draft_calls == []
    assert not target.exists()


@pytest.mark.parametrize("state", ["active", "retired", "corrupt"])
def test_public_continue_admits_structured_pins(client, tmp_path, monkeypatch, state):
    (tmp_path / "设定").mkdir()
    claim = "STRUCTURED_PIN_SENTINEL：只有林岚能取钥匙。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440020",
        status="retired" if state == "retired" else "active",
        kind="world_rule",
        evidence_state="current",
        title="钥匙规则",
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_1"),),
        claim_fingerprint=knowledge_claim_fingerprint("钥匙规则", claim),
        created_at="2026-10-04T00:00:00Z",
        updated_at="2026-10-04T00:00:00Z",
    )
    raw = render_knowledge_entry(entry)
    if state == "corrupt":
        raw = raw.replace(claim, claim + "损坏")
    source = tmp_path / "设定/钥匙.md"
    source.write_text(raw, encoding="utf-8")
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")
    prompts = []

    def stream(_source, payload, **_kwargs):
        prompts.append(payload["messages"][-1]["content"])
        yield {"type": "delta", "text": INSERTION}
        yield {"type": "done", "content": INSERTION}

    monkeypatch.setattr(assistant_service, "stream_chat_completions", stream)
    bundle = _bundle(tmp_path, api=True)
    # A mislabeled source cannot bypass admission; root authority comes from
    # the request, not from an independently supplied bundle root.
    bundle["files"][0]["excerpt"] = raw
    bundle["project_root"] = str(tmp_path / "not-the-project")
    response = client.post(
        "/api/assistant/continue",
        json={
            "file_path": str(tmp_path / "正文/第01章.md"),
            "project_root": str(tmp_path),
            "content": PREFIX,
            "cursor_line": 1,
            "context_bundle": bundle,
        },
    )
    assert response.status_code == 200, response.text
    assert len(prompts) == 1
    assert (claim in prompts[0]) == (state == "active")
    assert "<!-- storyforge-knowledge" not in prompts[0]
    assert source.read_text(encoding="utf-8") == raw


@pytest.mark.parametrize("boundary", ["unchanged", "brief-call", "draft-call", "legacy-pending"])
def test_brief_source_guard_at_provider_and_recovery_boundaries(session, tmp_path, monkeypatch, boundary):
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / ".storyforge").mkdir()
    (tmp_path / "正文/第001章.md").write_text("PREVIOUS_SENTINEL：他追到了码头。", encoding="utf-8")
    (tmp_path / "设定/钥匙.md").write_text(PIN, encoding="utf-8")
    instructions = tmp_path / ".storyforge/agent-instructions.md"
    instructions.write_text("AUTHOR_SENTINEL：只用第三人称。", encoding="utf-8")
    target = tmp_path / "正文/第002章.md"
    calls = []

    def chat(_session, *, user_message, **_kwargs):
        if "整理成 Chapter Brief" in user_message:
            if boundary == "brief-call":
                instructions.write_text("生成 Brief 时变更。", encoding="utf-8")
            return {"reply": '{"goal":"追查钥匙"}'}
        return chapter_check_reply(user_message, [])

    def writer(_source, *, system_prompt, user_prompt, **_kwargs):
        calls.append((system_prompt, user_prompt))
        if boundary == "draft-call":
            instructions.write_text("生成正文时变更。", encoding="utf-8")
        return {"content": "一" * 1800, "completion_tokens": 10, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "chat_reply", chat)
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    run = _seed_agent_run(session, public_id="run-brief-source-boundary")
    run.permission_profile = "ask"
    session.commit()
    runtime = AgentRuntime(_AgentRunEventSink(session))
    message = {
        "intent": "chapter.write",
        "user_message": "写第二章",
        "args": {
            "project_path": str(tmp_path),
            "file_path": str(target),
            "context_bundle": _bundle(tmp_path),
        },
    }
    if boundary == "brief-call":
        from app.domains.agent_runs.errors import AgentOrchestrationError

        with pytest.raises(AgentOrchestrationError, match="重新生成"):
            runtime.run_user_message(session, run=run, agent_session_id=run.session_id, message=message)
        assert calls == []
        assert not target.exists()
        return
    initial = runtime.run_user_message(session, run=run, agent_session_id=run.session_id, message=message)
    if boundary == "legacy-pending":
        pending = next(a for a in run.artifacts if a.kind == "runtime_pending_call")
        pending.payload = {k: v for k, v in pending.payload.items() if k != "source_guard"}
        session.commit()

    def resume():
        return handle_agent_control_message(
            session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="resume_run",
            payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
        )

    if boundary in {"draft-call", "legacy-pending"}:
        with pytest.raises(AgentRuntimeError, match="重新生成"):
            resume()
        assert len(calls) == (1 if boundary == "draft-call" else 0)
    else:
        result = resume().resumed_result
        assert result["proposed_patch"]["after"] == "一" * 1800
        assert len(calls) == 1
        assert "AUTHOR_SENTINEL" in calls[0][0]
        assert "PREVIOUS_SENTINEL" in calls[0][1]
        assert PIN in calls[0][1]
    assert not target.exists()
