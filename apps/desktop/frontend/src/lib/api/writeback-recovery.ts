import { decodeExternalWriteback, requestWriteback } from './external-writeback';
import type { ApiConfig } from './types';
import type {
  WritebackRecovery,
  WritebackRecovered,
  WritebackRecoveryList,
} from './managed-agent-host';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('恢复响应格式无效');
  return value as Record<string, unknown>;
}

export async function listWritebackRecovery(config: ApiConfig, project: string, afterId = 0) {
  const fields = object(
    await requestWriteback(
      config,
      `/writeback-recovery?project_path=${encodeURIComponent(project)}&after_id=${afterId}&limit=20`,
    ),
  );
  if (
    !Array.isArray(fields.items) ||
    fields.items.length > 20 ||
    !(fields.next_after_id === null || Number.isSafeInteger(fields.next_after_id))
  )
    throw new Error('恢复列表无效');
  for (const item of fields.items) {
    const row = object(item);
    if (
      typeof row.run_id !== 'string' ||
      typeof row.session_id !== 'string' ||
      typeof row.run_status !== 'string' ||
      !(row.wait_id === null || typeof row.wait_id === 'string') ||
      !(
        row.revision === null ||
        (Number.isSafeInteger(row.revision) && Number(row.revision) > 0)
      ) ||
      !Number.isSafeInteger(row.event_sequence) ||
      Number(row.event_sequence) < 0 ||
      typeof row.historical_applied !== 'boolean' ||
      !(row.blocked_reason === null || typeof row.blocked_reason === 'string')
    )
      throw new Error('恢复待办字段无效');
  }
  return fields as WritebackRecoveryList;
}

export async function recoverWriteback(
  config: ApiConfig,
  runId: string,
  waitId: string,
  body: WritebackRecovery,
) {
  const fields = object(
    await requestWriteback(
      config,
      `/${encodeURIComponent(runId)}/writeback/${encodeURIComponent(waitId)}/recover`,
      body,
    ),
  );
  decodeExternalWriteback(fields.writeback);
  if (
    !['await_confirmation', 'continue_verified', 'audit_required'].includes(String(fields.mode)) ||
    !(fields.mode === 'audit_required'
      ? fields.execution_epoch === null
      : typeof fields.execution_epoch === 'string' && /^[a-f0-9]{32}$/.test(fields.execution_epoch))
  )
    throw new Error('恢复资格无效，已禁止派发');
  return fields as WritebackRecovered;
}
