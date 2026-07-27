from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences
from app.domains.agent_runs.tools.spec_roles import REVIEW_ALLOWED_ROLES as _REVIEW_ALLOWED_ROLES
from app.domains.agent_runs.tools.spec_roles import WRITE_ALLOWED_ROLES as _WRITE_ALLOWED_ROLES

PATCH_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="project.trim_prose",
        description=(
            "压缩修订：按目标压缩率（默认 15%）对单个稿件做结构化压缩，攻击冗余副词、情绪直述、"
            "解释性旁白等过度表达，返回带字数审计报告的待确认补丁。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        risk_level="write_pending",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "original_chars", "compressed_chars", "compression_percent"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_trim_prose",)),
        loop_schema=LoopToolSchema(
            description=(
                "按目标压缩率压缩项目内单个稿件，攻击冗余副词（「他愤怒地说」→「他说」或直接"
                "用动作语气带）、情绪直述（「她感到恐惧」→ 生理反应或环境暗示）、解释性旁白、"
                "冗余重复和啰嗦比喻。保留所有剧情信息、情感高潮、关键动作和对话。"
                "调用前建议先 fs_read 确认内容。每条调用生成待确认补丁，一次对话最多一个补丁。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                    "target_percent": {
                        "type": "integer",
                        "description": "目标压缩百分比，默认 15（即压缩到原字数的 85%）。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="file.review",
        description="执行 chapter_polish 多子代理审稿。",
        domain="review",
        input_schema={},
        output_schema={},
        allowed_roles=_REVIEW_ALLOWED_ROLES,
        risk_level="analyze",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("review_report",),
        required_capabilities=("llm",),
        evidence_fields=("issue_count", "mode", "review_report"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_review",)),
        loop_schema=LoopToolSchema(
            description="对项目内单个稿件做多视角审稿（剧情 / 人物 / 文风 / 连续性），返回带稳定 id 的 issue 列表。",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="file.revise",
        description="生成待确认文件修订补丁。",
        domain="file",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        risk_level="write_pending",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "applied_scope", "scope_warning"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_revise",)),
        loop_schema=LoopToolSchema(
            description=(
                "按明确指示修订项目内单个稿件，生成待作者确认的修订补丁；不会直接写盘。"
                "一次对话最多修订一个文件，修订前建议先 fs_read 或 file_review。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                    "instruction": {"type": "string", "description": "修订指示：要改什么、保留什么。"},
                },
                "required": ["path", "instruction"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="file.create",
        description="为尚不存在的新文件起草初稿，生成待确认新建文件补丁。",
        domain="file",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        risk_level="write_pending",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "content_chars"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_create",)),
        loop_schema=LoopToolSchema(
            description=(
                "为项目内尚不存在的新文件、或作者预先建好的空文件起草完整初稿，"
                "生成待作者确认的新建文件补丁；不会直接写盘。"
                "目标文件已有正文时才会失败（那种情况改用 file_revise）；起草前建议先读大纲 / 设定 / 相邻章节。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的新文件路径（含目录与 .md 扩展名）。"},
                    "instruction": {"type": "string", "description": "写作指令：写什么、篇幅、衔接哪些既有内容。"},
                },
                "required": ["path", "instruction"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="prose.continue",
        description="在作者光标处接着往下写一段，生成待确认的插入补丁（不改动既有正文）。",
        domain="prose",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        risk_level="write_pending",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "inserted_chars", "anchor_line"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.prose_continue",)),
        loop_schema=LoopToolSchema(
            description=(
                "在作者光标处接着往下写一段正文，生成待作者确认的插入补丁；既有正文一字不改，"
                "也不会直接写盘。作者说「接着写」「往下写一段」「继续」时用这把工具，"
                "不要用 file_revise（那会重写整篇）。落点缺省用作者当前光标位置——"
                "系统已把作者的光标与选区注入本轮对话，通常无需自己指定 anchor_line。"
                "一次只写一个自然段到一个小节拍，不收尾、不总结、不甩悬念收束句。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                    "instruction": {
                        "type": "string",
                        "description": "对这一段的额外要求（可省略，省略即「就接着写」）。",
                    },
                    "target_chars": {
                        "type": "integer",
                        "description": "这一段的目标中文字符数，80–1200，缺省 300。",
                    },
                    "anchor_line": {
                        "type": "integer",
                        "description": "1-based 落点行（在该行之后插入）；缺省用作者当前光标行。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="judge.run",
        description="对生成内容执行轻量检查。",
        domain="judge",
        input_schema={},
        output_schema={},
        allowed_roles=_REVIEW_ALLOWED_ROLES,
        risk_level="analyze",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        evidence_fields=("issue_count", "mode"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.judge_run",)),
    ),
    AgentRuntimeToolSpec(
        name="judge.repair",
        description="通过 IDE command registry 生成 Judge 修复。",
        domain="judge",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        risk_level="write_pending",
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        evidence_fields=("repair_patch", "audit_event_id"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/judge.repair",),
            workflow_nodes=("agent_runtime.judge_repair",),
        ),
    ),
)
