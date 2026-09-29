"""StoryForge live chat adapter over the internal AI SDK runtime."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from typing import Any

from sqlalchemy.orm import Session

from app.common.llm_client import (
    LLMConfigError,
    LLMError,
    build_llm_provider,
    resolved_llm_model,
)
from app.common.llm_control import LLMRunInterrupted, llm_run_control
from app.common.llm_observation import model_operation
from app.domains.agent_runs.book_context import build_book_context_block
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.loop import prompt_context as loop_prompt_context
from app.domains.agent_runs.loop.author_view import (
    AuthorView,
    build_author_view_block,
    build_pinned_context_block,
)
from app.domains.agent_runs.loop.run_control import (
    RUN_MAX_DURATION_SECONDS,
    build_run_control,
    current_run_control,
    finish_interrupted_run,
)
from app.domains.agent_runs.loop.sdk_adapters import (
    StoryForgeCheckpointStore,
    StoryForgeFeedbackFormatter,
    StoryForgeProviderAdapter,
    StoryForgeRuntimePolicy,
    StoryForgeRunTracer,
    StoryForgeToolSelector,
    StoryForgeUsageSink,
    build_storyforge_tool_registry,
    interruption_check,
)
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.loop.support import history_messages
from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.permission import PermissionGate
from app.domains.agent_runs.request_evidence import RequestEvidenceError
from app.domains.agent_runs.serial_plan import build_plan_block
from app.domains.agent_runs.tools import (
    ToolDefinition,
    ToolResult,
    build_loop_tool_name_map,
    build_loop_tool_schemas,
    llm_tool_name,
    loop_patch_tool_specs,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.platform.ai_sdk.contracts import messages_from_openai
from app.platform.ai_sdk.runtime import (
    ResumeAction,
    ResumeCommand,
    RuntimeLimits,
    RuntimeResultStatus,
    ToolCallingRuntime,
)

_AUTHOR_INSTRUCTIONS_MAX_CHARS = loop_prompt_context.AUTHOR_INSTRUCTIONS_MAX_CHARS
_AUTHOR_INSTRUCTIONS_PREFIX = loop_prompt_context.AUTHOR_INSTRUCTIONS_PREFIX
_SYSTEM_PROMPT = loop_prompt_context.SYSTEM_PROMPT
_read_author_instructions = loop_prompt_context.read_author_instructions

_LLM_ERRORS = (LLMError, LLMConfigError)
LOOP_MAX_ROUNDS = 8
LOOP_MAX_DURATION_SECONDS = RUN_MAX_DURATION_SECONDS
LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000

_TOOLS_WITHDRAWN_NOTICE = "工具已不再可用，请直接用自然语言回答作者，不要再输出任何工具调用格式。"
_FINAL_ROUND_NOTICE = f"已到本轮对话的工具调用上限。{_TOOLS_WITHDRAWN_NOTICE}"

_TOOL_MARKUP_MARKERS = ("DSML", "<tool_call", "invoke name=", "<function_call")
_UNEXECUTED_TOOL_MARKUP_NOTICE = (
    "（这轮模型把工具调用写成了正文、并没有真正执行，所以文件没有任何改动。"
    "下面是它原样吐出的内容，供你判断；要落盘请再说一次目标文件和要求。）\n\n"
)


def _annotate_unexecuted_tool_markup(content: str) -> str:
    if content and any(marker in content for marker in _TOOL_MARKUP_MARKERS):
        return _UNEXECUTED_TOOL_MARKUP_NOTICE + content
    return content


_TOOL_NAME_MAP = build_loop_tool_name_map()
_PATCH_TOOLS = tuple(spec.name for spec in loop_patch_tool_specs())
_PATCH_TOOL_LLM_NAMES = tuple(llm_tool_name(spec.name) for spec in loop_patch_tool_specs())
LOOP_TOOL_SCHEMAS: list[dict[str, Any]] = build_loop_tool_schemas()


class ChatLoopUnavailableError(RuntimeError):
    """The first provider call failed, so the caller should use single-turn chat."""


def run_chat_loop(
    session: Session,
    *,
    run: AgentRun,
    permission_gate: PermissionGate,
    tool_definitions: Sequence[ToolDefinition],
    llm_env: dict[str, str | None],
    assistant_session_id: int,
    user_message: str,
    project_path: str,
    current_file: str | None,
    execute_fs_tool: Callable[[str, dict[str, Any]], ToolResult],
    on_trace: Callable[[AgentToolTrace], None],
    should_interrupt: Callable[[str], dict[str, Any] | None] | None = None,
    author_view: AuthorView | None = None,
    pinned_context: str | None = None,
    recovery_message: dict[str, Any] | None = None,
) -> ChatLoopOutcome:
    """Assemble StoryForge context and delegate generic orchestration to the SDK."""

    provenance: dict[str, Any] = {}
    messages = messages_from_openai(
        _storyforge_messages(
            session,
            assistant_session_id=assistant_session_id,
            user_message=user_message,
            project_path=project_path,
            current_file=current_file,
            author_view=author_view,
            pinned_context=pinned_context,
            provenance=provenance,
        )
    )
    outcome = ChatLoopOutcome(answer="")
    context = StoryForgeRuntimeContext(
        session=session,
        assistant_session_id=assistant_session_id,
        run=run,
        source=llm_env,
        permission_gate=permission_gate,
        definitions={definition.name: definition for definition in tool_definitions},
        execute_tool=execute_fs_tool,
        on_trace=on_trace,
        outcome=outcome,
        should_interrupt=should_interrupt,
        recovery_message=recovery_message or {"intent": "chat.explain", "user_message": user_message,
            "assistant_session_id": assistant_session_id, "args": {"project_path": project_path, "file_path": current_file}},
    )
    try:
        provider = StoryForgeProviderAdapter(build_llm_provider(llm_env), context)
        model = resolved_llm_model(llm_env)
    except _LLM_ERRORS as exc:
        raise ChatLoopUnavailableError(str(exc)) from exc

    owner = current_run_control()
    context.call_control = (
        owner.control if owner is not None
        else build_run_control(context, duration_seconds=LOOP_MAX_DURATION_SECONDS)
    )
    checkpoint_store = StoryForgeCheckpointStore(context)
    resume_state = checkpoint_store.load(run.public_id) if run.current_step == "resumed" else None
    runtime = ToolCallingRuntime(
        provider,
        build_storyforge_tool_registry(context),
        policy=StoryForgeRuntimePolicy(context),
        selector=StoryForgeToolSelector(),
        tracer=StoryForgeRunTracer(context),
        usage_sink=StoryForgeUsageSink(context),
        checkpoints=checkpoint_store,
        interruption=interruption_check(context),
        feedback_formatter=StoryForgeFeedbackFormatter(),
    )
    try:
        with llm_run_control(context.call_control), model_operation("agent.loop", provenance=provenance):
            result = runtime.run(
                messages,
                model=model,
                run_id=run.public_id,
                limits=RuntimeLimits(
                    max_rounds=LOOP_MAX_ROUNDS,
                    max_tool_calls=32,
                    max_tool_output_chars=LOOP_TOOL_OUTPUT_BUDGET_CHARS,
                    final_message=_FINAL_ROUND_NOTICE,
                ),
                application_context=context,
                resume_state=resume_state,
                resume_command=ResumeCommand(ResumeAction.CONTINUE) if resume_state else None,
            )
    except LLMRunInterrupted as exc:
        return finish_interrupted_run(context, exc.reason)
    except RequestEvidenceError:
        outcome.mark_failed("request_evidence_failed", "模型请求证据提交失败，结果需要核对，未交付本次模型结果。")
        outcome.exhausted = True
        outcome.rounds = context.provider_attempts
        return outcome
    except _LLM_ERRORS:
        outcome.mark_failed("provider_error", "模型调用失败。")
        outcome.exhausted = True
        outcome.rounds = context.provider_attempts
        return outcome

    outcome.rounds = context.provider_attempts
    if result.status is RuntimeResultStatus.COMPLETED:
        outcome.answer = _annotate_unexecuted_tool_markup(result.content)
        return outcome
    if result.status is RuntimeResultStatus.INTERRUPTED:
        reason = result.checkpoint.interruption_reason if result.checkpoint else None
        return finish_interrupted_run(context, reason or "interrupted")
    if (
        result.status is RuntimeResultStatus.FAILED
        and result.error_code == "provider_unsupported"
        and context.completed_model_rounds == 0
    ):
        raise ChatLoopUnavailableError(result.error_message or "模型调用不可用。")
    if result.status is RuntimeResultStatus.FAILED:
        outcome.mark_failed(result.error_code or "runtime_failed", result.error_message or "未知错误")
        outcome.exhausted = True
        return outcome
    outcome.mark_failed("runtime_unsettled", result.error_message or "本轮没有完成，不能自动继续。")
    outcome.exhausted = True
    return outcome


def _storyforge_messages(
    session: Session,
    *,
    assistant_session_id: int,
    user_message: str,
    project_path: str,
    current_file: str | None,
    author_view: AuthorView | None,
    pinned_context: str | None,
    provenance: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    current_file_hint = f"当前打开文件：{current_file}" if current_file else "当前没有打开文件"
    book_block = build_book_context_block(project_path, current_file)
    plan_block = build_plan_block(project_path)
    scene_block = build_scene_constraint_block(project_path, current_file)
    author_instructions = _read_author_instructions(project_path)
    view_block = build_author_view_block(author_view) if author_view is not None else None
    pinned_block = build_pinned_context_block(pinned_context)
    parts = [
        ("system_prompt", [{"role": "system", "content": _SYSTEM_PROMPT}]),
        ("author_instructions", [{"role": "system", "content": _AUTHOR_INSTRUCTIONS_PREFIX + author_instructions}]
         if author_instructions else []),
        ("book_context", [{"role": "system", "content": book_block}] if book_block else []),
        ("serial_plan", [{"role": "system", "content": plan_block}] if plan_block else []),
        ("scene_constraints", [{"role": "system", "content": scene_block}] if scene_block else []),
        ("conversation_history", history_messages(session, assistant_session_id)),
        ("pinned_context", [{"role": "system", "content": pinned_block}] if pinned_block else []),
        ("author_view", [{"role": "system", "content": view_block}] if view_block else []),
        ("current_user", [{"role": "user", "content":
                           f"[项目已挂载，只读工具可用。{current_file_hint}]\n作者：{user_message}"}]),
    ]
    messages = []
    sections = []
    for name, entries in parts:
        indices = list(range(len(messages), len(messages) + len(entries)))
        messages.extend(entries)
        sections.append({
            "section": name, "message_indices": indices,
            "sha256": hashlib.sha256(json.dumps(entries, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
            "omission_reason": None if entries else "context_builder_returned_empty",
        })
    if provenance is not None:
        provenance.update({"projection_version": 1, "assistant_session_id": assistant_session_id,
                           "sections": sections, "current_file": current_file,
                           "source_basis": "compiled_context_not_current_disk_verification"})
    return messages
