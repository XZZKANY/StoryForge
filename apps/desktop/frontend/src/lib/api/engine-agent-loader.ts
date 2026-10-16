type EngineAgent = typeof import('../engine/agentRoutes');

let loaded: Promise<EngineAgent> | null = null;

/** agent 循环在进程内的 TS 引擎里跑：引擎包按需加载一次，之后一直复用。 */
export function engineAgent(): Promise<EngineAgent> {
  loaded ??= import('../engine/agentRoutes');
  return loaded;
}
