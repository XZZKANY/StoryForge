"""Loop execution policies are declared once, independently of tool names and model input."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message

from app.domains.agent_runs import service
from app.domains.agent_runs.loop import sdk_adapters
from app.domains.agent_runs.loop.support import tool_output_summary
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.tools import (
    ToolResult,
    build_loop_tool_schemas,
    list_loop_tool_specs,
    tool_definition_from_spec,
)
from app.domains.agent_runs.tools.runtime_arguments import (
    HANDLER_OWNED_TRACE_TOOL_NAMES,
    TRUSTED_WRITING_CONTEXT_TOOL_NAMES,
    sanitize_loop_tool_arguments,
)
from app.domains.agent_runs.trace import AgentToolTrace

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

EXPECTED = {
    "file.review": ("existing_file", False, "generic"),
    "file.revise": ("existing_file", True, "handler"),
    "chapter.polish": ("existing_file", True, "handler"),
    "project.trim_prose": ("existing_file", False, "generic"),
    "prose.continue": ("existing_file", False, "generic"),
    "file.create": ("new_file", True, "handler"),
    "knowledge.propose": ("project", False, "handler"),
}
POLICY_FIELDS = ("loop_input_mode", "loop_trusted_context", "loop_trace_owner")


def test_existing_loop_policies_and_definition_projection_are_exact():
    for spec in list_loop_tool_specs():
        expected = EXPECTED.get(spec.name, ("project", False, "generic"))
        definition = tool_definition_from_spec(spec, lambda context, payload: None)
        assert tuple(getattr(spec, field) for field in POLICY_FIELDS) == expected, spec.name
        assert tuple(getattr(definition, field) for field in POLICY_FIELDS) == expected, spec.name
    assert {name for name, (_, trusted, _) in EXPECTED.items() if trusted} == TRUSTED_WRITING_CONTEXT_TOOL_NAMES
    assert {name for name, (_, _, owner) in EXPECTED.items() if owner == "handler"} == HANDLER_OWNED_TRACE_TOOL_NAMES
    assert not any(field in json.dumps(build_loop_tool_schemas()) for field in POLICY_FIELDS)


@pytest.mark.parametrize(
    "changes",
    [
        {"loop_input_mode": "typo"},
        {"loop_trace_owner": "typo"},
        {"loop_trusted_context": "false"},
        {"loop_input_mode": "project", "loop_trusted_context": True},
    ],
)
def test_invalid_internal_policy_is_rejected_at_declaration(changes):
    base = next(spec for spec in list_loop_tool_specs() if spec.name == "file.revise")
    with pytest.raises(ValueError, match="loop"):
        replace(base, **changes)


def test_model_cannot_supply_loop_policy_fields():
    arguments = {"path": "正文/a.md", **dict(zip(POLICY_FIELDS, ("new_file", True, "handler"), strict=True))}
    assert sanitize_loop_tool_arguments(arguments) == {"path": "正文/a.md"}


@pytest.fixture()
def run_declared_tool(client, monkeypatch, novel_project):
    def run(*, mode="existing_file", trusted=True, owner="handler", outcome="success", path=None):
        _enable_loop_env(monkeypatch)
        base_specs = list_loop_tool_specs()
        base = next(spec for spec in base_specs if spec.name == "file.revise")
        demo = replace(
            base,
            name="fixture.context_probe",
            risk_level="analyze",
            artifact_kinds=(),
            loop_input_mode=mode,
            loop_trusted_context=trusted,
            loop_trace_owner=owner,
        )
        received_payloads = []
        output = {"result": "raw output fixture", "count": 1}
        safe_input = {"source": "handler_safe", "path": "正文/目标.md"}
        safe_output = {} if outcome == "empty_summary" else {"source": "handler_safe", "count": 1}

        def handler(context, payload):
            received_payloads.append(payload)
            if outcome == "failure":
                raise ValueError("fixture handler failure")
            return ToolResult(
                status="completed",
                output=output,
                trace=AgentToolTrace(
                    demo.name,
                    "completed",
                    safe_input,
                    None if outcome == "no_summary" else safe_output,
                    audit_event_id="audit_fixture",
                ),
            )

        class RuntimeWithDeclaredTool(AgentRuntime):
            def __init__(self, event_sink):
                super().__init__(event_sink)
                self._tool_registry.register(tool_definition_from_spec(demo, handler))

        monkeypatch.setattr(service, "AgentRuntime", RuntimeWithDeclaredTool)
        monkeypatch.setattr(sdk_adapters, "list_loop_tool_specs", lambda: (*base_specs, demo))
        target = path or ("正文/新章.md" if mode == "new_file" else "正文/第01章.md")
        forged = {
            "path": target,
            "instruction": "检查事实",
            "file_path": "MODEL_FORGED",
            "content": "MODEL_FORGED",
            "project_root": "MODEL_FORGED",
            "_trace_file_path": "MODEL_FORGED",
            "context_bundle": {"files": ["MODEL_FORGED"]},
            "llm_prompt_context_bundle": {"files": ["MODEL_FORGED"]},
            "llm_context_snapshot": {"snapshot_id": "MODEL_FORGED"},
            "context_provenance": "MODEL_FORGED",
            "confirmed": True,
            "user_confirmed": True,
            "loop_input_mode": "project",
            "loop_trusted_context": not trusted,
            "loop_trace_owner": "generic",
        }
        _fake_llm_script(
            monkeypatch,
            [
                {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "probe",
                            "type": "function",
                            "function": {
                                "name": "fixture_context_probe",
                                "arguments": json.dumps(forged),
                            },
                        }
                    ],
                },
                {"content": "完成检查。", "tool_calls": []},
            ],
        )
        run_id = "policy-probe"
        responses = _send_chat_message(
            client,
            run_id=run_id,
            project_path=str(novel_project),
            message="看看项目里的内容",
            context_bundle={
                "project_root": str(novel_project),
                "files": [
                    {
                        "relative_path": "设定/人物.md",
                        "kind": "character",
                        "excerpt": "TRUSTED_REQUEST_SENTINEL",
                    }
                ],
            },
        )
        result = responses[-1]
        events = client.get(f"/api/agent-runs/{run_id}/events").json()
        trace = next(item for item in result["tool_trace"] if item["tool_name"] == demo.name)
        return received_payloads, trace, events, output, safe_input, safe_output

    return run


@pytest.mark.parametrize(
    "mode,trusted,owner",
    [
        ("existing_file", True, "handler"),
        ("new_file", True, "handler"),
        ("project", False, "generic"),
        ("existing_file", False, "generic"),
        ("existing_file", False, "handler"),
    ],
)
def test_unfamiliar_tool_name_uses_declared_input_and_trace_policies(
    run_declared_tool, novel_project, mode, trusted, owner
):
    payloads, trace, events, output, safe_input, safe_output = run_declared_tool(
        mode=mode, trusted=trusted, owner=owner
    )
    assert len(payloads) == 1
    payload = payloads[0]
    assert payload["project_root"] == str(novel_project)
    assert "MODEL_FORGED" not in json.dumps(payload)
    assert all(field not in payload for field in (*POLICY_FIELDS, "confirmed", "user_confirmed"))
    if mode == "existing_file":
        assert payload["content"] == (novel_project / "正文/第01章.md").read_text(encoding="utf-8")
        assert payload["_trace_file_path"] == "正文/第01章.md"
        assert payload["file_path"] == str((novel_project / "正文/第01章.md").resolve())
        assert "path" not in payload
    elif mode == "new_file":
        assert not payload.get("content")
        assert payload["_trace_file_path"] == "正文/新章.md"
        assert not (novel_project / "正文/新章.md").exists()
        assert "path" not in payload
    else:
        assert payload["path"] == "正文/第01章.md"
        assert "file_path" not in payload and "content" not in payload
    if trusted:
        assert "TRUSTED_REQUEST_SENTINEL" in json.dumps(payload["llm_prompt_context_bundle"])
        assert payload["llm_context_snapshot"]["selected_file"]["file_path"] == payload["_trace_file_path"]
    else:
        assert "llm_context_snapshot" not in payload and "llm_prompt_context_bundle" not in payload
    assert trace["status"] == "completed"
    if owner == "handler":
        assert trace["input_summary"] == safe_input
        assert trace["output_summary"] == safe_output
        assert trace["audit_event_id"] == "audit_fixture"
    else:
        assert trace["input_summary"]["path"] == "正文/第01章.md"
        assert trace["output_summary"] == tool_output_summary("fixture.context_probe", output)
        assert "audit_event_id" not in trace
    encoded = json.dumps(events, ensure_ascii=False)
    assert "MODEL_FORGED" not in encoded
    assert "TRUSTED_REQUEST_SENTINEL" not in encoded
    assert not any(field in json.dumps(trace) for field in POLICY_FIELDS)


@pytest.mark.parametrize("outcome", ["no_summary", "empty_summary", "failure"])
def test_handler_trace_fallback_and_failure_keep_existing_semantics(run_declared_tool, outcome):
    payloads, trace, events, output, safe_input, _ = run_declared_tool(outcome=outcome)
    assert len(payloads) == 1
    if outcome in {"no_summary", "empty_summary"}:
        assert trace["status"] == "completed"
        assert trace["input_summary"] == safe_input
        expected_summary = {} if outcome == "empty_summary" else tool_output_summary("fixture.context_probe", output)
        assert trace["output_summary"] == expected_summary
        assert trace["audit_event_id"] == "audit_fixture"
    else:
        assert trace["status"] == "failed"
        assert trace["error_message"] == "fixture handler failure"
        assert trace["input_summary"] == {"path": "正文/第01章.md", "instruction": "检查事实"}
        assert "audit_event_id" not in trace
    assert "MODEL_FORGED" not in json.dumps(events)


@pytest.mark.parametrize("path", ["../outside.md", "正文/missing.md"])
def test_declared_existing_file_policy_still_rejects_invalid_path_before_handler(run_declared_tool, path):
    payloads, trace, _, _, _, _ = run_declared_tool(path=path)
    assert payloads == []
    assert trace["status"] == "failed"


def test_declared_file_policy_rejects_truncation_before_handler(run_declared_tool, novel_project):
    (novel_project / "正文/第01章.md").write_bytes(("文" * 200_001).encode())
    payloads, trace, _, _, _, _ = run_declared_tool()
    assert payloads == []
    assert trace["status"] == "failed"
    assert "超过单次处理上限" in trace["error_message"]


def test_internal_policy_is_not_part_of_tool_catalog_dto():
    from app.domains.runtime_tools.service import list_runtime_tools

    serialized = json.dumps([tool.model_dump(mode="json") for tool in list_runtime_tools()])
    assert all(field not in serialized for field in POLICY_FIELDS)
