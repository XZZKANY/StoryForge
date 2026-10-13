import { cloneJson, type JsonValue } from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  getAgentRole,
  normalizeAgentRoleInputs,
  resolveAgentRoleAlias,
} from '../kernel/roleCatalog';
import { authorViewFromPayload, authorViewSummary } from './authorView';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cpLen = (text: string) => Array.from(text).length;
/** Python 的 int 包含 bool；非整数的 number 视为 float。 */
const isPyInt = (value: unknown): value is number | boolean =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value));

export class AgentOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOrchestrationError';
  }
}

export const SUPPORTED_INTENTS = new Set([
  'chat.explain',
  'chapter.write',
  'file.review',
  'file.revise',
  'chapter.polish',
]);
const REVIEWER_ROLES = [
  'plot_reviewer',
  'character_reviewer',
  'prose_reviewer',
  'continuity_reviewer',
];

export const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
export const stringArgList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)))
        .map(pythonStrip)
    : [];
export const orderedUnique = (values: readonly string[]): string[] => [...new Set(values)];

export function isConfirmWritebackRequest(userMessage: string): boolean {
  const text = pythonStrip(userMessage).toLowerCase();
  const has = (haystack: string, words: string[]) => words.some((word) => haystack.includes(word));
  if (has(text, ['accept this', 'apply this', 'confirm writeback'])) return true;
  if (has(userMessage, ['确认写回', '接受这版', '就这版写回', '应用这版', '确认应用'])) return true;
  if (has(userMessage, ['确认', '接受']) && has(userMessage, ['当前补丁', '当前修订'])) return true;
  return (
    (userMessage.includes('写回') || userMessage.includes('应用')) &&
    has(userMessage, ['确认', '接受', '这版', '当前补丁', '当前修订'])
  );
}

export function roleHints(args: Obj): string[] {
  const candidates = [...stringArgList(args.agent_role_hints)];
  for (const mention of stringArgList(args.agent_role_mentions)) {
    const role = getAgentRole(mention) ?? resolveAgentRoleAlias(mention);
    if (role && role.can_be_mentioned) candidates.push(role.name);
  }
  const resolved: string[] = [];
  for (const hint of candidates) {
    const role = getAgentRole(hint) ?? resolveAgentRoleAlias(hint);
    if (role && role.can_be_mentioned) resolved.push(role.name);
  }
  return orderedUnique(resolved);
}

export const roleMentions = (args: Obj): string[] =>
  orderedUnique(stringArgList(args.agent_role_mentions));

/**
 * 固定管线只认显式 intent 与结构化参数；中文关键词表已下线（F11），自由文本一律落对话循环。
 * 「确认写回」类消息永远走对话，不会被显式 intent 劫走。
 */
export function detectIntent(userMessage: string, args: Obj, explicitIntent: unknown): string {
  if (isConfirmWritebackRequest(userMessage)) return 'chat.explain';
  if (typeof explicitIntent === 'string' && SUPPORTED_INTENTS.has(explicitIntent))
    return explicitIntent;
  const hasFileContext =
    optionalString(args.file_path) !== null && typeof args.content === 'string';
  if (hasFileContext && roleHints(args).some((hint) => REVIEWER_ROLES.includes(hint)))
    return 'file.review';
  return 'chat.explain';
}

export function messageText(message: Obj): string {
  for (const key of ['user_message', 'message', 'content']) {
    const value = message[key];
    if (typeof value === 'string' && pythonStrip(value)) return pythonStrip(value);
  }
  throw new AgentOrchestrationError('Agent user_message 不能为空。');
}

export const messageArgs = (message: Obj): Obj => (isObj(message.args) ? { ...message.args } : {});

/** 事件表里的请求摘要用：空消息不报错，给一个占位标题。 */
export function payloadMessageText(message: Obj): string {
  try {
    return messageText(message);
  } catch (error) {
    if (error instanceof AgentOrchestrationError) return 'Agent 用户请求';
    throw error;
  }
}

export function messageInputSummary(message: Obj): Obj {
  const args = isObj(message.args) ? message.args : {};
  const summary: Obj = {
    type: message.type ?? null,
    intent: message.intent ?? null,
    has_args: Object.keys(args).length > 0,
  };
  for (const key of [
    'file_path',
    'scene_packet_id',
    'book_id',
    'blueprint_id',
    'assistant_session_id',
  ]) {
    const value = Object.prototype.hasOwnProperty.call(args, key) ? args[key] : message[key];
    if (value !== null && value !== undefined) summary[key] = value;
  }
  if (typeof args.content === 'string') summary.content_chars = cpLen(args.content);
  // 只落形状与量：选区 / 光标窗正文不进事件表（事件表会被导出与展示）。
  if (isObj(args.author_view)) summary.author_view = authorViewSummary(authorViewFromPayload(args));
  return summary;
}

export function scopeSummary(args: Obj): Obj {
  const scope: Obj = {};
  for (const key of ['file_path', 'scene_packet_id', 'book_id', 'blueprint_id', 'project_name']) {
    const value = args[key];
    if (typeof value === 'string' || isPyInt(value)) scope[key] = value;
  }
  const roles = normalizeAgentRoleInputs(args);
  if (roles.hints.length) scope.agent_role_hints = roles.hints;
  if (roles.mentions.length) scope.agent_role_mentions = roles.mentions;
  if (roles.unknown_hints.length) scope.unknown_agent_role_hints = roles.unknown_hints;
  if (roles.unknown_mentions.length) scope.unknown_agent_role_mentions = roles.unknown_mentions;
  return scope;
}

export const hasScopeKey = (scope: unknown, ...keys: string[]): boolean =>
  isObj(scope) && keys.some((key) => scope[key] !== null && scope[key] !== undefined);

/** 保留原值（不 strip），只滤掉非字符串与空白串。 */
export function scopeStringList(scope: unknown, key: string): string[] {
  if (!isObj(scope) || !Array.isArray(scope[key])) return [];
  return (scope[key] as unknown[]).filter(
    (item): item is string => typeof item === 'string' && Boolean(pythonStrip(item)),
  );
}

export function budgetSummary(args: Obj): Obj {
  const budget: Obj = {};
  for (const key of ['token_budget', 'time_budget_sec']) {
    const value = args[key];
    if (isPyInt(value) && Number(value) > 0) budget[key] = value;
  }
  return budget;
}

export function currentPlanStep(plan: readonly unknown[]): string | null {
  const str = (value: unknown) => (typeof value === 'string' ? value : String(value));
  for (const step of plan) {
    if (!isObj(step)) continue;
    if (step.status !== 'completed' && step.status !== 'skipped')
      return step.step === null || step.step === undefined ? null : str(step.step);
  }
  const last = plan[plan.length - 1];
  if (isObj(last) && last.step !== null && last.step !== undefined) return str(last.step);
  return null;
}

export const optionalPositiveInt = (value: unknown): number | boolean | null =>
  isPyInt(value) && Number(value) > 0 ? value : null;

// ---- 事件类型与控制消息 ----

export const AGENT_RUN_STARTED = 'agent_run_started';
export const AGENT_PLAN_CREATED = 'agent_plan_created';
export const SUBAGENT_STARTED = 'subagent_started';
export const SUBAGENT_COMPLETED = 'subagent_completed';
export const TOOL_TRACE = 'tool_trace';
export const PERMISSION_REQUIRED = 'permission_required';
export const AGENT_ARTIFACT = 'agent_artifact';
export const AGENT_RUN_COMPLETED = 'agent_run_completed';
export const AGENT_RUN_FAILED = 'agent_run_failed';
export const AGENT_RUN_INTERRUPTED = 'agent_run_interrupted';
export const AGENT_EXECUTION_STARTED = 'agent_execution_started';
export const AGENT_EXECUTION_SETTLED = 'agent_execution_settled';
export const SYSTEM_JOB = 'system_job';
export const AGENT_RUNTIME_PROGRESS = 'agent_runtime_progress';
export const PERMISSION_APPROVED = 'permission_approved';
export const PERMISSION_DENIED = 'permission_denied';
export const PAUSE_RUN = 'pause_run';
export const RESUME_RUN = 'resume_run';
export const STOP_RUN = 'stop_run';
export const RETRY_FROM_CHECKPOINT = 'retry_from_checkpoint';
export const APPROVE_PERMISSION_COMMAND = 'approve_permission';
export const DENY_PERMISSION_COMMAND = 'deny_permission';

export const CONTROL_MESSAGE_TYPES = new Set([
  APPROVE_PERMISSION_COMMAND,
  DENY_PERMISSION_COMMAND,
  PAUSE_RUN,
  RESUME_RUN,
  STOP_RUN,
  RETRY_FROM_CHECKPOINT,
]);

export function controlEventType(controlType: string): string {
  if (controlType === APPROVE_PERMISSION_COMMAND) return PERMISSION_APPROVED;
  if (controlType === DENY_PERMISSION_COMMAND) return PERMISSION_DENIED;
  return controlType;
}

const CONTROL_MESSAGES: Readonly<Record<string, string>> = {
  [APPROVE_PERMISSION_COMMAND]: '作者已批准权限请求。',
  [DENY_PERMISSION_COMMAND]: '作者已拒绝权限请求。',
  [PAUSE_RUN]: '作者已暂停 AgentRun。',
  [RESUME_RUN]: '作者已恢复 AgentRun。',
  [STOP_RUN]: '作者已停止 AgentRun。',
  [RETRY_FROM_CHECKPOINT]: '作者要求从 checkpoint 重试 AgentRun。',
};
export const controlEventMessage = (controlType: string): string =>
  Object.prototype.hasOwnProperty.call(CONTROL_MESSAGES, controlType)
    ? CONTROL_MESSAGES[controlType]
    : `收到控制消息：${controlType}`;

// ---- 结果契约 ----

export type AgentRuntimeInterruption = { status: 'paused' | 'stopped'; boundary: string };
export type AgentExecutionOutcome = { status: 'failed' | 'partial'; code: string; message: string };

const deepCopy = <T>(value: T): T => cloneJson(value as JsonValue) as T;

/** 断线重连要无损重建结果；内部标记（下划线开头）不落库。 */
export const executionResultPayload = (result: Obj): Obj => ({
  execution_result: deepCopy(
    Object.fromEntries(Object.entries(result).filter(([key]) => !key.startsWith('_'))),
  ),
});

export function resolveExecutionResult(payload: Obj, approved: boolean): Obj {
  const raw = payload.execution_result;
  if (!isObj(raw)) return {};
  const result = deepCopy(raw);
  result.proposed_patch = null;
  const agentResult = result.agent_result as Obj;
  agentResult.requires_user_confirmation = false;
  agentResult.writeback_blocked_until_user_confirms = false;
  agentResult.patch_resolution = approved ? 'approved' : 'denied';
  for (const step of (result.plan ?? []) as Obj[]) {
    if (step.step === 'permission.confirm') {
      step.status = approved ? 'completed' : 'failed';
      step.detail = approved ? '作者已批准提案；文件写回由 Desktop 执行。' : '作者已拒绝提案。';
    }
  }
  return { execution_result: result };
}
