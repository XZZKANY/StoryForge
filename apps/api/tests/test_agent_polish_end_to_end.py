from __future__ import annotations

import json
from dataclasses import replace

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import stream_agent_message
from authoring_measurement_support import SyntheticPolishProvider, fixture_resolution, fixture_text
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import service
from app.domains.agent_runs.events import runtime_support
from app.domains.agent_runs.patches import polishing_service
from app.domains.agent_runs.tools import ToolArtifact
from app.domains.ide import router as ide_router
from app.platform.ai_sdk.providers.anthropic import AnthropicProvider


@pytest.fixture
def engine(tmp_path):
    """控制与 worker 使用不同物理连接，不能用 StaticPool 假装并发可见。"""
    db = create_engine(
        f"sqlite+pysqlite:///{tmp_path / 'polish.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 2},
        poolclass=NullPool,
    )

    @event.listens_for(db, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    with db.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        connection.exec_driver_sql("BEGIN")
        Base.metadata.create_all(connection)
        connection.commit()
    try:
        yield db
    finally:
        db.dispose()


class PolishFlow:
    def __init__(self, client, monkeypatch, tmp_path, session_factory):
        self.client = client
        self.monkeypatch = monkeypatch
        self.session_factory = session_factory
        self.root = tmp_path / "novel"
        self.target = self.root / "正文" / "第01章.md"
        self.target.parent.mkdir(parents=True)
        self.run_id = "real-polish-run"
        self.session_id = "session-real-polish"
        self.requests = []
        self.outer_calls = []
        self.control_events = []
        _enable_loop_env(monkeypatch)
        monkeypatch.setattr(polishing_service, "resolve_polish_llm", lambda **_: fixture_resolution())

    def control(self, control_type):
        with self.session_factory() as control:
            response = service.handle_agent_control_message(
                control,
                public_id=self.run_id,
                session_id=self.session_id,
                control_type=control_type,
            )
            self.control_events.append(response.event.id)

    def send(
        self,
        entry,
        *,
        original=None,
        profile="full",
        scenario="success",
        during_model=None,
        context_bundle=None,
        tool_arguments=None,
        transform_response=None,
    ):
        original = fixture_text(2) if original is None else original
        self.target.write_bytes(original.encode("utf-8"))
        self.original_bytes = self.target.read_bytes()
        self.provider = SyntheticPolishProvider(scenario)

        def complete(_provider, request):
            self.requests.append(request)
            if during_model:
                during_model()
            response = self.provider.complete(request)
            return transform_response(response) if transform_response else response

        self.monkeypatch.setattr(AnthropicProvider, "complete", complete)
        args = {
            "project_path": str(self.root),
            "context_bundle": context_bundle if context_bundle is not None else {"files": []},
        }
        if entry == "chat":
            self.outer_calls = _fake_llm_script(
                self.monkeypatch,
                [
                    {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "real-polish-tool",
                                "type": "function",
                                "function": {
                                    "name": "chapter_polish",
                                    "arguments": json.dumps({"path": "正文/第01章.md", **(tool_arguments or {})}),
                                },
                            }
                        ],
                    },
                    {"content": "已处理，请查看结果。", "tool_calls": []},
                ],
            )
        else:
            args.update(file_path="正文/第01章.md", content=original)
        self.frames = stream_agent_message(
            self.client,
            self.session_id,
            run_id=self.run_id,
            intent="chapter.polish" if entry == "intent" else None,
            user_message="保守润色这一章",
            permission_profile=profile,
            args=args,
        )
        assert self.target.read_bytes() == self.original_bytes
        return self.frames[-1]

    def replay(self, suffix=""):
        response = self.client.get(f"/api/agent-runs/{self.run_id}" + suffix)
        assert response.status_code == 200, response.text
        return response.json()

    def trace(self):
        return next(t for t in self.frames[-1]["tool_trace"] if t["tool_name"] == "chapter.polish")

    def assert_delivery(self, patch, *, confirmation=False):
        events = self.replay("/events")
        artifacts = [a for a in self.replay("/artifacts") if a["kind"] == "proposed_patch"]
        permissions = [e for e in events if e["event_type"] == "permission_required"]
        completed = [e for e in events if e["event_type"] == "agent_run_completed"]
        assert self.replay()["status"] == ("paused" if confirmation else "completed")
        assert len(permissions) == int(confirmation)
        assert len(completed) == int(not confirmation)
        assert not any(key.startswith("_") for key in self.frames[-1])
        evidence = json.dumps([self.frames, events, artifacts], ensure_ascii=False)
        assert "fixture-only-key" not in evidence
        assert "PRIVATE" not in evidence
        if patch is None:
            assert not artifacts
            assert not permissions
            return
        assert len(artifacts) == 1
        assert artifacts[0]["payload"] == patch
        assert artifacts[0]["requires_confirmation"] is confirmation
        artifact_event = next(
            e
            for e in events
            if e["event_type"] == "agent_artifact" and e["payload"]["artifact_id"] == artifacts[0]["id"]
        )
        assert artifact_event["payload"]["payload"]["id"] == patch["id"]
        assert self.trace()["output_summary"]["patch_id"] == patch["id"]
        assert patch["requires_confirmation"] is confirmation
        assert self.frames[-1]["agent_result"]["requires_user_confirmation"] is confirmation
        if confirmation:
            assert self.replay()["current_step"] == "permission.confirm"
            assert permissions[0]["payload"]["proposed_patch"]["id"] == patch["id"]


@pytest.fixture
def flow(client, monkeypatch, tmp_path, session_factory):
    return PolishFlow(client, monkeypatch, tmp_path, session_factory)


@pytest.mark.parametrize("entry", ["intent", "chat"])
@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
@pytest.mark.parametrize("scenario", ["success", "provider_failure"])
def test_inner_model_control_never_delivers_late_patch(flow, entry, control_type, status, scenario):
    result = flow.send(entry, scenario=scenario, during_model=lambda: flow.control(control_type))

    assert result["type"] == "agent_result"
    assert flow.provider.calls == 1
    assert len(flow.control_events) == 1
    assert result.get("proposed_patch") is None
    assert result["runtime_interruption"]["status"] == status
    assert result["agent_result"]["runtime_interrupted"] is True
    assert result["agent_result"]["requires_user_confirmation"] is False
    assert not any(key.startswith("_") for key in result)
    assert flow.replay()["status"] == status
    assert not any(artifact["kind"] == "proposed_patch" for artifact in flow.replay("/artifacts"))
    event_types = [event["event_type"] for event in flow.replay("/events")]
    assert "permission_required" not in event_types
    assert "agent_run_completed" not in event_types
    if entry == "chat":
        assert len(flow.outer_calls) == 1


@pytest.mark.parametrize("profile", ["ask", "auto", "full"])
@pytest.mark.parametrize("entry", ["intent", "chat"])
def test_real_online_polish_preserves_markdown_and_permission_evidence(flow, entry, profile):
    prefix = "---\ntitle: 不可修改，，！！\n---\n# 第一章，，！！\n\n"
    fence = "\n\n```text\n保留，，！！\n```\n"
    original = prefix + fixture_text(2).split("\n\n", 1)[1] + fence
    result = flow.send(entry, profile=profile, original=original)
    assert result["type"] == "agent_result"
    assert flow.provider.calls == 1
    patch = result["proposed_patch"]
    assert patch["before"] == original
    assert (
        patch["after"]
        == prefix + fixture_text(2).split("\n\n", 1)[1].replace("，，", "，").replace("！！", "！") + fence
    )
    assert patch["candidate_source"] == "online"
    assert patch["polish_status"] == "accepted"
    assert patch["degraded"] is False
    payload = json.loads(flow.requests[0].messages[-1].content)
    segments = json.dumps(payload["segments"], ensure_ascii=False)
    assert "不可修改" not in segments and "保留" not in segments and "第一章" not in segments
    flow.assert_delivery(patch, confirmation=profile == "ask")


@pytest.mark.parametrize("entry", ["intent", "chat"])
@pytest.mark.parametrize("profile", ["auto", "full"])
@pytest.mark.parametrize(
    "scenario,failure",
    [
        ("provider_failure", "provider_failed"),
        ("invalid_json", "invalid_model_response"),
        ("truncated", None),
    ],
)
def test_real_degraded_polish_requires_confirmation_even_for_auto_or_full(flow, entry, profile, scenario, failure):
    result = flow.send(entry, profile=profile, scenario=scenario)
    assert flow.provider.calls == 1
    patch = result["proposed_patch"]
    assert patch["candidate_source"] == "local"
    assert patch["polish_status"] == "degraded" and patch["degraded"] is True
    assert patch["after"] == fixture_text(2).replace("，，", "，").replace("！！", "！")
    trace = flow.trace()["output_summary"]
    assert trace["online_failure"] == failure
    if scenario == "truncated":
        assert "response_truncated" in trace["gate_reasons"]["online"]
    flow.assert_delivery(patch, confirmation=True)


@pytest.mark.parametrize("entry", ["intent", "chat"])
@pytest.mark.parametrize("scenario", ["noop", "both_rejected"])
def test_real_noop_or_both_rejected_never_creates_empty_patch(flow, entry, scenario):
    original = "# 第一章\n\n林岚推开门" + ("，" * 40 if scenario == "both_rejected" else "，") + "握紧刀。\n"

    def clean_all_commas(response):
        payload = json.loads(response.content)
        for part in payload["segments"]:
            part["text"] = part["text"].replace("，" * 20, "，")
        return replace(response, content=json.dumps(payload, ensure_ascii=False))

    result = flow.send(entry, original=original, transform_response=clean_all_commas)
    assert flow.provider.calls == 1
    assert result["proposed_patch"] is None
    output = flow.trace()["output_summary"]
    assert output["status"] == ("rejected" if scenario == "both_rejected" else "noop")
    assert output["selected_source"] == "original"
    if scenario == "both_rejected":
        assert "word_count_drift" in output["gate_reasons"]["online"]
        assert "word_count_drift" in output["gate_reasons"]["local"]
    flow.assert_delivery(None)


@pytest.mark.parametrize("entry", ["intent", "chat"])
def test_read_permission_prevents_real_polish_provider_and_patch(flow, entry):
    result = flow.send(entry, profile="read")
    assert flow.provider.calls == 0
    assert flow.requests == []
    assert result.get("proposed_patch") is None
    assert not any(a["kind"] == "proposed_patch" for a in flow.replay("/artifacts"))
    assert "permission_required" not in [e["event_type"] for e in flow.replay("/events")]
    if entry == "intent":
        assert result["type"] == "error"
        assert flow.replay()["status"] == "failed"
    else:
        assert result["type"] == "agent_result"
        assert flow.trace()["status"] == "failed"


@pytest.mark.parametrize("entry", ["intent", "chat"])
def test_trusted_context_reaches_actual_model_and_rejects_entity_drift(flow, entry):
    original = "# 第一章\n\n林岚在灯塔港握紧刀，听见潮声逼近。"
    files = []
    for path, kind, excerpt in [
        ("人物/林岚.md", "character", "林岚谨慎寡言，不会主动泄露旧案。"),
        ("设定/灯塔港.md", "setting", "灯塔港终年有潮雾，旧灯塔已经停用。"),
        ("资料/时间线.md", "timeline", "旧灯塔于去年停用。"),
    ]:
        target = flow.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(excerpt, encoding="utf-8")
        files.append(
            {"path": str(target), "relative_path": path, "kind": kind, "title": target.name, "excerpt": excerpt}
        )
    bundle = {
        "project_root": str(flow.root),
        "current_file": str(flow.target),
        "files": files,
        "story_memory": {"items": [{"entity": "林岚", "text": "林岚随身带刀。"}]},
        "chapter_context": {"goal": "林岚在灯塔港等待。"},
    }

    def rename_entity(response):
        return replace(response, content=response.content.replace("林岚", "林蓝"))

    result = flow.send(
        entry,
        original=original,
        context_bundle=bundle,
        transform_response=rename_entity,
        tool_arguments={
            "content": "FORGED",
            "protected_entities": ["FORGED"],
            "required_facts": ["FORGED"],
            "character_constraints": [{"notes": "FORGED"}],
            "continuity_facts": ["FORGED"],
            "context_bundle": {"files": []},
            "llm_context_snapshot": {"kind": "llm_context_snapshot", "context_files": []},
            "use_main_model": True,
            "online_enabled": False,
            "confirmed": True,
        },
    )
    assert len(flow.requests) == 1
    payload = json.loads(flow.requests[0].messages[-1].content)
    constraints = payload["constraints"]
    assert constraints["protected_entities"] == ["林岚", "灯塔港"]
    assert constraints["character_constraints"] == [
        {
            "notes": files[0]["excerpt"],
            "name": "林岚",
            "path": "人物/林岚.md",
        }
    ]
    assert {f["statement"] for f in constraints["continuity_facts"]} == {files[1]["excerpt"], files[2]["excerpt"]}
    assert constraints["required_facts"] == ["林岚随身带刀。", "林岚在灯塔港等待。"]
    assert "FORGED" not in json.dumps(payload, ensure_ascii=False)
    assert result["proposed_patch"] is None
    output = flow.trace()["output_summary"]
    assert output["status"] == "noop"
    assert "protected_entity_changed:林岚" in output["gate_reasons"]["online"]
    assert output["constraint_counts"] == {
        "protected_entities": 2,
        "character_constraints": 1,
        "continuity_facts": 2,
        "required_facts": 2,
    }
    flow.assert_delivery(None)


@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_fixed_after_tool_control_returns_clean_response(flow, monkeypatch, control_type, status):
    execute = ide_router.run_agent_user_message

    def run(*args, on_event, **kwargs):
        def observe(record):
            on_event(record)
            if record.event_type == "tool_trace" and record.payload["trace"]["tool_name"] == "chapter.polish":
                flow.control(control_type)

        return execute(*args, on_event=observe, **kwargs)

    monkeypatch.setattr(ide_router, "run_agent_user_message", run)
    result = flow.send("intent")
    assert len(flow.control_events) == 1
    assert result["proposed_patch"] is None
    assert result["runtime_interruption"]["boundary"] == "after_tool:chapter.polish"
    assert not any(key.startswith("_") for key in result)
    assert flow.replay()["status"] == status
    assert not any(a["kind"] == "proposed_patch" for a in flow.replay("/artifacts"))
    assert not ({"permission_required", "agent_run_completed"} & {e["event_type"] for e in flow.replay("/events")})


@pytest.mark.parametrize("events_recorded", [False, True])
def test_interruption_revokes_delivery_not_brief_or_review_recovery(events_recorded):
    metadata = {
        "confirmation_action": "approve_brief",
        "confirmation_kind": "chapter_brief",
        "chapter_brief": {"title": "下一章"},
        "review_report": {"issues": [{"message": "保留报告"}]},
        "resumed_from_pending_call": True,
        "pending_call_artifact_id": 23,
    }
    result = {
        "agent_result": dict(metadata),
        "proposed_patch": {"id": "late"},
        "_tool_artifacts": [ToolArtifact(kind="proposed_patch", payload={"id": "late"})],
    }
    response = runtime_support.runtime_interrupted_response(
        result,
        {"status": "paused", "boundary": "test"},
        events_recorded=events_recorded,
    )
    assert response is result
    assert response["proposed_patch"] is None
    assert "_tool_artifacts" not in response
    assert response["_runtime_interrupted"] is True
    assert (response.get("_events_recorded") is True) is events_recorded
    for key, value in metadata.items():
        assert response["agent_result"][key] == value
    runtime_support.pop_runtime_internal_markers(response)
    assert not any(key.startswith("_") for key in response)
    json.dumps(response)
