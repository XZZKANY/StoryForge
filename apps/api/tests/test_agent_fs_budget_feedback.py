from __future__ import annotations

import json

from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def test_file_budget_error_reaches_model_as_failed_tool(client, monkeypatch, novel_project) -> None:
    _enable_loop_env(monkeypatch)
    (novel_project / "large.md").write_bytes(b"a" * (2 * 1024 * 1024 + 1))
    calls = _fake_llm_script(monkeypatch, [
        {"content": "", "tool_calls": [{"id": "budget-read", "type": "function", "function": {
            "name": "fs_read", "arguments": json.dumps({"path": "large.md"}),
        }}]},
        {"content": "文件超过读取预算，未完成读取。", "tool_calls": []},
    ])
    _send_chat_message(client, run_id="fs-budget-feedback", project_path=str(novel_project), message="读取 large.md")
    assert len(calls) == 2
    feedback = [item for item in calls[-1]["messages"] if item.get("role") == "tool"]
    assert len(feedback) == 1
    payload = json.loads(feedback[0]["content"])
    assert "超过完整读取预算" in payload["error"]
