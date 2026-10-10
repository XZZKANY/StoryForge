import type { AgentRunSavePointProjection } from '../../lib/api-client';
import type { AgentRunStatus } from './types';

export type AgentRunRecoveryTone = 'neutral' | 'ok' | 'waiting' | 'error';

export type CheckpointResumeDisplay = {
  canResume: boolean;
  awaitingSettlement?: boolean;
  message: string;
  artifactId: number | null;
};

export type AgentRunRecoveryDisplay = {
  statusText: string;
  resumeText: string;
  pendingText: string | null;
  latestControlText: string | null;
  boundaryText: string | null;
  checkpointText: string | null;
  tone: AgentRunRecoveryTone;
  manualRestartRequired: boolean;
  checkpointResume?: CheckpointResumeDisplay;
};

/**
 * 是否展示「暂停 / 等待权限 / 最近边界」恢复卡片。
 * 终态里 completed（已完成 / 修订已接受）与 stopped（已停止）没有恢复决策可做，
 * 此时旧快照是过期噪声（#11：AI 修订接受后卡片常驻）；failed / paused / waiting / running
 * 仍需展示（给恢复 / 确认 / 进度信息）。快照本身为空时也不展示。
 */
export function shouldShowAgentRunRecovery(
  status: AgentRunStatus,
  recovery: AgentRunRecoveryDisplay | null,
): boolean {
  if (!recovery) return false;
  return status !== 'completed' && status !== 'stopped';
}

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

  const strategy = stringField(recoverability, 'resume_strategy');
  // Existing permission / ChapterBrief waits own their own resume protocol.
  const checkpointResume =
    strategy === 'continue_checkpoint' ||
    strategy === 'reconciliation_required' ||
    strategy === 'await_settlement' ||
    (projection.current_step === 'runtime.recovery' && projection.status === 'paused')
      ? checkpointResumeFromDiagnostic({
          ...recordFrom(runtimeRecovery.checkpoint_resume),
          kind: 'runtime_checkpoint_resume',
          can_resume:
            recoverability.can_resume === true &&
            recordFrom(runtimeRecovery.checkpoint_resume).can_resume === true,
          resume_strategy: strategy,
        })
      : null;
  const manualRestartRequired =
    !checkpointResume &&
    (booleanField(runtimeRecovery, 'manual_restart_required') === true ||
      projection.status === 'failed');
  const resumeStrategy = stringField(recoverability, 'resume_strategy') ?? 'none';
  const checkpointText =
    checkpointResume && checkpointResume.artifactId !== null
      ? `安全检查点 · #${checkpointResume.artifactId}`
      : null;
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
    resumeText:
      checkpointResume?.message ??
      resumeStrategyText({
        strategy: resumeStrategy,
        manualRestartRequired,
      }),
    pendingText,
    latestControlText: controlText(latestControl),
    boundaryText,
    checkpointText,
    tone: checkpointResume
      ? 'waiting'
      : toneFor({
          status: projection.status,
          pendingText,
          manualRestartRequired,
        }),
    manualRestartRequired,
    ...(checkpointResume ? { checkpointResume } : {}),
  };
}

/** One UI projection for the savepoint and resume ACK; never authorizes replay by status alone. */
export function checkpointResumeFromDiagnostic(
  diagnostic: Record<string, unknown>,
): CheckpointResumeDisplay | null {
  const strategy = stringField(diagnostic, 'resume_strategy');
  if (
    diagnostic.kind !== 'runtime_checkpoint_resume' &&
    strategy !== 'continue_checkpoint' &&
    strategy !== 'reconciliation_required' &&
    strategy !== 'await_settlement'
  )
    return null;
  const canResume =
    diagnostic.can_resume === true &&
    strategy === 'continue_checkpoint' &&
    diagnostic.resume_via_control_channel !== false;
  const awaitingSettlement = strategy === 'await_settlement';
  const reason = checkpointReasonLabel(stringField(diagnostic, 'reason'));
  return {
    canResume,
    ...(awaitingSettlement ? { awaitingSettlement: true } : {}),
    artifactId: numberField(diagnostic, 'artifact_id'),
    message: awaitingSettlement
      ? '恢复：当前操作尚未结束，等待执行结算；不会重放本轮。'
      : canResume
        ? '恢复：可从安全检查点继续本轮（同一运行）'
        : `恢复：需要先核对${reason}；不会自动重放，请核对已有结果、文件与版本记录。`,
  };
}

export function recoveryDisplayFromCheckpoint(
  checkpointResume: CheckpointResumeDisplay,
): AgentRunRecoveryDisplay {
  return {
    statusText: '状态：暂停',
    resumeText: checkpointResume.message,
    pendingText: null,
    latestControlText: null,
    boundaryText: null,
    checkpointText:
      checkpointResume.artifactId !== null ? `安全检查点 · #${checkpointResume.artifactId}` : null,
    tone: 'waiting',
    manualRestartRequired: false,
    checkpointResume,
  };
}

function checkpointReasonLabel(reason: string | null): string {
  if (reason === 'tool_outcome_unknown') return '工具调用结果（当前未知）';
  if (reason === 'model_outcome_unknown') return '模型请求结果（当前未知）';
  if (reason === 'source_version_changed') return '源文件版本变化';
  if (reason === 'permission_snapshot_changed') return '权限变化';
  if (reason === 'tool_policy_changed') return '工具策略变化';
  if (reason === 'terminal_checkpoint_requires_delivery_reconciliation')
    return '已执行结果的交付状态';
  if (reason === 'provider_continuation_unavailable') return '模型续接状态（当前不可用）';
  if (reason === 'checkpoint_content_redacted') return '检查点内容（已脱敏，不能重放）';
  if (reason === 'checkpoint_identity_mismatch') return '检查点归属';
  if (reason === 'checkpoint_digest_mismatch' || reason === 'invalid_checkpoint')
    return '检查点完整性';
  if (reason === 'missing_resume_context') return '缺失的恢复上下文';
  return '本轮执行状态';
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
    parts.push(`有待你确认的修订（#${proposedPatchId}）`);
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
    const pendingTool = stringField(latestResolution, 'pending_tool') ?? '待恢复的步骤';
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

function resumeStrategyText({
  strategy,
  manualRestartRequired,
}: {
  strategy: string;
  manualRestartRequired: boolean;
}): string {
  if (manualRestartRequired) return '恢复：需要手动重启本轮';
  if (strategy === 'await_permission_decision') return '恢复：等待你确认';
  if (strategy === 'stopped_by_user') return '恢复：已由你停止';
  if (strategy && strategy !== 'none') return `恢复：${strategy}`;
  return '恢复：暂无待处理事项';
}

function controlText(control: Record<string, unknown> | null): string | null {
  if (!control) return null;
  const eventType = stringField(control, 'event_type') ?? stringField(control, 'control_type');
  if (!eventType) return null;
  return `最近操作：${controlLabel(eventType)}`;
}

function toneFor({
  status,
  pendingText,
  manualRestartRequired,
}: {
  status: string;
  pendingText: string | null;
  manualRestartRequired: boolean;
}): AgentRunRecoveryTone {
  if (manualRestartRequired || status === 'failed') return 'error';
  if (pendingText || status === 'paused') return 'waiting';
  if (status === 'completed') return 'ok';
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
  if (eventType === 'retry_from_checkpoint') return '从检查点重试';
  if (eventType === 'permission_approved') return '已批准';
  if (eventType === 'permission_denied') return '已拒绝';
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
