import { AGENT_RUNTIME_TOOL_SPECS } from './catalog';
import { canonToolHandlers } from './canonHandlers';
import { chapterWritingToolHandlers } from './chapterWritingTools';
import { checkToolHandlers } from './checkHandlers';
import { deepConsistencyToolHandlers } from './deepConsistency';
import { AgentToolRegistry, toolDefinitionFromSpec, type ToolHandler } from './execution';
import { fsToolHandlers } from './fsHandlers';
import type { ToolDeps } from './handlerDeps';
import { patchToolHandlers } from './patchHandlers';
import { polishToolHandlers } from './polishHandlers';
import { skillToolHandlers } from './skillHandlers';

/** 29 个工具声明各配上处理器（Python 的 agent 层注册表加 skill.read）；依赖在这里一次绑定。 */
export function createAgentToolRegistry(deps: ToolDeps): AgentToolRegistry {
  const handlers: Record<string, ToolHandler> = {
    ...fsToolHandlers(deps),
    ...skillToolHandlers(deps),
    ...checkToolHandlers(deps),
    ...canonToolHandlers(deps),
    ...patchToolHandlers(deps),
    ...polishToolHandlers(deps),
    ...deepConsistencyToolHandlers(deps),
    ...chapterWritingToolHandlers(deps),
  };
  const registry = new AgentToolRegistry();
  for (const spec of AGENT_RUNTIME_TOOL_SPECS) {
    const handler = handlers[spec.name];
    if (!handler) throw new Error(`工具 ${spec.name} 没有处理器`);
    registry.register(toolDefinitionFromSpec(spec, handler));
  }
  return registry;
}
