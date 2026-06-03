import type { AssistantToolNode, AssistantToolStatus } from './assistant-types';

export type AssistantToolEventType =
  | 'tool_planned'
  | 'tool_running'
  | 'tool_completed'
  | 'tool_failed'
  | 'needs_approval'
  | 'book_run_progress';

export type AssistantToolEvent = {
  readonly type: AssistantToolEventType;
  readonly toolName: string;
  readonly status: AssistantToolStatus;
  readonly summary: string;
  readonly elapsedMs?: number;
  readonly tokenUsage?: number;
};

export function parseAssistantToolEvents(input: unknown): AssistantToolEvent[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const event = parseAssistantToolEvent(item);
    return event ? [event] : [];
  });
}

export function parseAssistantToolEvent(input: unknown): AssistantToolEvent | null {
  if (!isRecord(input)) return null;
  const type = input.type;
  if (!isAssistantToolEventType(type)) return null;
  const toolName = stringValue(input.tool_name) ?? stringValue(input.toolName) ?? type;
  const summary =
    stringValue(input.output_summary) ?? stringValue(input.summary) ?? '等待工具返回结果。';
  return {
    type,
    toolName,
    status: statusForEvent(type),
    summary,
    elapsedMs: numberValue(input.elapsed_ms),
    tokenUsage: numberValue(input.token_usage),
  };
}

export function mapAssistantToolEventsToNodes(
  events: readonly AssistantToolEvent[],
): AssistantToolNode[] {
  return events.map((event, index) => ({
    id: `assistant-event-${index}-${event.toolName}`,
    label: labelForTool(event.toolName),
    tool: event.toolName,
    status: event.status,
    elapsedLabel: event.elapsedMs === undefined ? undefined : `${event.elapsedMs}ms`,
    tokenLabel: event.tokenUsage === undefined ? undefined : `${event.tokenUsage} tokens`,
    summary: event.summary,
  }));
}

function statusForEvent(type: AssistantToolEventType): AssistantToolStatus {
  if (type === 'tool_completed') return 'completed';
  if (type === 'tool_running' || type === 'book_run_progress') return 'running';
  if (type === 'tool_failed') return 'failed';
  if (type === 'needs_approval') return 'needs_approval';
  return 'waiting';
}

function labelForTool(toolName: string): string {
  const labels: Record<string, string> = {
    'goal.analyze': '分析创作目标',
    'blueprint.create': '创建 Blueprint',
    'chapter.generate': '生成章节正文',
    'judge.create_issues': 'Judge 质量审阅',
    'repair.create_patch': '修复建议',
    'artifact.export': '导出制品',
  };
  return labels[toolName] ?? toolName;
}

function isAssistantToolEventType(value: unknown): value is AssistantToolEventType {
  return (
    value === 'tool_planned' ||
    value === 'tool_running' ||
    value === 'tool_completed' ||
    value === 'tool_failed' ||
    value === 'needs_approval' ||
    value === 'book_run_progress'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
