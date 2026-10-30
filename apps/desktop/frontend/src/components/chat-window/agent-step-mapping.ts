import type { AgentPlanStep } from '../../lib/api-client';
import { traceLookup, traceReadSources, traceSkillRead } from './context-panel';
import { formatElapsed } from './RunElapsed';
import type {
  AgentStep,
  AgentStepStatus,
  ChatWindowAgentResult,
  ChatWindowAgentToolTrace,
} from './types';

export function mapAgentStepStatus(status: string): AgentStepStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'needs_approval' || status === 'needs_confirmation' || status === 'paused')
    return 'waiting';
  if (status === 'running') return 'running';
  return 'pending';
}

/**
 * 模型请求（「准备第 N 次模型请求」）每轮都有、和底部运行条重复，不进思考过程；
 * 运行条照常拿它当当前步骤显示，重试 / 退避时把原因写出来。
 */
export function isModelRequestStep(step: AgentStep): boolean {
  return step.tool === 'agent.provider';
}

// 等作者拍板的步骤（权限、补丁确认）由对话底部的选择框来问，思考过程里不再写一遍「等你确认」。
const DECISION_TOOLS = new Set(['author.approval', 'permission-gate', 'permission.confirm']);

export function isDecisionStep(step: AgentStep): boolean {
  return DECISION_TOOLS.has(step.tool);
}

export function processSteps(steps: readonly AgentStep[]): AgentStep[] {
  return steps.filter((step) => !isModelRequestStep(step) && !isDecisionStep(step));
}

// 思考过程里工具的叫法：作者看到的是「读取 正文/第005章.md」，不是「fs.read completed」。
const TOOL_LABELS: Record<string, string> = {
  'context.load': '读取上下文',
  'fs.list': '查看目录',
  'fs.read': '读取',
  'fs.search': '搜索',
  'skill.read': '读技能',
  'project.knowledge': '查创作资料',
  'knowledge.propose': '提议记入创作资料',
  'file.review': '审稿',
  'file.revise': '改写',
  'file.create': '起草新文件',
  'chapter.polish': '润色',
  'prose.continue': '续写',
  'judge.run': '自检',
  'chapter.brief': '拟章纲',
  'chapter.draft': '起草正文',
  'chapter.check': '检查草稿',
  'chapter.repair': '修补草稿',
  'project.consistency': '一致性扫描',
  'project.deep_consistency': '深度一致性检查',
  'project.cross_chapter_check': '跨章一致性检查',
  'project.canon': '核对设定',
  'project.canon_delta': '整理设定变化',
  'project.hooks_delta': '整理伏笔变化',
  'project.promise_check': '伏笔检查',
  'project.prose_check': '文笔检查',
  'project.collapse_check': '场景承重检查',
  'project.entity_budget_check': '新增人物地点检查',
  'project.plan_update': '更新连载计划',
  'project.trim_prose': '压缩冗余',
};

export function planStepTitle(step: string): string {
  const titleByStep: Record<string, string> = {
    intent: '识别意图',
    respond: '生成回答',
    revise: '生成修订',
    approval: '等待作者确认',
    load_scene_packet: '读取场景包',
    'judge.run': '自检',
    'judge.repair': '生成修复建议',
    'agent.provider': '模型请求',
    'agent.loop': '整理回答',
    'permission.confirm': '等你确认',
    'writeback.auto': '自动写回准备完成',
    'context-agent': '选择上下文',
    'plot-agent': '剧情结构审稿',
    'character-agent': '人物一致性审稿',
    'prose-agent': '文风节奏审稿',
    'synthesizer-agent': '合并审稿报告',
    audit: '记录审计',
  };
  return titleByStep[step] ?? TOOL_LABELS[step] ?? step;
}

function planStepDetail(step: string, detail: string): string {
  return step === 'agent.loop' ? detail.replace(/^工具循环完成：/, '完成：') : detail;
}

// 读文件的工具记 path，改稿 / 起草记 file_path；绝对路径太长，只留文件名。
function toolTarget(input: Record<string, unknown>): string | null {
  for (const key of ['path', 'file_path', 'target_path']) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const text = value.trim();
    return /^([a-zA-Z]:[\\/]|[\\/])/.test(text) ? (text.split(/[\\/]/).pop() ?? text) : text;
  }
  return null;
}

// skill.read 的目标是技能名，不是路径；没完成的调用 output 里没有名字，退回调用时点的名字。
function skillReadTitle(label: string, trace: ChatWindowAgentToolTrace): string {
  const read = traceSkillRead(trace);
  const output = trace.output_summary ?? {};
  const name =
    read?.name ??
    [output.skill_name, trace.input_summary?.name]
      .find((value): value is string => typeof value === 'string' && value.trim() !== '')
      ?.trim();
  if (!name) return label;
  const plugin = read?.plugin ?? (typeof output.plugin === 'string' ? output.plugin.trim() : '');
  return `${label} ${name}${plugin ? `（插件 ${plugin}）` : ''}`;
}

/** 工具步骤的标题：中文动作 + 对象（文件路径或检索词）；不认识的工具照原名。 */
export function toolStepTitle(trace: ChatWindowAgentToolTrace): string {
  const label = TOOL_LABELS[trace.tool_name] ?? trace.tool_name;
  const input = trace.input_summary ?? {};
  if (trace.tool_name === 'skill.read') return skillReadTitle(label, trace);
  const target = toolTarget(input);
  if (target) return `${label} ${target}`;
  if (typeof input.query === 'string' && input.query.trim())
    return `${label}「${input.query.trim()}」`;
  return label;
}

/** 工具用时说人话：作者看「3 分 41 秒」，不看「220535ms」。 */
export function formatLatency(ms: number): string {
  return ms < 1000 ? '不到 1 秒' : formatElapsed(Math.round(ms / 1000));
}

/** 成败已由行首的 ✓ / ✗ 表示，这里不再写英文状态；只留错误原文与对作者有意义的数字。 */
export function toolTraceDetail(trace: ChatWindowAgentToolTrace): string {
  if (trace.error_message) return trace.error_message;
  const output = trace.output_summary ?? {};
  const parts: string[] = [];
  if (typeof output.model === 'string') parts.push(`模型 ${output.model}`);
  if (typeof output.latency_ms === 'number') parts.push(formatLatency(output.latency_ms));
  if (typeof output.context_file_count === 'number')
    parts.push(`上下文 ${output.context_file_count} 个`);
  if (typeof output.issue_count === 'number') parts.push(`问题 ${output.issue_count} 个`);
  if (typeof output.suggested_action_count === 'number')
    parts.push(`建议 ${output.suggested_action_count} 条`);
  if (trace.audit_event_id) parts.push(`审计 ${trace.audit_event_id}`);
  return parts.join('；');
}

// 从 output_summary 抽步骤行右侧的淡字：问题数 / 建议数 / 上下文数 / 用时，按作者关心的先后排。
// 模型名不进行内（每步都一样，只是噪音），由 toolTraceModel 放进悬停提示；错误时只看错误原文。
export function toolTraceMetrics(trace: ChatWindowAgentToolTrace): string[] {
  if (trace.error_message) return [];
  const output = trace.output_summary ?? {};
  const metrics: string[] = [];
  if (typeof output.issue_count === 'number') metrics.push(`问题 ${output.issue_count} 个`);
  if (typeof output.suggested_action_count === 'number')
    metrics.push(`建议 ${output.suggested_action_count} 条`);
  if (typeof output.context_file_count === 'number')
    metrics.push(`上下文 ${output.context_file_count} 个`);
  if (typeof output.latency_ms === 'number') metrics.push(formatLatency(output.latency_ms));
  return metrics;
}

export function toolTraceModel(trace: ChatWindowAgentToolTrace): string | undefined {
  const model = trace.output_summary?.model;
  return typeof model === 'string' && model.trim() ? model : undefined;
}

export function stepsFromAgentResult(message: ChatWindowAgentResult): AgentStep[] {
  const planSteps = message.plan.map((step: AgentPlanStep, index) => ({
    id: `plan-${index}-${step.step}`,
    title: planStepTitle(step.step),
    tool: step.step,
    status: mapAgentStepStatus(step.status),
    detail: planStepDetail(step.step, step.detail),
  }));
  const toolSteps = message.tool_trace.map((trace: ChatWindowAgentToolTrace, index) =>
    stepFromToolTraceEvent(index, trace),
  );
  return [...planSteps, ...toolSteps];
}

export function stepFromAgentPlanEvent(
  index: number,
  step: string,
  detail: string,
  status: string,
): AgentStep {
  return {
    id: `plan-${index}-${step}`,
    title: planStepTitle(step),
    tool: step,
    status: mapAgentStepStatus(status),
    detail: planStepDetail(step, detail),
  };
}

/** 流式事件与收尾结果共用这一份映射：两条路上的读取来源不会一边有一边没有。 */
export function stepFromToolTraceEvent(index: number, trace: ChatWindowAgentToolTrace): AgentStep {
  const sources = traceReadSources(trace);
  const lookup = traceLookup(trace);
  const model = toolTraceModel(trace);
  const skill = traceSkillRead(trace);
  return {
    id: `tool-${index}-${trace.tool_name}`,
    title: toolStepTitle(trace),
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
    metrics: toolTraceMetrics(trace),
    ...(model !== undefined ? { model } : {}),
    ...(sources.length ? { sources } : {}),
    ...(lookup !== undefined ? { lookup } : {}),
    ...(skill ? { skill } : {}),
  };
}

/** 等待作者确认的步骤：只有结果要求确认才出现，Chapter Brief 与编辑器 diff 两种文案。 */
export function approvalStepFromAgentResult(
  message: ChatWindowAgentResult,
  hasChapterBrief: boolean,
  patch: { file_path: string; id: string } | null,
): AgentStep[] {
  if (!message.agent_result.requires_user_confirmation) return [];
  return [
    {
      id: 'approval',
      title: '等待作者确认',
      tool: 'author.approval',
      status: 'waiting',
      detail: hasChapterBrief ? '等待作者确认 Chapter Brief' : '等待作者在编辑器里确认 diff',
      filePath: patch?.file_path,
      patchId: patch?.id,
    },
  ];
}
