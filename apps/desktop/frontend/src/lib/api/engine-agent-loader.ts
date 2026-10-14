import { readEngineMode } from '../engine/flags';

type EngineAgent = typeof import('../engine/agentRoutes');

let loaded: Promise<EngineAgent> | null = null;

/** ts 档才加载引擎（Python 档零初始化）；加载过一次就留着，已有的 ts 档 run 之后仍按归属走引擎。 */
export function engineAgentForNewRun(): Promise<EngineAgent> | null {
  if (readEngineMode('engine.agentLoop') !== 'ts') return null;
  loaded ??= import('../engine/agentRoutes');
  return loaded;
}

/**
 * 这个 run 归引擎管就返回引擎路由，否则走 Python。run 存在引擎库里，重启后仍归引擎：
 * ts 档会先加载引擎再查；Python 档且引擎没加载过就不查（零初始化），引擎的历史 run 这时读不到。
 */
export async function engineAgentOwning(runId: string): Promise<EngineAgent | null> {
  if (loaded === null) {
    if (readEngineMode('engine.agentLoop') !== 'ts') return null;
    loaded = import('../engine/agentRoutes');
  }
  const engine = await loaded;
  return (await engine.ownsRun(runId)) ? engine : null;
}
