const flagKeys = ['engine.ideCommands', 'engine.assistant', 'engine.agentLoop'] as const;

export type EngineFlagKey = (typeof flagKeys)[number];
export type EngineMode = 'python' | 'ts' | 'shadow';

export function readEngineMode(key: EngineFlagKey): EngineMode {
  if (!import.meta.env.DEV || !flagKeys.includes(key)) return 'python';

  // Storage can be denied by the WebView. Only the experimental preference
  // degrades to Python; failures after engine admission must not retry there.
  try {
    const mode = localStorage.getItem(key);
    return mode === 'ts' || mode === 'shadow' ? mode : 'python';
  } catch {
    return 'python';
  }
}
