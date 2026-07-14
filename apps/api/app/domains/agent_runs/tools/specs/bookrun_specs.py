from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, ToolCatalogReferences
from app.domains.agent_runs.tools.spec_roles import BOOKRUN_ALLOWED_ROLES as _BOOKRUN_ALLOWED_ROLES

BOOKRUN_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="bookrun.start",
        description="启动 managed 写作任务。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        risk_level="long_running",
        retry_safe=False,
        idempotent=False,
        execution_mode="long_running",
        artifact_kinds=("bookrun_checkpoint",),
        evidence_fields=("book_run_id", "writing_run_id", "checkpoint"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.start",),
            workflow_nodes=("agent_runtime.bookrun_start",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.pause",
        description="执行 bookrun.pause 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        risk_level="long_running",
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "status"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.pause",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.resume",
        description="执行 bookrun.resume 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        risk_level="long_running",
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "status"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.resume",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.retry_from_checkpoint",
        description="执行 bookrun.retry_from_checkpoint 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        risk_level="long_running",
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "checkpoint"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.retry_from_checkpoint",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
)
