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


def test_chat_loop_file_create_drafts_new_file_patch_without_touching_disk(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 file.create：为不存在的新文件起草待确认补丁，盘上不落文件、run 暂停等确认。"""

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
    calls = _fake_llm_script(
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
                            "arguments": json.dumps(
                                {"path": "正文/第02章.md", "instruction": "写第二章，衔接第一章灯塔异常"}
                            ),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "第二章初稿已起草，等你确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-create",
        project_path=str(novel_project),
        message="帮我写第二章",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["kind"] == "file_revision"
    assert patch["created_by_tool"] == "file.create"
    assert patch["before"] == ""
    assert "灯塔之下" in patch["after"]
    assert patch["file_path"] == str((novel_project / "正文" / "第02章.md").resolve())
    assert patch["requires_confirmation"] is True
    assert result["agent_result"]["requires_user_confirmation"] is True

    # 写回红线：确认前盘上不落新文件
    assert not (novel_project / "正文" / "第02章.md").exists()

    # 补丁生成后：后续轮 file_create / file_revise 一并撤下
    round2_tools = [item["function"]["name"] for item in calls[1]["tools"]]
    assert "file_create" not in round2_tools
    assert "file_revise" not in round2_tools
    assert "fs_read" in round2_tools

    # 权限事件标记来源工具；run 暂停等确认
    events = client.get("/api/agent-runs/run-chat-loop-create/events").json()
    permission_event = next(event for event in events if event["event_type"] == "permission_required")
    assert permission_event["payload"]["blocked_tool"] == "file.create"
    run = client.get("/api/agent-runs/run-chat-loop-create").json()
    assert run["status"] == "paused"

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    tool_names = [item["tool_name"] for item in tool_calls]
    assert "file.create" in tool_names
    assert "assistant.draft" in tool_names


def test_chat_loop_file_create_rejects_existing_path(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """file_create 指向已存在文件时拒绝为观测反馈，模型可改走 file_revise。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
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
                            "arguments": json.dumps({"path": "正文/第01章.md", "instruction": "重写第一章"}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "这个文件已经存在，我改用修订流程。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-create-exists",
        project_path=str(novel_project),
        message="新建第一章",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["proposed_patch"] is None
    assert [trace["status"] for trace in result["tool_trace"]] == ["failed"]
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert "文件已存在" in str(tool_messages[0]["content"])


def test_chat_loop_project_consistency_feeds_observations(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 project.consistency：一次调用返回词条分布（含缺席）观察信号并落证据链。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_consistency",
                            "arguments": json.dumps({"terms": ["林岚", "裴砚"]}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "林岚有出场记录，裴砚全书未出现。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-consistency",
        project_path=str(novel_project),
        message="帮我查一下林岚和裴砚的称谓一致性",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "林岚有出场记录，裴砚全书未出现。"
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["project.consistency"]
    trace = result["tool_trace"][0]
    assert trace["status"] == "completed"
    assert trace["output_summary"]["scanned_files"] == 2
    assert trace["output_summary"]["term_count"] == 2

    # 观察信号原样喂回模型：含缺席词条标记与时间/重复区块
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert "林岚" in feedback
    assert '"missing": true' in feedback
    assert "time_markers" in feedback
    assert "repeated_clauses" in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.consistency" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_prose_check_feeds_static_smells(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 project.prose_check：确定性文笔气味 issue 喂回模型并落证据链（无 LLM 判定）。"""

    _enable_loop_env(monkeypatch)
    (novel_project / "正文" / "第02章.md").write_text(
        "她不禁停下，心中五味杂陈。她非常害怕，也十分绝望。", encoding="utf-8"
    )
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_prose_check",
                            "arguments": json.dumps({"path": "正文/第02章.md"}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "第二章有套话和情绪直述，建议改成动作呈现。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-prose",
        project_path=str(novel_project),
        message="帮我看看第二章文笔有什么问题",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["project.prose_check"]
    trace = result["tool_trace"][0]
    assert trace["status"] == "completed"
    assert trace["output_summary"]["path"] == "正文/第02章.md"
    assert trace["output_summary"]["issue_count"] >= 2

    # 确定性 issue 原样喂回模型：含维度名与坏味道条目
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert "套话" in feedback
    assert "说明腔" in feedback
    assert "dimension_counts" in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.prose_check" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_collapse_check_feeds_summary_only(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 project.collapse_check：完整 verdict 留证据，短 summary 回灌模型。"""

    _enable_loop_env(monkeypatch)
    (novel_project / "正文" / "第02章.md").write_text(
        "他来到档案室，询问管理员，翻看登记表，把证据收进口袋后离开。",
        encoding="utf-8",
    )
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_collapse_check",
                            "arguments": json.dumps(
                                {
                                    "path": "正文/第02章.md",
                                    "beats": ["到场", "取证", "保存", "转场"],
                                    "irreversible_consequence": "",
                                }
                            ),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "第二章有过场风险，建议补入不可逆变化。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-collapse",
        project_path=str(novel_project),
        message="帮我判断第二章是不是过场戏",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.collapse_check"
    assert trace["output_summary"]["verdict"] == "warn"
    assert trace["output_summary"]["issue_count"] >= 3

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert "process_only" in feedback
    assert '"summary"' in feedback
    assert '"issues"' not in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.collapse_check" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_entity_budget_check_feeds_summary_only(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 entity_budget_check：完整 verdict 留证据，短 summary 回灌模型。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_entity_budget_check",
                            "arguments": json.dumps(
                                {
                                    "path": "正文/第01章.md",
                                    "chapter": 20,
                                    "new_core_locations": ["旧港"],
                                }
                            ),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "本章在后期引入了新核心地点，建议核实必要性。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-entity-budget",
        project_path=str(novel_project),
        message="看看第一章新增实体有没有突破预算",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.entity_budget_check"
    assert trace["output_summary"] == {
        "path": "正文/第01章.md",
        "chapter": 20,
        "verdict": "warn",
        "issue_count": 1,
    }

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert '"summary"' in feedback
    assert '"issues"' not in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.entity_budget_check" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_promise_check_feeds_summary_only_without_writing_canon(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 promise_check：完整 issues 留证据，模型只收 summary，作者 canon 不变。"""

    _enable_loop_env(monkeypatch)
    canon_dir = novel_project / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    canon_file = canon_dir / "canon.json"
    canon_file.write_text(
        json.dumps(
            {
                "version": 1,
                "entities": [],
                "invariants": {
                    "promises": [
                        {
                            "id": "signal-lamp",
                            "title": "信号灯伏笔",
                            "kind": "foreshadow",
                            "planted_chapter": 1,
                            "due_chapter": 1,
                            "status": "planted",
                        }
                    ]
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    before = canon_file.read_bytes()
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_promise_check",
                            "arguments": json.dumps({"stale_after_chapters": 30}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "信号灯承诺已经超窗，请核实是否需要推进。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-promise-check",
        project_path=str(novel_project),
        message="检查项目里的伏笔承诺账本",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.promise_check"
    assert trace["output_summary"] == {
        "current_chapter": 2,
        "promise_count": 1,
        "conflict_count": 0,
        "advisory_count": 1,
    }

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert '"summary"' in feedback
    assert '"conflicts"' not in feedback
    assert '"advisories"' not in feedback
    assert canon_file.read_bytes() == before
    assert not (canon_dir / "derived").exists()

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.promise_check" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_canon_delta_feeds_summary_only(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 project.canon_delta：完整提案留证据，短 summary 回灌模型。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_canon_delta",
                            "arguments": json.dumps(
                                {
                                    "entities": [
                                        {"name": "新客", "aliases": ["黑衣人"]},
                                    ]
                                }
                            ),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "已生成一个新实体提案，等待作者审阅。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-canon-delta",
        project_path=str(novel_project),
        message="把第一章的新人物整理成设定提案",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.canon_delta"
    assert trace["output_summary"] == {
        "new_entity_count": 1,
        "known_entity_count": 0,
        "alias_conflict_count": 0,
        "new_conflict_count": 0,
        "new_advisory_count": 0,
    }

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert '"summary"' in feedback
    assert '"proposals"' not in feedback
    assert '"new_entities"' not in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.canon_delta" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_deep_consistency_feeds_semantic_issues(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 project.deep_consistency：语义 judge issue 信号喂回模型并落证据链。"""

    from app.domains.agent_runs import deep_consistency
    from app.domains.judge.types import DetectedIssue, SemanticJudgeOutcome

    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(deep_consistency, "resolved_llm_env", lambda env=None: {"STORYFORGE_LLM_API_KEY": "k"})
    monkeypatch.setattr(
        deep_consistency,
        "semantic_judge_with_status",
        lambda payload, *, provider=None, character_voice_constraints=None, llm_env=None: SemanticJudgeOutcome(
            issues=[
                DetectedIssue(
                    category="setting_conflict",
                    severity="high",
                    span_start=0,
                    span_end=2,
                    summary="正文与设定矛盾：灯塔闪光次数与设定不符。",
                    recommended_repair_mode="replace_span",
                    expected_text="第三十二次",
                    replacement_text="第三十二次",
                    matched_text="灯塔",
                )
            ],
            failed=False,
        ),
    )
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_deep_consistency",
                            "arguments": json.dumps({"path": "正文/第01章.md", "facts": ["灯塔第三十二次闪光"]}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "第一章与设定存在一处冲突，已定位到闪光次数。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-deep-consistency",
        project_path=str(novel_project),
        message="帮我深查第一章有没有违背设定的地方",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "第一章与设定存在一处冲突，已定位到闪光次数。"
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["project.deep_consistency"]
    trace = result["tool_trace"][0]
    assert trace["status"] == "completed"
    assert trace["output_summary"] == {"path": "正文/第01章.md", "issue_count": 1, "bible_file_count": 1}

    # 语义 issue 信号原样喂回模型：类别 / 行号 / 参考信号提示
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    feedback = str(tool_messages[0]["content"])
    assert "setting_conflict" in feedback
    assert "line_start" in feedback
    assert "参考信号" in feedback

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.deep_consistency" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_deep_consistency_unconfigured_llm_feeds_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """语义评审未配置 LLM 时以工具错误反馈给模型，不伪造「无问题」也不中断循环。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_deep_consistency",
                            "arguments": json.dumps({"path": "正文/第01章.md"}),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "语义评审没配置模型，这轮先用人工抽查代替。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-deep-consistency-nokey",
        project_path=str(novel_project),
        message="深查第一章一致性",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.deep_consistency"
    assert trace["status"] == "failed"
    assert "未配置 LLM" in trace["error_message"]

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert "未配置 LLM" in str(tool_messages[0]["content"])
