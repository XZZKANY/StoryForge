from __future__ import annotations

from app.domains.agent_runs.events.contracts import CompletedEventPayload, FailedEventPayload
from app.domains.agent_runs.loop.types import LoopRoundResult
from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.tools import ToolResult
from app.domains.agent_runs.trace import AgentToolTrace


def test_loop_round_result_decodes_provider_payload_once() -> None:
    tool_calls = [{"id": "call-1", "function": {"name": "fs_read", "arguments": '{"path":"a.md"}'}}]
    result = LoopRoundResult.from_payload(
        {
            "content": "完成",
            "tool_calls": tool_calls,
            "completion_tokens": 3,
            "prompt_tokens": 5,
            "token_usage": 8,
            "token_usage_source": "provider",
            "cost_cny_estimated": 0.12,
            "cost_breakdown": {"total_cny": 0.12},
        }
    )

    assert result.content == "完成"
    assert result.tool_calls is tool_calls
    assert result.completion_tokens == 3
    assert result.prompt_tokens == 5
    assert result.token_usage == 8
    assert result.cost_cny_estimated == 0.12


def test_patch_proposal_preserves_wire_payload_with_typed_fields() -> None:
    payload = {
        "id": "file-revision-1",
        "kind": "file_revision",
        "file_path": "正文/第01章.md",
        "before": "旧",
        "after": "新",
        "requires_confirmation": True,
        "approval_action": "desktop.confirm_file_writeback",
    }

    proposal = PatchProposal.from_payload(payload)

    assert proposal.patch_id == "file-revision-1"
    assert proposal.created_by_tool == "file.revise"
    assert proposal.requires_confirmation is True
    assert proposal.to_payload() == payload


def test_tool_result_carries_typed_patch_proposal() -> None:
    proposal = PatchProposal.from_payload({"kind": "repair_patch", "requires_confirmation": True})
    result = ToolResult(
        status="completed",
        output={"ok": True},
        trace=AgentToolTrace(tool_name="judge.repair", status="completed", input_summary={}),
        patch_proposal=proposal,
    )

    assert result.patch_proposal is proposal


def test_completed_terminal_payload_preserves_existing_wire_shape() -> None:
    payload = CompletedEventPayload.from_result(
        {
            "intent": "chat.explain",
            "assistant_session_id": 7,
            "proposed_patch": {"id": "patch-1", "created_by_tool": "file.create", "file_path": "新章.md"},
        },
        {
            "summary": "完成",
            "requires_user_confirmation": True,
            "review_report": {},
            "chat_loop": {"rounds": 2, "tool_call_count": 1},
        },
    ).to_payload()

    assert payload == {
        "intent": "chat.explain",
        "assistant_session_id": 7,
        "requires_user_confirmation": True,
        "summary": "完成",
        "has_proposed_patch": True,
        "has_review_report": True,
        "proposed_patch": {"id": "patch-1", "created_by_tool": "file.create", "file_path": "新章.md"},
        "chat_loop": {"rounds": 2, "tool_call_count": 1},
    }


def test_failed_terminal_payload_preserves_existing_wire_shape() -> None:
    raw = {"reason": "process_restart", "run_id": "run-1", "extra": {"attempt": 2}}
    payload = FailedEventPayload.from_payload(raw)

    assert payload.reason == "process_restart"
    assert payload.run_id == "run-1"
    assert payload.to_payload() == raw
