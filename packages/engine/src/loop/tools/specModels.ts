import type { JsonObject } from '../../kernel/json';

export type LoopInputMode = 'project' | 'existing_file' | 'new_file';
export type LoopTraceOwner = 'generic' | 'handler';

/** chat 循环暴露给模型的 function 描述与参数 schema；没有它的工具只走固定管线。 */
export type LoopToolSchema = { readonly description: string; readonly parameters: JsonObject };

export type ToolCatalogReferences = {
  readonly page_refs: readonly string[];
  readonly api_paths: readonly string[];
  readonly workflow_nodes: readonly string[];
};

export type AgentRuntimeToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly input_schema: JsonObject;
  readonly output_schema: JsonObject;
  readonly allowed_roles: readonly string[];
  readonly risk_level: string;
  readonly retry_safe: boolean;
  readonly idempotent: boolean;
  readonly execution_mode: string;
  readonly artifact_kinds: readonly string[];
  readonly required_capabilities: readonly string[];
  readonly evidence_fields: readonly string[];
  readonly references: ToolCatalogReferences;
  readonly loop_schema: LoopToolSchema | null;
  /** 以下三项只给循环适配器用，与风险 / 权限无关，不暴露给模型。 */
  readonly loop_input_mode: LoopInputMode;
  readonly loop_trusted_context: boolean;
  readonly loop_trace_owner: LoopTraceOwner;
};

export const REVIEWER_ROLES = [
  'plot_reviewer',
  'character_reviewer',
  'prose_reviewer',
  'continuity_reviewer',
] as const;
export const REVIEW_ALLOWED_ROLES = [
  'root_agent',
  ...REVIEWER_ROLES,
  'repair_agent',
  'synthesizer',
] as const;
export const CONTEXT_ALLOWED_ROLES = [...REVIEW_ALLOWED_ROLES, 'context_explorer'] as const;
export const WRITE_ALLOWED_ROLES = ['root_agent', 'repair_agent'] as const;

type SpecInput = Omit<
  AgentRuntimeToolSpec,
  | 'artifact_kinds'
  | 'required_capabilities'
  | 'evidence_fields'
  | 'references'
  | 'loop_schema'
  | 'loop_input_mode'
  | 'loop_trusted_context'
  | 'loop_trace_owner'
> &
  Partial<Omit<AgentRuntimeToolSpec, 'references'>> & {
    references?: Partial<ToolCatalogReferences>;
  };

export function toolSpec(input: SpecInput): AgentRuntimeToolSpec {
  const spec: AgentRuntimeToolSpec = {
    artifact_kinds: [],
    required_capabilities: [],
    evidence_fields: [],
    loop_schema: null,
    loop_input_mode: 'project',
    loop_trusted_context: false,
    loop_trace_owner: 'generic',
    ...input,
    references: { page_refs: [], api_paths: [], workflow_nodes: [], ...input.references },
  };
  if (!['project', 'existing_file', 'new_file'].includes(spec.loop_input_mode))
    throw new RangeError('Invalid loop_input_mode');
  if (!['generic', 'handler'].includes(spec.loop_trace_owner))
    throw new RangeError('Invalid loop_trace_owner');
  if (spec.loop_trusted_context && spec.loop_input_mode === 'project')
    throw new RangeError('loop_trusted_context requires a file input mode');
  return spec;
}

const CONFIRMING_RISK_LEVELS = new Set(['write_pending', 'high_cost', 'propose_patch', 'network']);

/** 是否需作者确认：只由 risk_level + execution_mode 派生，不再并列声明。 */
export const deriveRequiresConfirmation = (riskLevel: string, executionMode: string): boolean =>
  CONFIRMING_RISK_LEVELS.has(riskLevel) ||
  (riskLevel === 'long_running' && executionMode !== 'control');

export const derivePermissionLevel = (riskLevel: string, executionMode: string): string =>
  deriveRequiresConfirmation(riskLevel, executionMode) ? 'confirm' : 'auto';
