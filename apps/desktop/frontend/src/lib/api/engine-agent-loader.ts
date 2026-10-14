import { readEngineMode } from '../engine/flags';

type EngineAgent = typeof import('../engine/agentRoutes');

let loaded: Promise<EngineAgent> | null = null;

/** ts 档才加载引擎（Python 档零初始化）；加载过一次就留着，已有的 ts 档 run 之后仍按归属走引擎。 */
export function engineAgentForNewRun(): Promise<EngineAgent> | null {
  if (readEngineMode('engine.agentLoop') !== 'ts') return null;
  loaded ??= import('../engine/agentRoutes');
  return loaded;
}

/** 这个 run 归引擎管就返回引擎路由；引擎没加载过、或不认识这个 run，都走 Python。 */
export async function engineAgentOwning(runId: string): Promise<EngineAgent | null> {
  if (loaded === null) return null;
  const engine = await loaded;
  return (await engine.ownsRun(runId)) ? engine : null;
}
