from __future__ import annotations

from typing import Final

AGENT_RUN_STARTED: Final = "agent_run_started"
AGENT_PLAN_CREATED: Final = "agent_plan_created"
SUBAGENT_STARTED: Final = "subagent_started"
SUBAGENT_COMPLETED: Final = "subagent_completed"
TOOL_TRACE: Final = "tool_trace"
PERMISSION_REQUIRED: Final = "permission_required"
AGENT_ARTIFACT: Final = "agent_artifact"
AGENT_RUN_COMPLETED: Final = "agent_run_completed"
AGENT_RUN_FAILED: Final = "agent_run_failed"
SYSTEM_JOB: Final = "system_job"

PERMISSION_APPROVED: Final = "permission_approved"
PERMISSION_DENIED: Final = "permission_denied"
PAUSE_RUN: Final = "pause_run"
RESUME_RUN: Final = "resume_run"
STOP_RUN: Final = "stop_run"
RETRY_FROM_CHECKPOINT: Final = "retry_from_checkpoint"

APPROVE_PERMISSION_COMMAND: Final = "approve_permission"
DENY_PERMISSION_COMMAND: Final = "deny_permission"

AGENT_RUN_EVENT_TYPES: Final = frozenset(
    {
        AGENT_RUN_STARTED,
        AGENT_PLAN_CREATED,
        SUBAGENT_STARTED,
        SUBAGENT_COMPLETED,
        TOOL_TRACE,
        PERMISSION_REQUIRED,
        AGENT_ARTIFACT,
        AGENT_RUN_COMPLETED,
        AGENT_RUN_FAILED,
        SYSTEM_JOB,
        PERMISSION_APPROVED,
        PERMISSION_DENIED,
        PAUSE_RUN,
        RESUME_RUN,
        STOP_RUN,
        RETRY_FROM_CHECKPOINT,
    }
)

CONTROL_MESSAGE_TYPES: Final = frozenset(
    {
        APPROVE_PERMISSION_COMMAND,
        DENY_PERMISSION_COMMAND,
        PAUSE_RUN,
        RESUME_RUN,
        STOP_RUN,
        RETRY_FROM_CHECKPOINT,
    }
)

CONTROL_MESSAGE_EVENT_TYPES: Final = frozenset(
    {
        PERMISSION_APPROVED,
        PERMISSION_DENIED,
        PAUSE_RUN,
        RESUME_RUN,
        STOP_RUN,
        RETRY_FROM_CHECKPOINT,
    }
)

_CONTROL_MESSAGE_TO_EVENT_TYPE: Final = {
    APPROVE_PERMISSION_COMMAND: PERMISSION_APPROVED,
    DENY_PERMISSION_COMMAND: PERMISSION_DENIED,
}


def event_type_for_control_message(control_type: str) -> str:
    return _CONTROL_MESSAGE_TO_EVENT_TYPE.get(control_type, control_type)
