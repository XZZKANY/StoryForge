from __future__ import annotations

from dataclasses import replace
from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.domains.agent_runs.adapters import (
    MANAGED_BOOKRUN_COMMAND_IDS,
    FixedPipelineRequest,
    run_fixed_intent_pipeline,
)
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.tools import list_agent_runtime_tool_specs


class _RecordingFixedRuntime:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def _record(self, name: str) -> dict[str, str]:
        self.calls.append(name)
        return {"handler": name}

    def run_file_review_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("file.review")

    def run_chapter_polish_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("file.revise")

    def run_bookrun_generation_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("bookrun.start")

    def run_chapter_review_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("chapter.review")

    def run_chapter_repair_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("chapter.repair")


def _request(intent: str) -> FixedPipelineRequest:
    return FixedPipelineRequest(
        session=cast(Session, object()),
        run=cast(AgentRun, object()),
        agent_session_id="session-1",
        assistant_session_id=1,
        user_message="测试",
        args={},
        intent=intent,
    )


def test_fixed_intent_adapter_routes_every_explicit_pipeline() -> None:
    runtime = _RecordingFixedRuntime()
    request = _request("file.review")

    # bookrun.start 已于 2026-08-01 摘除入口（作者拍板退役批量整书）。
    for intent in ("file.review", "file.revise", "chapter.review", "chapter.repair"):
        result = run_fixed_intent_pipeline(runtime, replace(request, intent=intent))
        assert result == {"handler": intent}

    assert runtime.calls == ["file.review", "file.revise", "chapter.review", "chapter.repair"]

    with pytest.raises(AgentOrchestrationError, match="暂不支持的 Agent intent"):
        run_fixed_intent_pipeline(runtime, replace(request, intent="bookrun.start"))


def test_fixed_intent_adapter_rejects_unknown_intent() -> None:
    with pytest.raises(AgentOrchestrationError, match="暂不支持的 Agent intent"):
        run_fixed_intent_pipeline(_RecordingFixedRuntime(), _request("unknown.intent"))


def test_bookrun_tools_stay_unregistered() -> None:
    """bookrun.* 桌面入口已摘除（2026-08-01 作者拍板退役批量整书）。

    只摘登记不删实现：MANAGED_BOOKRUN_COMMAND_IDS 与 adapter、book_runs service/REST 全留着，
    回滚 = 恢复 catalog 的 *BOOKRUN_TOOL_SPECS 与 runtime_tools 的 handlers.update。
    """

    declared = tuple(spec.name for spec in list_agent_runtime_tool_specs() if spec.name.startswith("bookrun."))

    assert declared == (), f"bookrun 工具又被登记回来了：{declared}"
    assert MANAGED_BOOKRUN_COMMAND_IDS, "adapter 实现应保留（只摘入口不删码）"
