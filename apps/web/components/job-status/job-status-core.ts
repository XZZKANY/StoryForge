export type JobRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';

export type JobRunSnapshot = {
  readonly job_run_id: number;
  readonly status: JobRunStatus;
  readonly progress?: number | null;
  readonly current_node?: string | null;
  readonly error_summary?: string | null;
  readonly updated_at?: string | null;
};

export type JobRunPollOutcome =
  | { readonly status: 'ready'; readonly snapshot: JobRunSnapshot }
  | { readonly status: 'error'; readonly message: string };

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobRunStatus> = new Set(['completed', 'failed']);

export function isTerminalJobStatus(status: JobRunStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

const knownStatuses: ReadonlySet<JobRunStatus> = new Set([
  'queued',
  'running',
  'completed',
  'failed',
  'unknown',
]);

export function normalizeJobStatus(value: unknown): JobRunStatus {
  if (typeof value === 'string' && knownStatuses.has(value as JobRunStatus)) {
    return value as JobRunStatus;
  }
  return 'unknown';
}

export function parseJobRunSnapshot(value: unknown, fallbackId: number): JobRunSnapshot | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawId = record.job_run_id;
  const job_run_id =
    typeof rawId === 'number' && Number.isFinite(rawId) ? Math.trunc(rawId) : fallbackId;
  const status = normalizeJobStatus(record.status);
  const progress =
    typeof record.progress === 'number' && Number.isFinite(record.progress)
      ? record.progress
      : null;
  const current_node = typeof record.current_node === 'string' ? record.current_node : null;
  const error_summary = typeof record.error_summary === 'string' ? record.error_summary : null;
  const updated_at = typeof record.updated_at === 'string' ? record.updated_at : null;
  return { job_run_id, status, progress, current_node, error_summary, updated_at };
}

export function describeJobStatus(status: JobRunStatus): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '已失败';
  return '状态未知';
}
