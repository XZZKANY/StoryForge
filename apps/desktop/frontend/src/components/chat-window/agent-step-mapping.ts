import type { AgentPlanStep } from '../../lib/api-client';
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

export function planStepTitle(step: string): string {
  const titleByStep: Record<string, string> = {
    intent: '识别意图',
    respond: '生成回答',
    revise: '生成修订',
    approval: '等待作者确认',
    load_scene_packet: '读取场景包',
    'judge.run': '运行 Judge',
    'judge.repair': '生成修复建议',
    'bookrun.start': '启动写作任务',
    'context-agent': '选择上下文',
    'plot-agent': '剧情结构审稿',
    'character-agent': '人物一致性审稿',
    'prose-agent': '文风节奏审稿',
    'synthesizer-agent': '合并审稿报告',
    audit: '记录审计',
  };
  return titleByStep[step] ?? step;
}

export function toolTraceDetail(trace: ChatWindowAgentToolTrace): string {
  if (trace.error_message) return trace.error_message;
  const output = trace.output_summary ?? {};
  const audit = trace.audit_event_id ? `；审计 ${trace.audit_event_id}` : '';
  const model = typeof output.model === 'string' ? `；模型 ${output.model}` : '';
  const latency = typeof output.latency_ms === 'number' ? `；${output.latency_ms}ms` : '';
  const contextCount =
    typeof output.context_file_count === 'number' ? `；上下文 ${output.context_file_count} 个` : '';
  const issueCount =
    typeof output.issue_count === 'number' ? `；问题 ${output.issue_count} 个` : '';
  const actionCount =
    typeof output.suggested_action_count === 'number'
      ? `；建议 ${output.suggested_action_count} 条`
      : '';
  return `${trace.status}${model}${latency}${contextCount}${issueCount}${actionCount}${audit}`;
}

export function stepsFromAgentResult(message: ChatWindowAgentResult): AgentStep[] {
  const planSteps = message.plan.map((step: AgentPlanStep, index) => ({
    id: `plan-${index}-${step.step}`,
    title: planStepTitle(step.step),
    tool: step.step,
    status: mapAgentStepStatus(step.status),
    detail: step.detail,
  }));
  const toolSteps = message.tool_trace.map((trace: ChatWindowAgentToolTrace, index) => ({
    id: `tool-${index}-${trace.tool_name}`,
    title: trace.tool_name,
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
  }));
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
    detail,
  };
}

export function stepFromToolTraceEvent(index: number, trace: ChatWindowAgentToolTrace): AgentStep {
  return {
    id: `tool-${index}-${trace.tool_name}`,
    title: trace.tool_name,
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
  };
}
