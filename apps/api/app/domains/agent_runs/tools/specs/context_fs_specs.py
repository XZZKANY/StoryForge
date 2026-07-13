from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences
from app.domains.agent_runs.tools.spec_roles import CONTEXT_ALLOWED_ROLES as _CONTEXT_ALLOWED_ROLES

CONTEXT_FS_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="context.load",
        description="读取当前文件与上下文摘要。",
        domain="context",
        input_schema={},
        output_schema={},
        allowed_roles=_CONTEXT_ALLOWED_ROLES,
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("file_path", "context_file_count", "context_kinds"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.context_load",)),
    ),
    AgentRuntimeToolSpec(
        name="fs.list",
        description="列出项目目录内文件（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("entry_count", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_list",)),
        loop_schema=LoopToolSchema(
            description="列出项目内文件（递归、相对路径）。可选 subpath 限定子目录。",
            parameters={
                "type": "object",
                "properties": {
                    "subpath": {"type": "string", "description": "限定列出的子目录，相对项目根。"},
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="fs.read",
        description="读取项目内单个文本文件切片（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "returned_chars", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_read",)),
        loop_schema=LoopToolSchema(
            description="读取项目内单个文本文件的内容切片。",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的文件路径。"},
                    "offset": {"type": "integer", "description": "起始字符偏移，默认 0。"},
                    "limit": {"type": "integer", "description": "最多返回字符数，默认 20000。"},
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="fs.search",
        description="在项目文本文件里跨文件检索（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("match_count", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_search",)),
        loop_schema=LoopToolSchema(
            description="在项目文本文件里跨文件检索，返回文件、行号和摘录。",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要检索的文本或正则。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                    "use_regex": {"type": "boolean", "description": "query 是否按正则解释，默认 false。"},
                },
                "required": ["query"],
            },
        ),
    ),
)
