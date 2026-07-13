from __future__ import annotations

from collections.abc import Sequence

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec
from app.domains.agent_runs.tools.specs.bookrun_specs import BOOKRUN_TOOL_SPECS
from app.domains.agent_runs.tools.specs.context_fs_specs import CONTEXT_FS_TOOL_SPECS
from app.domains.agent_runs.tools.specs.hook_specs import HOOK_TOOL_SPECS
from app.domains.agent_runs.tools.specs.patch_specs import PATCH_TOOL_SPECS
from app.domains.agent_runs.tools.specs.project_specs import PROJECT_TOOL_SPECS

_AGENT_RUNTIME_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    *CONTEXT_FS_TOOL_SPECS,
    *PROJECT_TOOL_SPECS,
    *PATCH_TOOL_SPECS,
    *BOOKRUN_TOOL_SPECS,
    *HOOK_TOOL_SPECS,
)

AGENT_RUNTIME_TOOL_SPECS = _AGENT_RUNTIME_TOOL_SPECS

_CONFIRMING_RISK_LEVELS = frozenset({"confirm", "write_pending", "write"})


def list_agent_runtime_tool_specs() -> tuple[AgentRuntimeToolSpec, ...]:
    return _AGENT_RUNTIME_TOOL_SPECS


def confirming_tool_names(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> frozenset[str]:
    """需作者确认的工具名集合（派生 runtime._execute_tool 的放行名单，取代手写第 5 轨）。"""

    source = _AGENT_RUNTIME_TOOL_SPECS if specs is None else specs
    return frozenset(spec.name for spec in source if spec.requires_confirmation)
