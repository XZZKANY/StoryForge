import type {
  AgentRunOverviewStatus,
  AgentRunOverviewSummary,
  ChapterBrief,
  AgentRun,
} from './types';

export type OverviewActivityInput = {
  projectPath: string | null;
  assistantSessionId?: number | null;
  agentRun: AgentRun | null;
  chapterBrief: ChapterBrief | null;
  agentBusy: boolean;
  sessionLoadError: string | null;
  retryableFailure?: boolean;
};

function waitingStatus(run: AgentRun, chapterBrief: ChapterBrief | null): AgentRunOverviewStatus {
  if (chapterBrief) return 'waiting_brief';
  if (run.steps.some((step) => step.id === 'permission-required' && step.status === 'waiting')) {
    return 'waiting_permission';
  }
  return 'waiting_patch';
}

/** Derive overview activity without copying approval queues or patch contents. */
export function projectOverviewActivity({
  projectPath,
  assistantSessionId = null,
  agentRun,
  chapterBrief,
  agentBusy,
  sessionLoadError,
  retryableFailure = false,
}: OverviewActivityInput): AgentRunOverviewSummary | null {
  if (!projectPath) return null;
  if (sessionLoadError) {
    return {
      projectPath,
      assistantSessionId,
      status: 'session_error',
      goal: '',
      message: sessionLoadError,
      retryable: true,
    };
  }
  if (agentRun?.deliveryUnknown) {
    return {
      projectPath,
      assistantSessionId,
      status: 'waiting',
      goal: agentRun.goal,
      message: '本轮结果未知，请打开工作台核对原运行；不会自动重放。',
      retryable: false,
    };
  }
  if (agentRun) {
    const status: AgentRunOverviewStatus =
      agentRun.status === 'waiting'
        ? waitingStatus(agentRun, chapterBrief)
        : agentRun.status === 'running' ||
            agentRun.status === 'paused' ||
            agentRun.status === 'completed' ||
            agentRun.status === 'failed'
          ? agentRun.status
          : agentRun.status === 'stopped'
            ? 'stopped'
            : agentBusy
              ? 'busy'
              : 'failed';
    return {
      projectPath,
      assistantSessionId,
      status,
      goal: agentRun.goal,
      retryable: status === 'failed' && retryableFailure,
    };
  }
  if (agentBusy) {
    return {
      projectPath,
      assistantSessionId,
      status: 'busy',
      goal: '',
      message: '正在准备 Agent…',
    };
  }
  return null;
}

export function overviewActivityLabel(status: AgentRunOverviewStatus): string {
  switch (status) {
    case 'running':
      return 'Agent 正在工作';
    case 'waiting':
      return '等待下一步';
    case 'waiting_permission':
      return '等待权限确认';
    case 'waiting_brief':
      return '等待章节 Brief 确认';
    case 'waiting_patch':
      return '等待修改确认';
    case 'paused':
      return 'Agent 已暂停';
    case 'completed':
      return '本轮已完成';
    case 'stopped':
      return '已由你停止本轮';
    case 'failed':
      return '本轮遇到问题';
    case 'busy':
      return '正在准备 Agent';
    case 'session_error':
      return '会话加载失败';
  }
}

export function overviewActivityActionLabel(summary: AgentRunOverviewSummary): string {
  if (summary.status === 'session_error') return '查看会话错误并重试';
  if (summary.status === 'failed') return '查看错误并重试';
  if (summary.status === 'completed' || summary.status === 'stopped') return '查看对话';
  return '打开工作台查看详情';
}
