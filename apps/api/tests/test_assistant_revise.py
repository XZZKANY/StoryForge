from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.domains.assistant import service as assistant_service
from app.domains.book_runs.book_generation import BookGenerationError


def test_revise_returns_diff_and_records_tool_call(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """正常修订：返回 before/after，并把会话 + assistant.revise(completed) 落库。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - 测试桩
        assert "修订指令" in user_prompt
        return {"content": "林岚冲进雾气弥漫的港口，脚步声被浪涛吞没。", "completion_tokens": 42, "latency_ms": 123}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "mimo-v2.5-pro")

    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "draft.md",
            "content": "林岚走进港口。",
            "instruction": "加强画面感与紧张氛围",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["before"] == "林岚走进港口。"
    assert data["after"] != data["before"]
    assert data["after"].strip()
    assert data["model"] == "mimo-v2.5-pro"
    assert data["completion_tokens"] == 42

    session_id = data["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert len(tool_calls) == 1
    assert tool_calls[0]["tool_name"] == "assistant.revise"
    assert tool_calls[0]["status"] == "completed"


def test_revise_includes_desktop_context_bundle_in_prompt(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """桌面 IDE 传入的项目上下文摘录要进入 revise prompt，并记录上下文文件数。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured: dict[str, str] = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - 测试桩
        captured["user_prompt"] = user_prompt
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文/第02章.md",
            "content": "当前正文",
            "instruction": "检查人物动机",
            "context_bundle": {
                "project_root": "D:/books/雾港回声",
                "current_file": "D:/books/雾港回声/正文/第02章.md",
                "files": [
                    {
                        "path": "D:/books/雾港回声/人物/周眠.md",
                        "relative_path": "人物/周眠.md",
                        "kind": "character",
                        "title": "周眠.md",
                        "excerpt": "周眠怕水，但必须回到雾港。",
                    },
                    {
                        "path": "D:/books/雾港回声/大纲/第02章节点.md",
                        "relative_path": "大纲/第02章节点.md",
                        "kind": "outline",
                        "title": "第02章节点.md",
                        "excerpt": "本章要揭示旧电台。",
                    },
                ],
                "summary": {"hasStoryStructure": True, "counts": {"character": 1, "outline": 1}},
            },
        },
    )

    assert response.status_code == 200, response.text
    assert "项目上下文摘录" in captured["user_prompt"]
    assert "人物/周眠.md" in captured["user_prompt"]
    assert "周眠怕水" in captured["user_prompt"]

    session_id = response.json()["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert tool_calls[0]["input_summary"]["context_file_count"] == 2


def test_revise_returns_422_when_llm_not_configured(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM 环境缺失时明确返回 422，不伪造兜底。"""

    monkeypatch.setattr(
        assistant_service,
        "missing_book_generation_env",
        lambda: ["STORYFORGE_LLM_API_KEY"],
    )

    response = client.post(
        "/api/assistant/revise",
        json={"file_path": "draft.md", "content": "正文", "instruction": "改写"},
    )
    assert response.status_code == 422, response.text
    assert "STORYFORGE_LLM_API_KEY" in response.json()["detail"]


def test_revise_returns_502_and_marks_tool_call_failed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """真实 LLM 调用失败时返回 502，并把 tool-call 置为 failed。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def boom(source, *, system_prompt, user_prompt):  # noqa: ANN001 - 测试桩
        raise BookGenerationError("真实 LLM 返回 HTTP 500（耗时 1200ms）：upstream error")

    monkeypatch.setattr(assistant_service, "_call_llm", boom)

    response = client.post(
        "/api/assistant/revise",
        json={"file_path": "draft.md", "content": "正文", "instruction": "改写"},
    )
    assert response.status_code == 502, response.text
    assert "HTTP 500" in response.json()["detail"]

    # 失败也要留痕：找到刚创建的会话，其 tool-call 应为 failed。
    recent = client.get("/api/assistant/sessions").json()
    session_id = recent[0]["id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert tool_calls[-1]["tool_name"] == "assistant.revise"
    assert tool_calls[-1]["status"] == "failed"
    assert "HTTP 500" in tool_calls[-1]["error_message"]
