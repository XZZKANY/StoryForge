import type { AssistantToolNode, AssistantToolStatus } from './assistant-types';

export type AssistantBookRun = {
  readonly id: number;
  readonly blueprint_id: number;
  readonly status: string;
  readonly current_chapter_index: number;
  readonly total_chapters: number;
  readonly progress: Record<string, unknown>;
  readonly checkpoint: readonly Record<string, unknown>[];
  readonly token_budget: number | null;
  readonly tokens_used: number;
  readonly time_budget_sec: number | null;
  readonly elapsed_time_sec: number;
  readonly chapter_budget: number | null;
  readonly estimated_cost: number;
  readonly cost_summary: Record<string, unknown>;
};

export function mapBookRunToAssistantToolNodes(bookRun: AssistantBookRun): AssistantToolNode[] {
  const providerAvailable = isProviderAvailable(bookRun);
  const chapterStatus = mapChapterStatus(bookRun.status);
  const reviewStatus = mapReviewStatus(bookRun.status);
  const repairStatus = mapRepairStatus(bookRun.status);
  const auditExport = findAuditExportEvidence(bookRun.progress);
  const exportStatus: AssistantToolStatus = auditExport ? 'completed' : 'waiting';
  const effectiveChapterStatus = providerAvailable ? chapterStatus : 'failed';

  return [
    {
      id: `book-run-${bookRun.id}-provider`,
      label: '解析 Provider',
      tool: 'Provider.resolve',
      status: providerAvailable ? 'completed' : 'failed',
      summary: providerSummary(bookRun),
    },
    {
      id: `book-run-${bookRun.id}-blueprint`,
      label: '创建 Blueprint',
      tool: 'Blueprint.create',
      status: 'completed',
      summary: `Blueprint #${bookRun.blueprint_id} 已关联 BookRun #${bookRun.id}。`,
    },
    {
      id: `book-run-${bookRun.id}-chapter`,
      label: '生成章节正文',
      tool: 'Chapter.generate',
      status: effectiveChapterStatus,
      elapsedLabel: `${bookRun.elapsed_time_sec}s`,
      tokenLabel: formatTokenLabel(bookRun),
      toolUseLabel: formatBudgetLabel(bookRun),
      summary: providerAvailable
        ? chapterSummary(bookRun, effectiveChapterStatus)
        : 'Provider 不可用，章节生成不会进入运行或完成状态。',
    },
    {
      id: `book-run-${bookRun.id}-judge`,
      label: 'Judge 质量审阅',
      tool: 'Judge.review',
      status: reviewStatus,
      summary: reviewSummary(bookRun),
    },
    {
      id: `book-run-${bookRun.id}-repair`,
      label: '修复建议',
      tool: 'Repair.suggest',
      status: repairStatus,
      summary: repairSummary(bookRun),
    },
    {
      id: `book-run-${bookRun.id}-export`,
      label: '导出制品',
      tool: 'Artifact.export',
      status: exportStatus,
      summary: exportSummary(bookRun, auditExport),
    },
  ];
}

function providerSummary(bookRun: AssistantBookRun): string {
  const resolution = bookRun.progress.provider_resolution;
  if (isRecord(resolution) && resolution.ok === false) {
    const reason = resolution.unavailable_reason ?? resolution.message ?? 'Provider 不可用';
    return typeof reason === 'string' && reason.trim()
      ? `Provider 不可用：${reason}。`
      : 'Provider 不可用。';
  }
  if (isRecord(resolution)) {
    const providerName = resolution.provider_name ?? resolution.provider;
    if (typeof providerName === 'string' && providerName.trim()) {
      return `Provider 已解析：${providerName}。`;
    }
  }
  return 'Provider 已通过当前运行配置解析。';
}

function isProviderAvailable(bookRun: AssistantBookRun): boolean {
  const resolution = bookRun.progress.provider_resolution;
  return !(isRecord(resolution) && resolution.ok === false);
}

function mapChapterStatus(status: string): AssistantToolStatus {
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  if (status === 'awaiting_review') return 'completed';
  if (status.includes('paused') || status === 'failed' || status === 'stopped') return 'failed';
  return 'waiting';
}

function mapReviewStatus(status: string): AssistantToolStatus {
  if (status === 'awaiting_review') return 'needs_approval';
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'waiting';
  if (status.includes('paused') || status === 'failed') return 'waiting';
  return 'waiting';
}

function mapRepairStatus(status: string): AssistantToolStatus {
  if (status === 'awaiting_review') return 'needs_approval';
  if (status === 'completed') return 'completed';
  if (status.includes('paused') || status === 'failed') return 'waiting';
  return 'waiting';
}

function chapterSummary(bookRun: AssistantBookRun, status: AssistantToolStatus): string {
  const reason = status === 'failed' ? failureReason(bookRun) : undefined;
  if (reason)
    return `BookRun 在第 ${bookRun.current_chapter_index}/${bookRun.total_chapters} 章暂停：${reason}。`;
  if (status === 'completed')
    return `已完成 ${completedChapterCount(bookRun)} / ${bookRun.total_chapters} 章。`;
  if (status === 'running')
    return `正在生成第 ${bookRun.current_chapter_index}/${bookRun.total_chapters} 章。`;
  return `等待生成第 ${bookRun.current_chapter_index}/${bookRun.total_chapters} 章。`;
}

function reviewSummary(bookRun: AssistantBookRun): string {
  const blocked = bookRun.progress.blocked_chapter;
  if (isRecord(blocked)) {
    return `第 ${blocked.chapter_index ?? bookRun.current_chapter_index} 章等待审阅批准。`;
  }
  return bookRun.status === 'completed'
    ? '质量审阅已随 BookRun 完成。'
    : '等待章节生成后发起质量审阅。';
}

function repairSummary(bookRun: AssistantBookRun): string {
  const blocked = bookRun.progress.blocked_chapter;
  if (isRecord(blocked) && blocked.repair_patch_id) {
    return `Repair Patch #${blocked.repair_patch_id} 等待批准写回。`;
  }
  return bookRun.status === 'completed'
    ? '修复链路已完成或无须修复。'
    : '等待 Judge 发现问题后生成修复建议。';
}

function exportSummary(
  bookRun: AssistantBookRun,
  auditExport: Record<string, unknown> | undefined,
): string {
  if (auditExport) {
    const name = readString(auditExport.name) ?? 'audit_report.json';
    const artifactId = readNumber(auditExport.artifact_id) ?? readNumber(auditExport.id);
    const artifactLabel = artifactId ? `Artifact #${artifactId}` : '审计报告制品';
    return `${name} 已导出为 ${artifactLabel}，可查看 Markdown、EPUB 和审计报告追溯链。`;
  }
  return bookRun.status === 'completed'
    ? 'BookRun 已完成，可导出 Markdown、EPUB 和审计报告。'
    : '等待 BookRun 完成后生成导出入口。';
}

function findAuditExportEvidence(
  progress: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const direct = asAuditExportRecord(progress.audit_report);
  if (direct) return direct;

  for (const key of ['exported_artifacts', 'artifact_exports']) {
    const artifacts = progress[key];
    if (!Array.isArray(artifacts)) continue;
    const match = artifacts.map(asAuditExportRecord).find((artifact) => artifact !== undefined);
    if (match) return match;
  }
  return undefined;
}

function asAuditExportRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const name = readString(value.name);
  const artifactType = readString(value.artifact_type) ?? readString(value.type);
  if (
    name === 'audit_report.json' ||
    artifactType === 'book_audit_report' ||
    isRecord(value.skill_chain)
  ) {
    return value;
  }
  return undefined;
}

function completedChapterCount(bookRun: AssistantBookRun): number {
  const completed = bookRun.progress.completed_chapters;
  return Array.isArray(completed) ? completed.length : bookRun.current_chapter_index;
}

function failureReason(bookRun: AssistantBookRun): string | undefined {
  for (const key of ['pause_reason', 'stop_reason', 'error_message']) {
    const value = bookRun.progress[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (bookRun.status === 'paused_by_budget') return '预算触顶';
  return undefined;
}

function formatTokenLabel(bookRun: AssistantBookRun): string | undefined {
  return bookRun.token_budget === null
    ? `${bookRun.tokens_used} tokens`
    : `${bookRun.tokens_used} / ${bookRun.token_budget} tokens`;
}

function formatBudgetLabel(bookRun: AssistantBookRun): string {
  const timeBudget =
    typeof bookRun.time_budget_sec === 'number'
      ? `${bookRun.elapsed_time_sec}/${bookRun.time_budget_sec}s`
      : `${bookRun.elapsed_time_sec}s`;
  const chapterBudget =
    typeof bookRun.chapter_budget === 'number'
      ? `${bookRun.current_chapter_index}/${bookRun.chapter_budget}`
      : `${bookRun.current_chapter_index}/${bookRun.total_chapters}`;
  return `时间 ${timeBudget} · 章节 ${chapterBudget} · 成本 ${bookRun.estimated_cost}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
