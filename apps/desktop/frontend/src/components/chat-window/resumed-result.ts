import type { AgentResultMessage } from '../../lib/api-client';
import { stepsFromAgentResult } from './agent-step-mapping';
import type { AgentRun, AgentStep } from './types';

export type ResumeDiagnosticDisplay = {
  status: AgentRun['status'];
  message: string;
};

export function statusFromAgentResult(response: AgentResultMessage): AgentRun['status'] {
  return response.agent_result.requires_user_confirmation ? 'waiting' : 'completed';
}

export function stepsFromResumedAgentResult(response: AgentResultMessage): AgentStep[] {
  const needsConfirmation = response.agent_result.requires_user_confirmation === true;
  return [
    {
      id: 'resume',
      title: '恢复 AgentRun',
      tool: 'agent.runtime.resume',
      status: 'completed',
      detail: `resume_run 已返回 ${response.intent}`,
    },
    ...stepsFromAgentResult(response),
    {
      id: 'approval',
      title: '等待作者确认并收口',
      tool: 'author.approval',
      status: needsConfirmation ? 'waiting' : 'completed',
      detail: needsConfirmation ? '等待作者在右侧 diff 面板确认' : '无需写回确认',
    },
  ];
}

export function displayFromResumeDiagnostic(
  diagnostic: Record<string, unknown>,
): ResumeDiagnosticDisplay {
  const reason = stringField(diagnostic, 'reason');
  const pendingTool = stringField(diagnostic, 'pending_tool') ?? stringField(diagnostic, 'intent');
  const requiresManualRestart = diagnostic.requires_manual_restart === true;
  if (requiresManualRestart) {
    return {
      status: 'failed',
      message: `恢复未执行：${diagnosticReasonLabel(reason)}${pendingTool ? `（${pendingTool}）` : ''}。需要手动重启本轮。`,
    };
  }
  return {
    status: 'waiting',
    message: `恢复尚未执行：${diagnosticReasonLabel(reason)}${pendingTool ? `（${pendingTool}）` : ''}。`,
  };
}

function diagnosticReasonLabel(reason: string | null): string {
  if (reason === 'run_not_resumed') return 'AgentRun 尚未进入 resumed 状态';
  if (reason === 'missing_resume_message') return '缺少恢复消息';
  if (reason === 'unsupported_pending_call_intent') return '当前 pending intent 暂不支持自动恢复';
  if (reason === 'invalid_pending_call') return 'pending call 记录无效';
  if (reason === 'pending_call_ready') return 'pending call 已就绪';
  return reason ?? '原因未明';
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}
