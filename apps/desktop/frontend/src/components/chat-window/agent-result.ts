import type { AgentResultMessage } from '../../lib/api-client';
import { relativePathInsideProject, resolveProjectRelativePath } from '../../lib/project-context';
import { reviewReportFromMessage } from './review';

export function fileRevisionPatch(message: AgentResultMessage): {
  id?: string;
  file_path: string;
  before: string;
  after: string;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'file_revision') return null;
  if (
    typeof patch.file_path === 'string' &&
    typeof patch.before === 'string' &&
    typeof patch.after === 'string'
  ) {
    return {
      id: typeof patch.id === 'string' ? patch.id : undefined,
      file_path: patch.file_path,
      before: patch.before,
      after: patch.after,
    };
  }
  return null;
}

export function resolveProposedPatchFilePath(
  projectPath: string | null,
  filePath: string,
): string | null {
  if (!projectPath) return null;
  const resolved = resolveProjectRelativePath(projectPath, filePath);
  const relative = resolved ? relativePathInsideProject(projectPath, resolved) : null;
  return relative === null ? null : resolveProjectRelativePath(projectPath, relative);
}

export function repairPatchApproval(message: AgentResultMessage): {
  summary: string;
  command: { command_id: string; args: Record<string, unknown> } | null;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'repair_patch') return null;
  const repair =
    patch.repair_patch && typeof patch.repair_patch === 'object'
      ? (patch.repair_patch as Record<string, unknown>)
      : {};
  const targetSpan = typeof repair.target_span === 'string' ? repair.target_span : '';
  const replacement = typeof repair.replacement_text === 'string' ? repair.replacement_text : '';
  const reason = typeof repair.reason === 'string' ? repair.reason : '';
  const rawCommand = patch.approval_command;
  const command =
    rawCommand &&
    typeof rawCommand === 'object' &&
    typeof (rawCommand as { command_id?: unknown }).command_id === 'string'
      ? {
          command_id: (rawCommand as { command_id: string }).command_id,
          args:
            (rawCommand as { args?: unknown }).args &&
            typeof (rawCommand as { args?: unknown }).args === 'object'
              ? (rawCommand as { args: Record<string, unknown> }).args
              : {},
        }
      : null;
  const lines = [
    targetSpan || replacement
      ? `章节修复建议：将「${targetSpan}」替换为「${replacement}」。`
      : '章节修复建议已生成。',
    reason,
    command
      ? `点击「批准」将执行 ${command.command_id} 完成写回。`
      : '该补丁缺少可执行的批准命令，暂时无法从对话内写回。',
  ];
  return { summary: lines.filter(Boolean).join('\n'), command };
}

export function filePathFromAgentResult(message: AgentResultMessage): string | null {
  const patch = fileRevisionPatch(message);
  if (patch) return patch.file_path;
  const report = reviewReportFromMessage(message);
  const filePath = report?.file_path;
  return typeof filePath === 'string' && filePath.trim() ? filePath : null;
}

export function shouldApplyAgentControlAck(
  activeRunId: string | null,
  requestedRunId: string,
  ackRunId?: string,
): boolean {
  return activeRunId === requestedRunId && (!ackRunId || ackRunId === requestedRunId);
}

export function modelFromToolTrace(message: AgentResultMessage): string {
  for (const trace of message.tool_trace) {
    const model = trace.output_summary?.model;
    if (typeof model === 'string' && model.trim()) return model;
  }
  return 'StoryForge Agent';
}

export function issueIdsFromAgentResult(message: AgentResultMessage): string[] {
  const scope = message.agent_result.applied_scope;
  if (!scope || typeof scope !== 'object') return [];
  const ids = (scope as { issue_ids?: unknown }).issue_ids;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [];
}
