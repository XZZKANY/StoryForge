from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

if TYPE_CHECKING:
    from app.domains.agent_runs.models import AgentRun
    from app.domains.agent_runs.tools.execution import ToolDefinition


PermissionProfile = Literal["read", "step_confirm", "risk_confirm", "autonomous"]
PermissionStage = Literal["explore", "brief", "draft", "proposed_patch", "writeback"]
PermissionDecisionStatus = Literal["allow", "require_approval", "deny"]

CANONICAL_PERMISSION_PROFILES: tuple[PermissionProfile, ...] = (
    "read",
    "step_confirm",
    "risk_confirm",
    "autonomous",
)
DEFAULT_PERMISSION_PROFILE: PermissionProfile = "risk_confirm"
LEGACY_PERMISSION_PROFILE_ALIASES: dict[str, PermissionProfile] = {
    "full_allow": "autonomous",
    "autonomous_approval": "autonomous",
}
_PERMISSION_STAGES = frozenset({"explore", "brief", "draft", "proposed_patch", "writeback"})


class PermissionProfileError(ValueError):
    """作者选择或历史记录中的权限档位无法安全解析。"""


@dataclass(frozen=True)
class NormalizedPermissionProfile:
    profile: PermissionProfile
    migrated_from: str | None = None


@dataclass(frozen=True)
class PermissionDecision:
    status: PermissionDecisionStatus
    reason: str
    # `True` 仅表示可以先生成待确认 artifact；绝不表示允许直接写回作者文件。
    allows_pending_artifact: bool = False


def normalize_permission_profile(
    value: object,
    *,
    allow_missing: bool = True,
) -> NormalizedPermissionProfile:
    """把请求/历史 profile 收敛到单一 canonical 词表。

    legacy alias 只在这里兼容。所有新建或恢复后的 AgentRun、事件和实时帧都保存 canonical 值，
    从而避免 Desktop、route、lifecycle 和 gate 分别维护字符串分支。
    """

    if value is None:
        if allow_missing:
            return NormalizedPermissionProfile(DEFAULT_PERMISSION_PROFILE)
        raise PermissionProfileError("缺少 Agent 权限档位。")
    if not isinstance(value, str):
        raise PermissionProfileError("Agent 权限档位必须是字符串。")

    profile = value.strip()
    if not profile:
        if allow_missing:
            return NormalizedPermissionProfile(DEFAULT_PERMISSION_PROFILE)
        raise PermissionProfileError("缺少 Agent 权限档位。")
    if profile in CANONICAL_PERMISSION_PROFILES:
        return NormalizedPermissionProfile(cast(PermissionProfile, profile))
    legacy_profile = LEGACY_PERMISSION_PROFILE_ALIASES.get(profile)
    if legacy_profile is not None:
        return NormalizedPermissionProfile(legacy_profile, migrated_from=profile)
    raise PermissionProfileError(f"不支持的 Agent 权限档位：{profile}。")


def canonical_permission_profile(
    value: object,
    *,
    fallback: object | None = None,
) -> PermissionProfile:
    """为持久 evidence 投影可安全读取的 canonical profile。

    请求入口仍使用 ``normalize_permission_profile(..., allow_missing=False)`` 显式拒绝未知值；
    这里仅服务于已经存在的历史记录，避免脏数据把事件编码或后台收尾流程再次打断。
    """

    for candidate in (value, fallback):
        try:
            return normalize_permission_profile(candidate, allow_missing=False).profile
        except PermissionProfileError:
            continue
    return DEFAULT_PERMISSION_PROFILE


class PermissionPolicy:
    """权限档位到阶段/工具裁决的唯一业务事实源。"""

    def decide_stage(
        self,
        profile: PermissionProfile | str,
        stage: PermissionStage | str,
        *,
        artifact_kind: str | None = None,
    ) -> PermissionDecision:
        del artifact_kind  # 后续 Chapter Writing Module 可用 artifact kind 细化阶段策略。
        canonical_profile = normalize_permission_profile(profile, allow_missing=False).profile
        if stage not in _PERMISSION_STAGES:
            raise PermissionProfileError(f"不支持的 Agent 权限阶段：{stage}。")
        canonical_stage = cast(PermissionStage, stage)

        if canonical_profile == "read":
            if canonical_stage in {"explore", "brief"}:
                return PermissionDecision("allow", "read_observation_stage")
            return PermissionDecision("deny", "read_profile_blocks_non_observation_stage")

        if canonical_profile == "step_confirm":
            if canonical_stage == "explore":
                return PermissionDecision("allow", "step_confirm_explore")
            if canonical_stage == "brief":
                return PermissionDecision("require_approval", "step_confirm_brief")
            if canonical_stage == "draft":
                return PermissionDecision("require_approval", "step_confirm_requires_stage_grant")
            return PermissionDecision("require_approval", "final_diff_confirmation")

        if canonical_stage in {"explore", "brief", "draft"}:
            return PermissionDecision("allow", f"{canonical_profile}_{canonical_stage}")
        return PermissionDecision("require_approval", "final_diff_confirmation")

    def decide_tool(
        self,
        profile: PermissionProfile | str,
        tool: ToolDefinition,
        *,
        payload: dict[str, Any] | None = None,
    ) -> PermissionDecision:
        canonical_profile = normalize_permission_profile(profile, allow_missing=False).profile
        risk_level = tool.risk_level

        if risk_level in {"read", "analyze"}:
            return self.decide_stage(canonical_profile, "explore")

        if canonical_profile == "read":
            return PermissionDecision("deny", f"read_profile_blocks_{risk_level}")

        if risk_level == "write_pending":
            stage_decision = self.decide_stage(canonical_profile, "draft")
            if stage_decision.status != "require_approval":
                return stage_decision
            return PermissionDecision(
                "require_approval",
                stage_decision.reason,
                allows_pending_artifact=canonical_profile in {"risk_confirm", "autonomous"},
            )

        if risk_level == "long_running":
            if tool.execution_mode == "control":
                return PermissionDecision("allow", f"{canonical_profile}_managed_run_control")
            if isinstance(payload, dict) and payload.get("confirmed") is True:
                return PermissionDecision("allow", f"{canonical_profile}_confirmed_long_running")
            return PermissionDecision("require_approval", f"{canonical_profile}:{risk_level}")

        # 长任务启动和所有非白名单的风险类别没有 Desktop diff seam，不能因自治档位而静默执行。
        return PermissionDecision("require_approval", f"{canonical_profile}:{risk_level}")


class PermissionGate:
    """把 AgentRun 的已快照 profile 应用到 ToolSpec 派生的工具风险。"""

    def __init__(self, policy: PermissionPolicy | None = None) -> None:
        self._policy = policy or PermissionPolicy()

    def decide(
        self,
        run: AgentRun,
        tool: ToolDefinition,
        *,
        payload: dict[str, Any] | None = None,
    ) -> PermissionDecision:
        try:
            profile = normalize_permission_profile(run.permission_profile, allow_missing=False).profile
        except PermissionProfileError:
            # 历史脏数据也不能落入旧的 allow fallthrough。
            return PermissionDecision("deny", "invalid_permission_profile")
        return self._policy.decide_tool(profile, tool, payload=payload)
