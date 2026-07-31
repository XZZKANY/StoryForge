/**
 * Agent 对**这个项目**的权限档位。
 *
 * 为什么按项目存、且存在本机：授权的对象是「这一个项目目录」，不是这台机器上的所有书；
 * 而把「自动落盘」这种授权写进 `.storyforge/` 会随 git 一起传播给克隆的人，所以跟
 * 最近项目、日更账本一样落在 localStorage 里，按项目路径 keyed。
 *
 * 档位的业务后果由 API 判定（见 apps/api 的 permission/policy.py）：补丁能不能免点击落盘，
 * 前端只读补丁上的 `requires_confirmation`，不在这里按档位字符串自己推。这里只做两件事：
 * 存/取作者的选择，以及「只读档不许发起写类动作」这一条本地闸。
 */

import { isReadOnlyDerivedProjectPath } from './project/entry-visibility';

export const AGENT_PERMISSION_PROFILES = ['read', 'ask', 'auto', 'full'] as const;

export type AgentPermissionProfile = (typeof AGENT_PERMISSION_PROFILES)[number];

export const DEFAULT_AGENT_PERMISSION_PROFILE: AgentPermissionProfile = 'ask';

export const AGENT_PERMISSION_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentPermissionProfile;
  label: string;
  hint: string;
}> = [
  { value: 'read', label: '只读', hint: '只读项目、只回答，不产生任何改动' },
  { value: 'ask', label: '询问', hint: '产出改动，但每次都要你在 diff 里点接受' },
  { value: 'auto', label: '自动', hint: '项目内改动直接写盘（写前存快照），长任务仍要确认' },
  { value: 'full', label: '完全放行', hint: '在「自动」之上，连烧 key 的长任务也不再二次确认' },
];

/** 与后端同表：所有历史档位一律落到 ask，迁移绝不把人升级成免点击落盘。 */
const LEGACY_PROFILE_ALIASES: Record<string, AgentPermissionProfile> = {
  risk_confirm: 'ask',
  step_confirm: 'ask',
  autonomous: 'ask',
  full_allow: 'ask',
  autonomous_approval: 'ask',
};

const STORAGE_PREFIX = 'storyforge:agent-permission:';

export function isAgentPermissionProfile(value: unknown): value is AgentPermissionProfile {
  return (
    typeof value === 'string' && AGENT_PERMISSION_PROFILES.includes(value as AgentPermissionProfile)
  );
}

/** 未知或旧值一律回落到默认档，绝不放宽。 */
export function normalizeAgentPermissionProfile(value: unknown): AgentPermissionProfile {
  if (isAgentPermissionProfile(value)) return value;
  if (typeof value === 'string' && LEGACY_PROFILE_ALIASES[value])
    return LEGACY_PROFILE_ALIASES[value];
  return DEFAULT_AGENT_PERMISSION_PROFILE;
}

/** 只读档连发起都不许：Ctrl+K 内联改稿与 Ctrl+Shift+K 续写走的是 /api/assistant/*，没有后端 gate。 */
export function allowsAuthoringActions(profile: AgentPermissionProfile): boolean {
  return profile !== 'read';
}

/**
 * 这个补丁能不能免作者点击直接进写回守卫。
 *
 * 判定源是后端按项目档位算出的 `requiresConfirmation`，这里只做两件不能外包的事：
 * 缺字段就当要确认（失败关闭），以及派生缓存目录永不自动写（写了下次扫描就被覆盖）。
 * 抽成纯函数是为了让「什么情况下会自动落盘」这张表可以被单测证伪。
 */
export function shouldAutoAcceptSuggestion(suggestion: {
  filePath: string;
  requiresConfirmation?: boolean;
}): boolean {
  if (suggestion.requiresConfirmation !== false) return false;
  return !isReadOnlyDerivedProjectPath(suggestion.filePath);
}

function storageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${projectPath}`;
}

export function readAgentPermissionProfile(projectPath: string | null): AgentPermissionProfile {
  if (!projectPath || typeof localStorage === 'undefined') return DEFAULT_AGENT_PERMISSION_PROFILE;
  return normalizeAgentPermissionProfile(localStorage.getItem(storageKey(projectPath)));
}

export function writeAgentPermissionProfile(
  projectPath: string | null,
  profile: AgentPermissionProfile,
): AgentPermissionProfile {
  const normalized = normalizeAgentPermissionProfile(profile);
  if (!projectPath || typeof localStorage === 'undefined') return normalized;
  localStorage.setItem(storageKey(projectPath), normalized);
  return normalized;
}
