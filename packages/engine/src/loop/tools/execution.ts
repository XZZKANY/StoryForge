import type { AssistantDeps } from '../../assistant/service';
import type { GenerationDeliveryCapture } from '../../kernel/generationDelivery';
import { getAgentRole, isRoleAllowedTool, listSubagentRoles } from '../../kernel/roleCatalog';
import type { PatchProposal } from '../chatLoopTypes';
import type { PolishModels } from './polishService';
import type { ConversationSources } from '../conversationHistory';
import { AgentOrchestrationError } from '../runPayloads';
import type { AgentToolTrace } from '../traces';
import {
  derivePermissionLevel,
  deriveRequiresConfirmation,
  type AgentRuntimeToolSpec,
} from './specModels';

type Obj = { [key: string]: unknown };

export type ToolArtifact = {
  readonly kind: string;
  readonly payload: Obj;
  readonly requires_confirmation: boolean;
};

export type ToolResult = {
  readonly status: string;
  readonly output: Obj;
  readonly trace: AgentToolTrace;
  readonly summary?: string | null;
  readonly payload?: Obj | null;
  readonly artifacts?: readonly ToolArtifact[];
  readonly metrics?: Obj;
  readonly retry_metadata?: Obj | null;
  readonly checkpoint_metadata?: Obj | null;
  /** 产补丁的工具交给循环的提案。 */
  readonly patch_proposal?: PatchProposal | null;
};

/** 工具处理器看到的 run（P4 前来自内存存储）。 */
export type ToolRunView = {
  readonly public_id: string;
  readonly permission_profile: unknown;
  readonly goal: string;
  readonly status: string;
  readonly current_step: string | null;
  readonly events: readonly Obj[];
  readonly artifacts: readonly Obj[];
};

/**
 * 本次 run 绑定的服务：Python 处理器经 DB 会话与 ContextVar（运行控制、模型观察）隐式拿到的那些。
 * 模型端口已绑定本次 run 的运行控制与模型观察，处理器不另建出网通道。
 */
export type ToolRunServices = {
  readonly assistant: AssistantDeps;
  readonly conversation: ConversationSources;
  /** 运行控制的中断检查（Python 的 check_run_interruption）。 */
  readonly checkInterruption: (boundary: string) => void;
  /** 润色用的两个模型槽（主模型 / 专用润色槽）。 */
  readonly polish: PolishModels;
};

export type ToolExecutionContext = {
  readonly run: ToolRunView;
  readonly services: ToolRunServices;
  /** 嵌套 writer 的送达回执；循环外的调用没有（Python 的 ContextVar 未设置）。 */
  readonly deliveries: GenerationDeliveryCapture | null;
  readonly agentSessionId: string;
  readonly assistantSessionId: number;
  readonly userMessage: string;
  /** 处理器可以写入一次性标记（例如「本 run 已产出知识提议」）。 */
  readonly args: Obj;
  /** 只在后端流转的审稿报告，含本轮尚未结算的循环产物。 */
  currentReviewReport: Obj | null;
  /** 准入前循环读到的文件；绝不由模型提供，也不序列化。 */
  writingReadSources: readonly Obj[];
};

export type ToolHandler = (context: ToolExecutionContext, payload: Obj) => Promise<ToolResult>;

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Obj;
  readonly output_schema: Obj;
  readonly allowed_roles: readonly string[];
  readonly permission_level: string;
  readonly risk_level: string;
  readonly requires_confirmation: boolean;
  readonly retry_safe: boolean;
  readonly idempotent: boolean;
  readonly execution_mode: string;
  readonly artifact_kinds: readonly string[];
  readonly handler: ToolHandler;
  readonly loop_input_mode: AgentRuntimeToolSpec['loop_input_mode'];
  readonly loop_trusted_context: boolean;
  readonly loop_trace_owner: AgentRuntimeToolSpec['loop_trace_owner'];
};

export const toolDefinitionFromSpec = (
  spec: AgentRuntimeToolSpec,
  handler: ToolHandler,
): ToolDefinition => ({
  name: spec.name,
  description: spec.description,
  input_schema: { ...spec.input_schema },
  output_schema: { ...spec.output_schema },
  allowed_roles: [...spec.allowed_roles],
  permission_level: derivePermissionLevel(spec.risk_level, spec.execution_mode),
  risk_level: spec.risk_level,
  requires_confirmation: deriveRequiresConfirmation(spec.risk_level, spec.execution_mode),
  retry_safe: spec.retry_safe,
  idempotent: spec.idempotent,
  execution_mode: spec.execution_mode,
  artifact_kinds: [...spec.artifact_kinds],
  handler,
  loop_input_mode: spec.loop_input_mode,
  loop_trusted_context: spec.loop_trusted_context,
  loop_trace_owner: spec.loop_trace_owner,
});

/** agent 层的工具注册表（与 SDK 的 RuntimeTool 注册表不是一回事）。 */
export class AgentToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new AgentOrchestrationError(`Agent Runtime 工具未注册：${name}`);
    return tool;
  }

  all(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }
}

export type SubagentDefinition = {
  readonly role: string;
  readonly handler: (payload: Obj) => Promise<Obj>;
};

/** 只能调度角色目录里登记过、且被允许调用该工具的子代理。 */
export class SubagentExecutor {
  private readonly definitions = new Map<string, SubagentDefinition>();

  constructor(definitions: readonly SubagentDefinition[]) {
    for (const definition of definitions) this.definitions.set(definition.role, definition);
    const known = new Set(listSubagentRoles().map((role) => role.name));
    const missing = definitions.filter((definition) => !known.has(definition.role));
    if (missing.length)
      throw new AgentOrchestrationError(
        `子代理未登记到 role catalog：${missing.map((item) => item.role).join(', ')}`,
      );
  }

  get roles(): string[] {
    return [...this.definitions.keys()];
  }

  async run(role: string, payload: Obj, toolName: string): Promise<Obj> {
    const catalogRole = getAgentRole(role);
    if (catalogRole === null || catalogRole.kind !== 'subagent')
      throw new AgentOrchestrationError(`未知子代理 role catalog 条目：${role}`);
    if (!isRoleAllowedTool(role, toolName))
      throw new AgentOrchestrationError(`子代理 ${role} 不允许调用工具 ${toolName}`);
    const definition = this.definitions.get(role);
    if (!definition) throw new AgentOrchestrationError(`未知子代理：${role}`);
    return definition.handler(payload);
  }
}
