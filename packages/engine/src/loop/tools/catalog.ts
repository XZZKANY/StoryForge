import type { JsonObject } from '../../kernel/json';
import { deriveRequiresConfirmation, type AgentRuntimeToolSpec } from './specModels';
import { CHAPTER_WRITING_TOOL_SPECS } from './specs/chapter';
import { CONTEXT_FS_TOOL_SPECS } from './specs/contextFs';
import { HOOK_TOOL_SPECS } from './specs/hook';
import { PATCH_TOOL_SPECS } from './specs/patch';
import { PROJECT_CANON_TOOL_SPECS } from './specs/projectCanon';
import { PROJECT_CONSISTENCY_TOOL_SPECS } from './specs/projectConsistency';
import { QUALITY_AND_PLAN_TOOL_SPECS } from './specs/projectQuality';
import { SKILL_TOOL_SPECS } from './specs/skill';

/** 全部 agent 工具；顺序即注册顺序、模型看到的工具顺序（除 skill.read 外与 Python catalog 同）。 */
export const AGENT_RUNTIME_TOOL_SPECS: readonly AgentRuntimeToolSpec[] = [
  ...CONTEXT_FS_TOOL_SPECS,
  ...SKILL_TOOL_SPECS,
  ...PROJECT_CONSISTENCY_TOOL_SPECS,
  ...PROJECT_CANON_TOOL_SPECS,
  ...QUALITY_AND_PLAN_TOOL_SPECS,
  ...CHAPTER_WRITING_TOOL_SPECS,
  ...PATCH_TOOL_SPECS,
  ...HOOK_TOOL_SPECS,
];

export const requiresConfirmation = (spec: AgentRuntimeToolSpec) =>
  deriveRequiresConfirmation(spec.risk_level, spec.execution_mode);

/** 需作者确认的工具名集合。 */
export const confirmingToolNames = (specs = AGENT_RUNTIME_TOOL_SPECS): Set<string> =>
  new Set(specs.filter(requiresConfirmation).map((spec) => spec.name));

/** dotted 注册名 → function 名（function 名不允许点号）。 */
export const llmToolName = (specName: string) => specName.split('.').join('_');

/** 进 chat 循环、对模型可见的工具（带 loop_schema），按声明顺序。 */
export const listLoopToolSpecs = (specs = AGENT_RUNTIME_TOOL_SPECS) =>
  specs.filter((spec) => spec.loop_schema !== null);

/** chat 循环的 OpenAI function schema 列表，从 spec 单点派生。 */
export const buildLoopToolSchemas = (specs = AGENT_RUNTIME_TOOL_SPECS): JsonObject[] =>
  listLoopToolSpecs(specs).map((spec) => ({
    type: 'function',
    function: {
      name: llmToolName(spec.name),
      description: spec.loop_schema!.description,
      parameters: { ...spec.loop_schema!.parameters },
    },
  }));

/** function 名 → dotted 注册名。 */
export const buildLoopToolNameMap = (specs = AGENT_RUNTIME_TOOL_SPECS): Map<string, string> =>
  new Map(listLoopToolSpecs(specs).map((spec) => [llmToolName(spec.name), spec.name]));

/** 循环内会产出待确认补丁的工具：每一轮（作者发一句话）最多一个补丁，生成后撤下。 */
export const loopPatchToolSpecs = (specs = AGENT_RUNTIME_TOOL_SPECS) =>
  listLoopToolSpecs(specs).filter((spec) => spec.risk_level === 'write_pending');
