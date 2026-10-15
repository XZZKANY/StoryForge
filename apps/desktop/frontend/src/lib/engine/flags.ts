const flagKeys = ['engine.ideCommands', 'engine.assistant', 'engine.agentLoop'] as const;

export type EngineFlagKey = (typeof flagKeys)[number];
export type EngineMode = 'python' | 'ts' | 'shadow';

const allModes: readonly EngineMode[] = ['python', 'ts', 'shadow'];

// 开发档没设偏好时走哪边，随迁移阶段推进（迁移计划 §4.1）。
const devDefaults: Record<EngineFlagKey, EngineMode> = {
  'engine.ideCommands': 'python',
  'engine.assistant': 'ts',
  'engine.agentLoop': 'python',
};

// 发行版（P5-1 预览版起）：修订 / 续写与 agent 循环默认影子档——结果仍用 Python，引擎在后台比对；
// 作者可在设置里关掉（切回 Python）。ts 档要等 P5-2 才对发行版开放，IDE 命令还没接引擎。
const releaseModes: Record<EngineFlagKey, readonly EngineMode[]> = {
  'engine.ideCommands': ['python'],
  'engine.assistant': ['shadow', 'python'],
  'engine.agentLoop': ['shadow', 'python'],
};

const isFlagKey = (key: string): key is EngineFlagKey =>
  (flagKeys as readonly string[]).includes(key);

/** 这一档构建里这个开关能选哪些档位（第一个是默认）。 */
export function engineModeChoices(key: EngineFlagKey): readonly EngineMode[] {
  if (!import.meta.env.DEV) return releaseModes[key];
  return [devDefaults[key], ...allModes.filter((mode) => mode !== devDefaults[key])];
}

export function readEngineMode(key: EngineFlagKey): EngineMode {
  if (!isFlagKey(key)) return 'python';
  const choices = engineModeChoices(key);
  // Storage can be denied by the WebView. Only the preference lookup degrades to the
  // stage default; failures after engine admission must not retry on the other side.
  try {
    const mode = localStorage.getItem(key);
    return choices.find((choice) => choice === mode) ?? choices[0];
  } catch {
    return choices[0];
  }
}

/** 记下作者的选择；这一档构建不允许的档位不写。存储被拒时返回 false。 */
export function writeEngineMode(key: EngineFlagKey, mode: EngineMode): boolean {
  if (!isFlagKey(key) || !engineModeChoices(key).includes(mode)) return false;
  try {
    localStorage.setItem(key, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * 引擎库打开时把旧库导进来（P4-3）。作者拍板只在 P5 切默认时做一次：在那之前 Python 档还在往旧库写，
 * 提前导入会过期（导完就不再读旧库）。发行版恒为关；开发档要显式设 `engine.legacyImport` 为 `on`。
 */
export function legacyImportOnOpen(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem('engine.legacyImport') === 'on';
  } catch {
    return false;
  }
}

/** 会话放哪个库跟着 agent 循环的开关走：左栏、agent 循环、Ctrl+K / 续写记的会话都在同一个库。 */
export const sessionsInEngine = (): boolean => readEngineMode('engine.agentLoop') === 'ts';
