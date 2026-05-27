import React from 'react';

import type { BookRunRead } from './api';

type AuditEvent = {
  readonly chapterIndex: string;
  readonly modelRunId: string;
  readonly judgeReportId: string;
  readonly repairPatchId: string;
  readonly approvedSceneId: string;
  readonly memoryExtractId: string;
};

export function BookRunAuditPanel({ bookRun }: { readonly bookRun: BookRunRead | null }) {
  if (!bookRun) {
    return (
      <section aria-labelledby="book-run-audit-title">
        <h2 id="book-run-audit-title">BookRun 审计</h2>
        <p>当前没有可展示的审计记录。</p>
      </section>
    );
  }

  const events = auditEvents(bookRun);
  return (
    <section aria-labelledby="book-run-audit-title">
      <h2 id="book-run-audit-title">BookRun 审计</h2>
      <p>
        BookRun #{bookRun.id} / Blueprint #{bookRun.blueprint_id}，状态：{bookRun.status}
      </p>
      {events.length > 0 ? (
        <ol>
          {events.map((event) => (
            <li key={event.chapterIndex}>
              <h3>章节 {event.chapterIndex}</h3>
              <ul>
                <EvidenceItem
                  action="generate"
                  field="model_run_id"
                  value={event.modelRunId}
                  href={evidenceHref('/runs', 'model_run_id', event.modelRunId)}
                />
                <EvidenceItem
                  action="judge"
                  field="judge_report_id"
                  value={event.judgeReportId}
                  href={evidenceHref('/evaluations', 'judge_report_id', event.judgeReportId)}
                />
                <EvidenceItem
                  action="repair"
                  field="repair_patch_id"
                  value={event.repairPatchId}
                  href={evidenceHref('/artifacts', 'repair_patch_id', event.repairPatchId)}
                />
                <EvidenceItem
                  action="approve"
                  field="approved_scene_id"
                  value={event.approvedSceneId}
                  href={evidenceHref('/studio', 'scene_id', event.approvedSceneId)}
                />
                <EvidenceItem
                  action="memory_extract"
                  field="memory_extract_id"
                  value={event.memoryExtractId}
                  href={evidenceHref('/worldbuilding', 'memory_atom_id', event.memoryExtractId)}
                />
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p>暂无章节证据事件。</p>
      )}
    </section>
  );
}

export function auditEvents(bookRun: BookRunRead): readonly AuditEvent[] {
  const completed = Array.isArray(bookRun.progress.completed_chapters)
    ? bookRun.progress.completed_chapters
    : [];
  return completed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      chapterIndex: formatEvidenceValue(item.chapter_index),
      modelRunId: formatEvidenceValue(item.model_run_id),
      judgeReportId: formatEvidenceValue(item.judge_report_id),
      repairPatchId: formatEvidenceValue(item.repair_patch_id),
      approvedSceneId: formatEvidenceValue(item.approved_scene_id),
      memoryExtractId: formatEvidenceValue(item.memory_extract_id),
    }));
}

function EvidenceItem({
  action,
  field,
  value,
  href,
}: {
  readonly action: string;
  readonly field: string;
  readonly value: string;
  readonly href: string | null;
}) {
  return (
    <li>
      {action}：{field}={href ? <a href={href}>{value}</a> : value}
    </li>
  );
}

function evidenceHref(path: string, queryKey: string, value: string): string | null {
  if (value === '未记录') return null;
  return `${path}?${queryKey}=${encodeURIComponent(value)}`;
}

function formatEvidenceValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '未记录';
}
