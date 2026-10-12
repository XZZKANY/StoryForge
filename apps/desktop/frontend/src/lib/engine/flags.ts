const flagKeys = ['engine.ideCommands', 'engine.assistant', 'engine.agentLoop'] as const;

export type EngineFlagKey = (typeof flagKeys)[number];
export type EngineMode = 'python' | 'ts' | 'shadow';

// 开发档没设偏好时走哪边，随迁移阶段推进（迁移计划 §4.1）；发行版一律 Python，等 P5 再切。
const devDefaults: Record<EngineFlagKey, EngineMode> = {
  'engine.ideCommands': 'python',
  'engine.assistant': 'ts',
  'engine.agentLoop': 'python',
};

export function readEngineMode(key: EngineFlagKey): EngineMode {
  if (!import.meta.env.DEV || !flagKeys.includes(key)) return 'python';

  // Storage can be denied by the WebView. Only the preference lookup degrades to the
  // stage default; failures after engine admission must not retry on the other side.
  try {
    const mode = localStorage.getItem(key);
    return mode === 'python' || mode === 'ts' || mode === 'shadow' ? mode : devDefaults[key];
  } catch {
    return devDefaults[key];
  }
}
