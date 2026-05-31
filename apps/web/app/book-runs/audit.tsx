import React from 'react';

import type { BookRunRead } from './api';

type AuditEvent = {
  readonly chapterIndex: string;
  readonly modelRunId: string;
  readonly judgeReportId: string;
  readonly repairPatchId: string;
  readonly approvedSceneId: string;
  readonly memoryExtractId: string;
  readonly qualityScore: string;
  readonly qualityIssues: readonly QualityIssue[];
  readonly manualReviewRecommendation: string;
};

type QualityIssue = {
  readonly dimension: string;
  readonly severity: string;
  readonly message: string;
};

type QualitySummary = {
  readonly overall_quality_score?: number | null;
  readonly chapter_count?: number;
  readonly issue_count?: number;
  readonly severe_issue_count?: number;
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
      <QualitySummarySection bookRun={bookRun} />
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
                <li>章节质量分：{event.qualityScore}</li>
                {event.qualityIssues.map((issue) => (
                  <li key={`${event.chapterIndex}-${issue.dimension}-${issue.message}`}>
                    主要问题：{issue.dimension}（{issue.severity}）{issue.message}
                  </li>
                ))}
                {event.manualReviewRecommendation !== '未记录' ? (
                  <li>人工审查建议：{event.manualReviewRecommendation}</li>
                ) : null}
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
      qualityScore: formatEvidenceValue(item.quality_score),
      qualityIssues: qualityIssues(item.quality_issues),
      manualReviewRecommendation: formatEvidenceValue(item.manual_review_recommendation),
    }));
}

function QualitySummarySection({ bookRun }: { readonly bookRun: BookRunRead }) {
  const summary = qualitySummary(bookRun);
  if (!summary) {
    return <p>暂无质量摘要</p>;
  }
  return (
    <section aria-labelledby="book-run-quality-title">
      <h3 id="book-run-quality-title">质量摘要</h3>
      <dl>
        <div>
          <dt>综合质量分</dt>
          <dd>{formatEvidenceValue(summary.overall_quality_score)}</dd>
        </div>
        <div>
          <dt>章节数</dt>
          <dd>{formatEvidenceValue(summary.chapter_count)}</dd>
        </div>
        <div>
          <dt>主要问题</dt>
          <dd>{formatEvidenceValue(summary.issue_count)}</dd>
        </div>
        <div>
          <dt>严重问题</dt>
          <dd>{formatEvidenceValue(summary.severe_issue_count)}</dd>
        </div>
      </dl>
    </section>
  );
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

function qualitySummary(bookRun: BookRunRead): QualitySummary | null {
  const raw = (bookRun as unknown as { readonly quality_summary?: unknown }).quality_summary;
  if (raw && typeof raw === 'object') return raw as QualitySummary;
  const fromProgress = (bookRun.progress as { readonly quality_summary?: unknown }).quality_summary;
  if (fromProgress && typeof fromProgress === 'object') return fromProgress as QualitySummary;
  return null;
}

function qualityIssues(value: unknown): readonly QualityIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      dimension: formatEvidenceValue(item.dimension),
      severity: formatEvidenceValue(item.severity),
      message: formatEvidenceValue(item.message),
    }));
}

function evidenceHref(path: string, queryKey: string, value: string): string | null {
  if (value === '未记录') return null;
  return `${path}?${queryKey}=${encodeURIComponent(value)}`;
}

function formatEvidenceValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '未记录';
}
