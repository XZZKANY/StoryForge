import type { AgentRunSavePoint, AgentRunSavePointProjection } from '../../lib/api-client';

export type AgentRunRecoveryTone = 'neutral' | 'ok' | 'waiting' | 'error';

export type AgentRunRecoveryDisplay = {
  statusText: string;
  resumeText: string;
  pendingText: string | null;
  latestControlText: string | null;
  boundaryText: string | null;
  checkpointText: string | null;
  tone: AgentRunRecoveryTone;
  canRetryFromCheckpoint: boolean;
  manualRestartRequired: boolean;
};

export function buildAgentRunRecoveryDisplay(
  projection: AgentRunSavePointProjection | null | undefined,
): AgentRunRecoveryDisplay | null {
  if (!projection) return null;

  const pending = recordFrom(projection.pending);
  const recoverability = recordFrom(projection.recoverability);
  const runtimeRecovery = recordFrom(projection.runtime_recovery);
  const latestControl = optionalRecord(runtimeRecovery.latest_control);
  const latestPendingCall = optionalRecord(runtimeRecovery.latest_pending_call);
  const latestResolution = optionalRecord(runtimeRecovery.latest_pending_call_resolution);
  const latestDiagnostic = optionalRecord(runtimeRecovery.latest_resume_diagnostic);
  const latestFailure = optionalRecord(runtimeRecovery.latest_failure);
  const latestMarker = optionalRecord(runtimeRecovery.latest_execution_marker);
  const latestInterruption = optionalRecord(runtimeRecovery.latest_interruption);

  const canRetryFromCheckpoint = booleanField(recoverability, 'can_retry_from_checkpoint') === true;
  const manualRestartRequired =
    booleanField(runtimeRecovery, 'manual_restart_required') === true ||
    booleanField(recoverability, 'failed_without_checkpoint') === true;
  const resumeStrategy = stringField(recoverability, 'resume_strategy') ?? 'none';
  const checkpointText = checkpointSummary(
    projection.save_points,
    numberField(recoverability, 'latest_checkpoint_artifact_id'),
  );
  const pendingText = pendingSummary({
    pending,
    latestPendingCall,
    latestDiagnostic,
    status: projection.status,
  });
  const boundaryText = boundarySummary({
    latestResolution,
    latestMarker,
    latestFailure,
    latestInterruption,
  });

  return {
    statusText: `状态：${statusLabel(projection.status)}`,
    resumeText: resumeStrategyText({
      strategy: resumeStrategy,
      canRetryFromCheckpoint,
      manualRestartRequired,
    }),
    pendingText,
    latestControlText: controlText(latestControl),
    boundaryText,
    checkpointText,
    tone: toneFor({
      status: projection.status,
      pendingText,
      canRetryFromCheckpoint,
      manualRestartRequired,
    }),
    canRetryFromCheckpoint,
    manualRestartRequired,
  };
}

function pendingSummary({
  pending,
  latestPendingCall,
  latestDiagnostic,
  status,
}: {
  pending: Record<string, unknown>;
  latestPendingCall: Record<string, unknown> | null;
  latestDiagnostic: Record<string, unknown> | null;
  status: string;
}): string | null {
  const parts: string[] = [];
  if (booleanField(pending, 'permission_required') === true) {
    const blockedTool = stringField(pending, 'blocked_tool');
    parts.push(blockedTool ? `等待权限：${blockedTool}` : '等待权限');
  }

  const pendingTool =
    stringField(pending, 'runtime_pending_tool') ??
    (latestPendingCall
      ? (stringField(latestPendingCall, 'pending_tool') ?? stringField(latestPendingCall, 'intent'))
      : null);
  const pendingArtifactId =
    numberField(pending, 'runtime_pending_call_artifact_id') ??
    (latestPendingCall ? numberField(latestPendingCall, 'artifact_id') : null);
  if (pendingTool) {
    parts.push(
      pendingArtifactId
        ? `待恢复调用：${pendingTool} #${pendingArtifactId}`
        : `待恢复调用：${pendingTool}`,
    );
  }

  const proposedPatchId = numberField(pending, 'proposed_patch_artifact_id');
  if (proposedPatchId !== null && status !== 'completed') {
    parts.push(`待确认补丁 #${proposedPatchId}`);
  }

  if (latestDiagnostic && booleanField(latestDiagnostic, 'requires_manual_restart') === true) {
    const reason = stringField(latestDiagnostic, 'reason');
    parts.push(reason ? `恢复诊断：${reason}` : '恢复诊断：需要手动重启');
  }

  return parts.length > 0 ? parts.join('；') : null;
}

function boundarySummary({
  latestResolution,
  latestMarker,
  latestFailure,
  latestInterruption,
}: {
  latestResolution: Record<string, unknown> | null;
  latestMarker: Record<string, unknown> | null;
  latestFailure: Record<string, unknown> | null;
  latestInterruption: Record<string, unknown> | null;
}): string | null {
  if (latestResolution) {
    const pendingTool = stringField(latestResolution, 'pending_tool') ?? 'pending call';
    const resultStatus = stringField(latestResolution, 'result_status');
    return resultStatus ? `已恢复：${pendingTool} · ${resultStatus}` : `已恢复：${pendingTool}`;
  }
  if (latestFailure) {
    const message = stringField(latestFailure, 'message');
    return message ? `最近失败：${message}` : '最近失败：已记录';
  }
  if (latestInterruption) {
    const status = stringField(latestInterruption, 'status');
    return status ? `最近中断：${status}` : '最近中断：已记录';
  }
  if (latestMarker) {
    const toolName = stringField(latestMarker, 'tool_name');
    const markerStatus = stringField(latestMarker, 'status');
    if (toolName && markerStatus) return `最近边界：${toolName} · ${markerStatus}`;
    if (toolName) return `最近边界：${toolName}`;
  }
  return null;
}

function checkpointSummary(
  savePoints: AgentRunSavePoint[],
  latestCheckpointArtifactId: number | null,
): string | null {
  const checkpoint = [...savePoints].reverse().find((item) => item.kind === 'bookrun_checkpoint');
  if (!checkpoint && latestCheckpointArtifactId === null) return null;

  const summary = recordFrom(checkpoint?.summary);
  const artifactId = checkpoint?.artifact_id ?? latestCheckpointArtifactId;
  const chapterIndex =
    numberField(summary, 'latest_checkpoint_chapter_index') ??
    numberField(summary, 'retry_checkpoint_chapter_index') ??
    numberField(summary, 'current_chapter_index');
  const completedCount = numberField(summary, 'completed_count');
  const totalChapters = numberField(summary, 'total_chapters');
  const parts = [`checkpoint #${artifactId ?? '?'}`];
  if (chapterIndex !== null) parts.push(`第 ${chapterIndex} 章`);
  if (completedCount !== null && totalChapters !== null) {
    parts.push(`${completedCount}/${totalChapters}`);
  }
  return parts.join(' · ');
}

function resumeStrategyText({
  strategy,
  canRetryFromCheckpoint,
  manualRestartRequired,
}: {
  strategy: string;
  canRetryFromCheckpoint: boolean;
  manualRestartRequired: boolean;
}): string {
  if (manualRestartRequired) return '恢复：需要手动重启本轮';
  if (canRetryFromCheckpoint || strategy === 'bookrun_checkpoint') {
    return '恢复：可从 BookRun checkpoint 继续';
  }
  if (strategy === 'await_permission_decision') return '恢复：等待权限确认';
  if (strategy === 'stopped_by_user') return '恢复：已由用户停止';
  if (strategy && strategy !== 'none') return `恢复：${strategy}`;
  return '恢复：暂无待处理边界';
}

function controlText(control: Record<string, unknown> | null): string | null {
  if (!control) return null;
  const eventType = stringField(control, 'event_type') ?? stringField(control, 'control_type');
  if (!eventType) return null;
  const status =
    stringField(control, 'book_run_status') ?? stringField(control, 'writing_run_status');
  return status
    ? `最近控制：${controlLabel(eventType)} · ${status}`
    : `最近控制：${controlLabel(eventType)}`;
}

function toneFor({
  status,
  pendingText,
  canRetryFromCheckpoint,
  manualRestartRequired,
}: {
  status: string;
  pendingText: string | null;
  canRetryFromCheckpoint: boolean;
  manualRestartRequired: boolean;
}): AgentRunRecoveryTone {
  if (manualRestartRequired || status === 'failed') return 'error';
  if (pendingText || status === 'paused') return 'waiting';
  if (canRetryFromCheckpoint || status === 'completed') return 'ok';
  return 'neutral';
}

function statusLabel(status: string): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '暂停';
  if (status === 'stopped') return '已停止';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return status || '未知';
}

function controlLabel(eventType: string): string {
  if (eventType === 'pause_run') return '暂停';
  if (eventType === 'resume_run') return '恢复';
  if (eventType === 'stop_run') return '停止';
  if (eventType === 'retry_from_checkpoint') return '从 checkpoint 重试';
  if (eventType === 'permission_approved') return '权限已批准';
  if (eventType === 'permission_denied') return '权限已拒绝';
  return eventType;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return optionalRecord(value) ?? {};
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}
