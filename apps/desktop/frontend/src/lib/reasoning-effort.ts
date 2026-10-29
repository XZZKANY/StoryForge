/**
 * 作者给**这个项目**选的思考等级（对话、起草、修订、Ctrl+K、续写都按它）。
 *
 * 跟权限档位一样按项目存在本机 localStorage、不写进 `.storyforge/`：这是作者对自己这台机器
 * 花钱方式的选择，不该随 git 传给克隆的人。默认「关」= 不传任何思考参数，按模型默认。
 */

export const REASONING_EFFORTS = ['off', 'low', 'medium', 'high'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'off';

export const REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: ReasoningEffort;
  label: string;
  hint?: string;
}> = [
  { value: 'off', label: '关', hint: '不传思考参数，按模型默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const STORAGE_PREFIX = 'storyforge:reasoning-effort:';

/** 不认识的值一律当「关」：宁可不思考，也不替作者多花钱。 */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

export function readReasoningEffort(projectPath: string | null): ReasoningEffort {
  if (!projectPath || typeof localStorage === 'undefined') return DEFAULT_REASONING_EFFORT;
  return normalizeReasoningEffort(localStorage.getItem(`${STORAGE_PREFIX}${projectPath}`));
}

export function writeReasoningEffort(
  projectPath: string | null,
  effort: ReasoningEffort,
): ReasoningEffort {
  const normalized = normalizeReasoningEffort(effort);
  if (!projectPath || typeof localStorage === 'undefined') return normalized;
  localStorage.setItem(`${STORAGE_PREFIX}${projectPath}`, normalized);
  return normalized;
}

let boundProject: string | null = null;

/**
 * 引擎每次取模型配置时读「当前项目」的等级。当前项目由持有它的 hook 在渲染期同步绑定：
 * 换项目后那一帧里发出的调用也不会用上一个项目的等级。
 */
export function bindReasoningEffortProject(projectPath: string | null): void {
  boundProject = projectPath;
}

/** 写进配置源的值：「关」是空串，压过进程环境变量里的 STORYFORGE_LLM_REASONING_EFFORT。 */
export function currentReasoningEffortSourceValue(): string {
  const effort = readReasoningEffort(boundProject);
  return effort === 'off' ? '' : effort;
}
