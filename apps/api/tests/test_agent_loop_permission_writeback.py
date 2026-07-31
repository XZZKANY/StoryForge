from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)
from fastapi.testclient import TestClient

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.mark.parametrize(
    ("profile", "requires_confirmation"),
    [("ask", True), ("auto", False)],
)
def test_chat_loop_patch_confirmation_follows_the_project_permission_profile(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
    profile: str,
    requires_confirmation: bool,
) -> None:
    """自动档只放宽「作者点接受」这一层：补丁上的确认位翻转、run 不再挂起等确认。

    后端红线不变——两档下磁盘都不动，落盘仍然只由前端守卫执行。
    """

    from app.domains.assistant import service as assistant_service

    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "第二章 灯塔之下\n\n林岚带着记录仪回到了灯塔。",
            "completion_tokens": 9,
            "latency_ms": 5,
        },
    )
    # 产字三条路径走流式聚合传输：同一个假函数同时挡住两个符号。
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", assistant_service._call_llm)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps({"path": "正文/第02章.md", "instruction": "写第二章"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "第二章初稿已起草。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id=f"run-chat-loop-profile-{profile}",
        project_path=str(novel_project),
        message="帮我写第二章",
        permission_profile=profile,
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["proposed_patch"]["requires_confirmation"] is requires_confirmation
    assert result["agent_result"]["requires_user_confirmation"] is requires_confirmation

    # 后端写回红线在任何档位都不放宽：确认位只影响 Desktop 要不要等作者点击。
    assert not (novel_project / "正文" / "第02章.md").exists()
