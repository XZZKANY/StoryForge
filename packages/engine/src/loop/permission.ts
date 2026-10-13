import { pythonStrip } from '../kernel/pythonText';

/**
 * 权限档位到阶段 / 工具裁决的唯一事实源（read / ask / auto / full）。
 *
 * auto / full 放宽的只有「作者点击」这一层闸；项目目录边界、派生只读目录与写前快照
 * 在任何档位都不放宽，写回仍由 Desktop 逐次执行。
 */

export type PermissionProfile = 'read' | 'ask' | 'auto' | 'full';
export type PermissionStage = 'explore' | 'brief' | 'draft' | 'proposed_patch' | 'writeback';
export type PermissionDecision = {
  status: 'allow' | 'require_approval' | 'deny';
  reason: string;
  /** true 只表示可以先生成待确认 artifact，绝不表示允许直接写回作者文件。 */
  allows_pending_artifact: boolean;
};

export const CANONICAL_PERMISSION_PROFILES: readonly PermissionProfile[] = [
  'read',
  'ask',
  'auto',
  'full',
];
export const DEFAULT_PERMISSION_PROFILE: PermissionProfile = 'ask';
/** 所有历史档位一律迁到 ask：迁移绝不把任何人升级成免点击落盘。 */
export const LEGACY_PERMISSION_PROFILE_ALIASES: Readonly<Record<string, PermissionProfile>> = {
  risk_confirm: 'ask',
  step_confirm: 'ask',
  autonomous: 'ask',
  full_allow: 'ask',
  autonomous_approval: 'ask',
};
const STAGES = new Set(['explore', 'brief', 'draft', 'proposed_patch', 'writeback']);

export class PermissionProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionProfileError';
  }
}

const decision = (
  status: PermissionDecision['status'],
  reason: string,
  allowsPendingArtifact = false,
): PermissionDecision => ({ status, reason, allows_pending_artifact: allowsPendingArtifact });

export function normalizePermissionProfile(
  value: unknown,
  allowMissing = true,
): { profile: PermissionProfile; migrated_from: string | null } {
  if (value === null || value === undefined) {
    if (allowMissing) return { profile: DEFAULT_PERMISSION_PROFILE, migrated_from: null };
    throw new PermissionProfileError('缺少 Agent 权限档位。');
  }
  if (typeof value !== 'string') throw new PermissionProfileError('Agent 权限档位必须是字符串。');
  const profile = pythonStrip(value);
  if (!profile) {
    if (allowMissing) return { profile: DEFAULT_PERMISSION_PROFILE, migrated_from: null };
    throw new PermissionProfileError('缺少 Agent 权限档位。');
  }
  if ((CANONICAL_PERMISSION_PROFILES as readonly string[]).includes(profile))
    return { profile: profile as PermissionProfile, migrated_from: null };
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_PERMISSION_PROFILE_ALIASES, profile)
    ? LEGACY_PERMISSION_PROFILE_ALIASES[profile]
    : undefined;
  if (legacy) return { profile: legacy, migrated_from: profile };
  throw new PermissionProfileError(`不支持的 Agent 权限档位：${profile}。`);
}

/** 给历史记录投影可安全读取的档位；请求入口仍用 normalize 显式拒绝未知值。 */
export function canonicalPermissionProfile(
  value: unknown,
  fallback: unknown = null,
): PermissionProfile {
  for (const candidate of [value, fallback]) {
    try {
      return normalizePermissionProfile(candidate, false).profile;
    } catch (error) {
      if (!(error instanceof PermissionProfileError)) throw error;
    }
  }
  return DEFAULT_PERMISSION_PROFILE;
}

export function decideStage(profile: unknown, stage: string): PermissionDecision {
  const canonical = normalizePermissionProfile(profile, false).profile;
  if (!STAGES.has(stage)) throw new PermissionProfileError(`不支持的 Agent 权限阶段：${stage}。`);
  if (canonical === 'read') {
    if (stage === 'explore' || stage === 'brief')
      return decision('allow', 'read_observation_stage');
    return decision('deny', 'read_profile_blocks_non_observation_stage');
  }
  if (stage !== 'writeback') return decision('allow', `${canonical}_${stage}`);
  if (canonical === 'auto' || canonical === 'full')
    return decision('allow', `${canonical}_workspace_writeback`);
  return decision('require_approval', 'final_diff_confirmation');
}

/** 补丁落盘前要不要作者点一次「接受」：Desktop 只读这一位，不自己按档位字符串推。 */
export function patchRequiresConfirmation(profile: unknown): boolean {
  return decideStage(canonicalPermissionProfile(profile), 'writeback').status !== 'allow';
}

export type ToolRisk = { risk_level: string; execution_mode: string };

export function decideTool(
  profile: unknown,
  tool: ToolRisk,
  payload: { readonly [key: string]: unknown } | null = null,
): PermissionDecision {
  const canonical = normalizePermissionProfile(profile, false).profile;
  const risk = tool.risk_level;
  if (risk === 'read' || risk === 'analyze') return decideStage(canonical, 'explore');
  if (canonical === 'read') return decision('deny', `read_profile_blocks_${risk}`);
  if (risk === 'write_pending') {
    const stage = decideStage(canonical, 'draft');
    if (stage.status !== 'require_approval') return stage;
    return decision('require_approval', stage.reason, true);
  }
  if (risk === 'long_running') {
    if (tool.execution_mode === 'control')
      return decision('allow', `${canonical}_managed_run_control`);
    if (canonical === 'full') return decision('allow', 'full_profile_allows_long_running');
    if (payload !== null && payload.confirmed === true)
      return decision('allow', `${canonical}_confirmed_long_running`);
    return decision('require_approval', `${canonical}:${risk}`);
  }
  // 未知风险类别没有 Desktop diff 入口，不能因为档位放宽就静默执行。
  return decision('require_approval', `${canonical}:${risk}`);
}

/** 把 run 已快照的档位应用到工具风险；历史脏档位一律拒绝，不落入放行。 */
export function gateDecide(
  runProfile: unknown,
  tool: ToolRisk,
  payload: { readonly [key: string]: unknown } | null = null,
): PermissionDecision {
  let profile: PermissionProfile;
  try {
    profile = normalizePermissionProfile(runProfile, false).profile;
  } catch (error) {
    if (!(error instanceof PermissionProfileError)) throw error;
    return decision('deny', 'invalid_permission_profile');
  }
  return decideTool(profile, tool, payload);
}
