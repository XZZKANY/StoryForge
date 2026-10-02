"""仅独立GUI fixture宿主使用：真实API/runtime，确定性provider，不写手稿。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from contextlib import ExitStack
from pathlib import Path
from threading import Lock
from unittest.mock import patch

API_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = "storyforge-gui-lifecycle-fixture-v1"
AFTER = "雨停了。林舟收起伞，沿着河岸走向灯火。\n"
SCENARIOS = {"audit_close", "manual_wait", "snapshot_kill", "branch_kill", "intent_kill", "body_kill", "audit_done_kill"}


def validate_fixture(data: Path, generation: str) -> Path:
    if not data.is_absolute() or re.fullmatch(r"[a-f0-9]{64}", generation) is None:
        raise ValueError("gui_fixture_identity_invalid")
    data = data.resolve(strict=True)
    raw = (data / "gui-fixture.json").read_bytes()
    manifest = json.loads(raw)
    if len(raw) > 4096 or set(manifest) != {"protocol", "scenario"} or manifest["protocol"] != PROTOCOL:
        raise ValueError("gui_fixture_manifest_invalid")
    if manifest["scenario"] not in SCENARIOS:
        raise ValueError("gui_fixture_manifest_invalid")
    project = data / "project"
    if project.resolve(strict=True) != project or not project.is_dir():
        raise ValueError("gui_fixture_project_outside_isolation")
    return project


def configure_fixture(data: Path, generation: str, stack: ExitStack):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    from app.domains.agent_runs import external_admission, loop_runtime, writeback_projection, writeback_router
    from app.domains.agent_runs.writeback_contracts import AgentCapabilitiesRead
    from app.domains.assistant import service as assistant
    from app.domains.assistant.schemas import AssistantReviseResponse
    from app.main import app as original
    from app.platform.ai_sdk import ChatResponse, MessageRole, StreamEvent, StreamEventKind, ToolCall
    from app.platform.ai_sdk.providers import DeterministicProvider

    project = validate_fixture(data, generation)
    assert external_admission.RELEASE_GATE_PASSED is False
    statistics = data / "gui-provider-stats.json"
    stats = (
        json.loads(statistics.read_text())
        if statistics.exists()
        else {
            "provider_calls": 0,
            "revision_calls": 0,
            "saved_read_observed": False,
        }
    )
    lock = Lock()

    def persist():
        temporary = statistics.with_suffix(".pending")
        temporary.write_text(json.dumps(stats), encoding="utf-8")
        temporary.replace(statistics)

    class FixtureProvider(DeterministicProvider):
        def complete(self, request):
            self.requests.append(request)
            reads = [
                message
                for message in request.messages
                if message.role is MessageRole.TOOL and message.tool_call_id == "read"
            ]
            with lock:
                stats["provider_calls"] += 1
                if reads:
                    stats["saved_read_observed"] = json.loads(reads[-1].content).get("content") == AFTER
                persist()
            if reads:
                return ChatResponse("测试provider已读取实际保存的修订，原运行完成。")
            return ChatResponse(
                "",
                tool_calls=(
                    ToolCall("revise", "file_revise", '{"path":"chapter.md","instruction":"测试整版修订"}'),
                    ToolCall("read", "fs_read", '{"path":"chapter.md"}'),
                ),
            )

        def stream(self, request):
            yield StreamEvent(StreamEventKind.COMPLETED, response=self.complete(request))

    provider = FixtureProvider()

    def revise(session, request):
        with lock:
            stats["revision_calls"] += 1
            persist()
        return AssistantReviseResponse(
            before=request.content,
            after=AFTER,
            summary="独立GUI测试提案",
            model="gui-deterministic-fixture",
            latency_ms=1,
            completion_tokens=3,
            assistant_session_id=request.assistant_session_id,
        )

    def capability():
        return AgentCapabilitiesRead(execution_protocols=["external_writeback_v1"], managed_host_generation=generation)

    for module, name, value in [
        (external_admission, "agent_capabilities", capability),
        (writeback_router, "agent_capabilities", capability),
        (writeback_projection, "agent_capabilities", capability),
        (assistant, "missing_book_generation_env", lambda: []),
        (assistant, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "gui-deterministic-fixture"}),
        (assistant, "revise_file_content", revise),
        (loop_runtime, "build_llm_provider", lambda source: provider),
    ]:
        stack.enter_context(patch.object(module, name, value))
    app = FastAPI(title=original.title, version=original.version, lifespan=original.router.lifespan_context)
    app.router.routes = list(original.router.routes)
    app.user_middleware = list(original.user_middleware)

    @app.middleware("http")
    async def scoped_stream(request: Request, call_next):
        if (
            request.method == "POST"
            and request.url.path.startswith("/api/ide/agent/sessions/")
            and request.url.path.endswith("/stream")
        ):
            body = await request.json()
            selected = (body.get("args") or {}).get("project_path", "")
            if not selected or Path(selected).resolve() != project:
                return JSONResponse(status_code=409, content={"detail": "gui_fixture_project_scope_mismatch"})
        return await call_next(request)

    persist()
    (data / "gui-backend-ready.json").write_text(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "generation": generation,
                "project": str(project),
                "pid": os.getpid(),
            }
        ),
        encoding="utf-8",
    )
    return app


def run():
    if not (
        os.getenv("STORYFORGE_DESKTOP_SMOKE") == "1"
        and os.getenv("STORYFORGE_DESKTOP_SMOKE_LIFECYCLE_ONLY") == "1"
        and os.getenv("STORYFORGE_LLM_CONFIG_MODE") == "desktop-managed-v2"
    ):
        raise ValueError("gui_fixture_requires_isolated_test_host")
    sys.path.insert(0, str(API_ROOT))
    import uvicorn
    from sqlalchemy.engine import make_url

    database = Path(make_url(os.environ["DATABASE_URL"]).database).resolve()
    data = Path(os.environ["STORYFORGE_DESKTOP_SMOKE_LOCAL_DATA_DIR"]).resolve(strict=True)
    if database != data / "storyforge.sqlite3":
        raise ValueError("gui_fixture_database_outside_isolation")
    config = Path(os.environ["STORYFORGE_LLM_CONFIG_FILE"])
    expected = Path(os.environ["STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR"]).resolve(strict=True) / "llm-provider.json"
    if config.resolve(strict=True) != expected:
        raise ValueError("gui_fixture_config_outside_isolation")
    slot = json.loads(config.read_text(encoding="utf-8"))
    if slot.get("apiKey") is not None or any(slot.get(field) for field in ["provider", "baseUrl", "model", "polish"]):
        raise ValueError("gui_fixture_requires_empty_provider_config")
    with ExitStack() as stack:
        app = configure_fixture(data, os.environ["STORYFORGE_MANAGED_HOST_GENERATION"], stack)
        server = uvicorn.Server(
            uvicorn.Config(
                app, host="127.0.0.1", port=int(os.environ["STORYFORGE_API_PORT"]), loop="asyncio", log_level="info"
            )
        )
        asyncio.run(server.serve())


if __name__ == "__main__":
    run()
