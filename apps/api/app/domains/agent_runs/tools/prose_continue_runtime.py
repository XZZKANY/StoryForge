"""prose.continue：在作者光标处接着往下写一段，产出待确认的插入补丁。

为什么单开一个模块：此前 16 个循环工具里只有 3 个产字（file.revise / file.create /
project.trim_prose），全是「改已有」或「起草新文件」——agent 是审校 agent，不是写作
agent。这把工具补的是「按需续写」：作者开口才写，不抢焦点（宪法 §06.03 的立场是起草时
编辑器保持安静，那约束的是主动插嘴，不是按需生成）。

红线不变：只产出 proposed_patch，写盘由作者在界面确认后走前端守卫写回。
落点计算与插入都是确定性纯函数（assistant/continuation.py），LLM 只负责那一段文字。
"""

from __future__ import annotations

import uuid
from typing import Any

from app.domains.agent_runs import fs_tools
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.loop.author_view import AuthorView
from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.tools.execution import ToolArtifact, ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import optional_int as _optional_int
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import continuation
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantContinueRequest

_TARGET_CHARS_MIN = 80
_TARGET_CHARS_MAX = 1200


class ProseContinueRuntimeMixin:
    def _prose_continue_tool_handlers(self) -> dict[str, ToolHandler]:
        return {"prose.continue": self._prose_continue}

    def _prose_continue(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = payload.get("content")
        if not isinstance(content, str):
            raise fs_tools.FsToolError("缺少稿件正文，无法续写。")

        target_chars = _optional_int(payload.get("target_chars"))
        if target_chars is not None and not (_TARGET_CHARS_MIN <= target_chars <= _TARGET_CHARS_MAX):
            raise fs_tools.FsToolError(f"target_chars 必须在 {_TARGET_CHARS_MIN}–{_TARGET_CHARS_MAX} 之间。")

        cursor_line = self._prose_continue_cursor_line(context, payload, content)
        anchor_line = continuation.resolve_anchor_line(content, cursor_line)

        try:
            response = assistant_service.draft_continuation(
                context.session,
                AssistantContinueRequest(
                    file_path=file_path,
                    content=content,
                    cursor_line=anchor_line,
                    instruction=_optional_string(payload.get("instruction")),
                    project_root=_optional_string(payload.get("project_root")),
                    project_name=_optional_string(payload.get("project_name")),
                    assistant_session_id=context.assistant_session_id,
                    target_chars=target_chars,
                ),
            )
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            assistant_service.AssistantSessionNotFoundError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc

        after = continuation.insert_at_anchor(content, anchor_line, response.content)
        inserted_chars = len(response.content)
        proposed_patch = {
            "id": f"prose-continue-{uuid.uuid4().hex}",
            "kind": "prose_continue",
            "file_path": file_path,
            "before": content,
            "after": after,
            "continue_audit": {
                "anchor_line": anchor_line,
                "cursor_line": cursor_line,
                "inserted_chars": inserted_chars,
            },
            "requires_confirmation": True,
            "approval_action": "desktop.confirm_file_writeback",
        }

        summary = f"已在第 {anchor_line} 行之后续写约 {inserted_chars} 字，等你确认后才会写盘。"
        output = {
            "file_path": file_path,
            "before": content,
            "after": after,
            "summary": summary,
            "model": response.model,
            "latency_ms": response.latency_ms,
            "completion_tokens": response.completion_tokens,
            "assistant_session_id": response.assistant_session_id,
            "anchor_line": anchor_line,
            "inserted_chars": inserted_chars,
            "proposed_patch": proposed_patch,
        }
        return ToolResult(
            status="completed",
            output=output,
            summary=summary,
            payload={"proposed_patch": proposed_patch},
            artifacts=(ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=True),),
            metrics={
                "inserted_chars": inserted_chars,
                "completion_tokens": response.completion_tokens,
                "latency_ms": response.latency_ms,
            },
            patch_proposal=PatchProposal.from_payload(proposed_patch),
            trace=AgentToolTrace(
                tool_name="prose.continue",
                status="completed",
                input_summary={"file_path": file_path, "anchor_line": anchor_line, "target_chars": target_chars},
                output_summary={"inserted_chars": inserted_chars, "anchor_line": anchor_line},
            ),
        )

    @staticmethod
    def _prose_continue_cursor_line(
        context: ToolExecutionContext,
        payload: dict[str, Any],
        content: str,
    ) -> int:
        """落点优先级：模型显式 anchor_line > 作者当前光标 > 文件末尾。

        模型多数时候不该指定 anchor_line——作者的光标才是「接着写」的真落点，且它已随
        author_view 注入本轮对话。缺两者时落文件末尾（作者在空文件里说「开始写」的场景）。
        """

        explicit = _optional_int(payload.get("anchor_line"))
        if explicit is not None and explicit > 0:
            return explicit
        view = AuthorView.from_payload(context.args)
        if view.cursor_line > 0:
            return view.cursor_line
        return len(content.replace("\r\n", "\n").split("\n"))
