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
      <QualitySummary progress={bookRun.progress} />
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

function QualitySummary({ progress }: { readonly progress: Record<string, unknown> }) {
  const summary = asRecord(progress.quality_summary);
  const chapterScores = asRecordArray(progress.chapter_quality_scores);
  const issues = asRecordArray(progress.top_quality_issues);
  const recommendations = Array.isArray(progress.manual_review_recommendations)
    ? progress.manual_review_recommendations.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  if (
    !summary &&
    chapterScores.length === 0 &&
    issues.length === 0 &&
    recommendations.length === 0
  ) {
    return (
      <section aria-labelledby="quality-summary-title">
        <h3 id="quality-summary-title">????</h3>
        <p>???????</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="quality-summary-title">
      <h3 id="quality-summary-title">????</h3>
      <dl>
        <dt>?????</dt>
        <dd>{formatEvidenceValue(summary?.average_score)}</dd>
        <dt>????</dt>
        <dd>{formatEvidenceValue(summary?.status)}</dd>
      </dl>
      {chapterScores.length > 0 ? (
        <ul>
          {chapterScores.map((score) => (
            <li key={formatEvidenceValue(score.chapter_index)}>
              ?? {formatEvidenceValue(score.chapter_index)}?
              {formatEvidenceValue(score.quality_score)}
            </li>
          ))}
        </ul>
      ) : null}
      {issues.length > 0 ? (
        <ul>
          {issues.map((issue, index) => (
            <li key={`${formatEvidenceValue(issue.chapter_index)}-${index}`}>
              ?? {formatEvidenceValue(issue.chapter_index)} / {formatEvidenceValue(issue.dimension)}{' '}
              /{formatEvidenceValue(issue.severity)}?{formatEvidenceValue(issue.message)}
            </li>
          ))}
        </ul>
      ) : null}
      {recommendations.length > 0 ? (
        <ul>
          {recommendations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
