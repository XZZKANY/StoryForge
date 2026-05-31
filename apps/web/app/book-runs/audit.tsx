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

type SkillChainChapter = {
  readonly chapterIndex: string;
  readonly skills: readonly Record<string, unknown>[];
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
      <SkillChainSummary bookRun={bookRun} />
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

function SkillChainSummary({ bookRun }: { readonly bookRun: BookRunRead }) {
  const skillChain = findSkillChain(bookRun);
  const chapters = skillChainChapters(skillChain);
  const events = asRecordArray(skillChain?.events);
  if (!skillChain && chapters.length === 0 && events.length === 0) {
    return (
      <section aria-labelledby="skill-chain-audit-title">
        <h3 id="skill-chain-audit-title">技能链审计</h3>
        <p>暂无技能链审计数据。</p>
      </section>
    );
  }

  const summary = asRecord(skillChain?.summary);
  return (
    <section aria-labelledby="skill-chain-audit-title">
      <h3 id="skill-chain-audit-title">技能链审计</h3>
      <dl>
        <dt>Schema</dt>
        <dd>
          {formatEvidenceValue(skillChain?.schema_version ?? skillChain?.skill_chain_version)}
        </dd>
        <dt>状态</dt>
        <dd>{formatEvidenceValue(skillChain?.status)}</dd>
        <dt>事件数</dt>
        <dd>{formatEvidenceValue(summary?.event_count)}</dd>
        <dt>完成章节</dt>
        <dd>{formatEvidenceValue(summary?.completed_chapter_count)}</dd>
        <dt>证据来源</dt>
        <dd>{formatEvidenceValue(summary?.evidence_basis)}</dd>
      </dl>
      {chapters.length > 0 ? (
        <ol>
          {chapters.map((chapter) => (
            <li key={chapter.chapterIndex}>
              <h4>章节 {chapter.chapterIndex}</h4>
              <ul>
                {chapter.skills.map((skill, index) => (
                  <li key={`${formatEvidenceValue(skill.skill_name)}-${index}`}>
                    {formatEvidenceValue(skill.skill_name)}：状态=
                    {formatEvidenceValue(skill.status)}
                    <SkillRef field="model_run_id" skill={skill} />
                    <SkillRef field="judge_report_id" skill={skill} />
                    <SkillRef field="repair_patch_id" skill={skill} />
                    <SkillRef field="approved_scene_id" skill={skill} />
                    <SkillRef field="memory_atom_ids" skill={skill} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : events.length > 0 ? (
        <ol>
          {events.map((event, index) => (
            <SkillChainEvent event={event} index={index} key={skillEventKey(event, index)} />
          ))}
        </ol>
      ) : (
        <p>暂无技能链审计数据。</p>
      )}
    </section>
  );
}

function findSkillChain(bookRun: BookRunRead): Record<string, unknown> | null {
  const topLevel = asRecord(bookRun.skill_chain);
  if (topLevel) return topLevel;
  const progress = bookRun.progress;
  const direct = asRecord(progress.skill_chain);
  if (direct) return direct;
  const auditReport = asRecord(progress.audit_report);
  return auditReport ? asRecord(auditReport.skill_chain) : null;
}

function skillChainChapters(
  skillChain: Record<string, unknown> | null,
): readonly SkillChainChapter[] {
  const chapters = asRecordArray(skillChain?.chapters);
  return chapters.map((chapter) => ({
    chapterIndex: formatEvidenceValue(chapter.chapter_index),
    skills: asRecordArray(chapter.skills),
  }));
}

function SkillRef({
  field,
  skill,
}: {
  readonly field: string;
  readonly skill: Record<string, unknown>;
}) {
  const value = skill[field];
  if (value === undefined || value === null) return null;
  const rendered = Array.isArray(value) ? value.join(',') : formatEvidenceValue(value);
  if (!rendered) return null;
  return (
    <>
      {' '}
      {field}={rendered}
    </>
  );
}

function SkillChainEvent({
  event,
  index,
}: {
  readonly event: Record<string, unknown>;
  readonly index: number;
}) {
  return (
    <li>
      <h4>
        {index + 1}. {formatEvidenceValue(event.skill_name)}
      </h4>
      <p>
        stage={formatEvidenceValue(event.stage)} / status={formatEvidenceValue(event.status)} /
        provenance={formatEvidenceValue(event.provenance)} / 证据=
        {formatRecordedLabel(event.recorded)}
      </p>
      <ReferenceList title="输入引用" refs={asRecord(event.input_refs)} />
      <ReferenceList title="输出引用" refs={asRecord(event.output_refs)} />
      <ReferenceList title="元数据" refs={asRecord(event.metadata)} />
    </li>
  );
}

function ReferenceList({
  title,
  refs,
}: {
  readonly title: string;
  readonly refs: Record<string, unknown> | null;
}) {
  const entries = Object.entries(refs ?? {});
  if (entries.length === 0) return null;
  return (
    <dl>
      <dt>{title}</dt>
      <dd>
        <ul>
          {entries.map(([key, value]) => (
            <li key={key}>
              {key}={formatReferenceValue(value)}
            </li>
          ))}
        </ul>
      </dd>
    </dl>
  );
}

function skillEventKey(event: Record<string, unknown>, index: number): string {
  return [
    index,
    formatEvidenceValue(event.skill_name),
    formatEvidenceValue(event.stage),
    formatEvidenceValue(event.status),
  ].join(':');
}

function formatReferenceValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatReferenceValue).join(', ');
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record)
      .map(([key, item]) => `${key}:${formatReferenceValue(item)}`)
      .join(', ');
  }
  return '未记录';
}

function formatRecordedLabel(value: unknown): string {
  if (value === true) return '实录';
  if (value === false) return '重建';
  return '未记录';
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
