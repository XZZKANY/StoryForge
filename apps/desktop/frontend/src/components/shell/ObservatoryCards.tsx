/** 观测镜「伏笔账」「实体」两个分区的卡片。 */
import { useState } from 'react';

import { Check, ChevronDown, ChevronRight } from '../icons/shell-icons';
import type {
  ObservationAnchor,
  ObservatoryEntity,
  ObservatoryPromise,
} from '../../lib/observations';
import type { Observation } from './ObsPanel';
import { Button, PlainButton } from '../ui';

function chapterSpan(entity: ObservatoryEntity): string {
  if (entity.appearanceMissing || entity.firstChapter == null) return '未在正文出现';
  if (entity.firstChapter === entity.lastChapter) return `第 ${entity.firstChapter} 章`;
  return `第 ${entity.firstChapter}–${entity.lastChapter} 章`;
}

export function PromiseCard({
  promise,
  onResolve,
  busy = false,
}: {
  promise: ObservatoryPromise;
  onResolve?: (promise: ObservatoryPromise) => void;
  busy?: boolean;
}) {
  const resolved = promise.status === 'resolved';
  const overdue = promise.issues.some((issue) => issue.category === 'overdue');
  const statusLabel = resolved
    ? `已回收${promise.resolvedChapter != null ? ` · 第 ${promise.resolvedChapter} 章` : ''}`
    : promise.status === 'advancing'
      ? '推进中'
      : promise.status === 'planted'
        ? '已埋设'
        : (promise.status ?? '状态未声明');
  return (
    <div
      className={`rounded-md border bg-surface px-2.5 py-2 ${overdue ? 'border-warning/60' : 'border-border'}`}
      data-testid="promise-card"
      data-status={promise.status ?? 'unknown'}
      data-overdue={overdue ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2 text-xs">
        {resolved ? (
          <Check size={12} strokeWidth={2} className="flex-shrink-0 text-success" />
        ) : (
          <span
            className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${overdue ? 'bg-warning' : 'bg-agent'}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{promise.title}</span>
        <span className="flex-shrink-0 font-mono text-3xs text-subtle">{statusLabel}</span>
        {!resolved && onResolve && (
          <Button
            onClick={() => onResolve(promise)}
            disabled={busy}
            size="compact"
            title="写进 canon.json：状态改成已回收、记下回收章（先存快照，可撤销）"
            data-testid="promise-resolve"
          >
            标为已回收
          </Button>
        )}
      </div>
      <div className="mt-1 text-2xs text-muted">
        {promise.plantedChapter != null && `埋设 第 ${promise.plantedChapter} 章`}
        {promise.dueChapter != null && ` · 截止 第 ${promise.dueChapter} 章`}
        {!resolved &&
          promise.lastTouchChapter != null &&
          ` · 最近推进 第 ${promise.lastTouchChapter} 章`}
      </div>
      {promise.issues.map((issue, index) => (
        <div
          key={issue.id ?? index}
          className={`mt-1 text-2xs leading-relaxed ${issue.severity === 'blocking' ? 'text-error' : 'text-warning'}`}
        >
          {issue.message}
        </div>
      ))}
    </div>
  );
}

export function EntityCard({
  entity,
  lit,
  observationById,
  onLocateObservation,
  onLocateAnchor,
}: {
  entity: ObservatoryEntity;
  lit: boolean;
  observationById: Map<string, Observation>;
  onLocateObservation?: (observation: Observation) => void;
  onLocateAnchor?: (anchor: ObservationAnchor) => void;
}) {
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const related = entity.relatedObservationIds
    .map((id) => observationById.get(id))
    .filter((observation): observation is Observation =>
      Boolean(observation && !observation.resolved),
    );
  const hasBlocking = related.some((observation) => observation.severity === 'error');
  // 描边优先级：blocking 红 > advisory 黄 > 光标联动紫（联动只是注意力提示，让位于真信号）。
  const borderClass = hasBlocking
    ? 'border-error/60'
    : related.length > 0
      ? 'border-warning/50'
      : lit
        ? 'border-agent/70'
        : 'border-border';
  return (
    <div
      className={`rounded-md border bg-surface px-2.5 py-2 ${borderClass}`}
      data-testid="entity-card"
      data-entity-id={entity.id}
      data-conflict={hasBlocking ? 'true' : 'false'}
      data-lit={lit ? 'true' : 'false'}
    >
      <div className="flex items-baseline gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {entity.canonicalName}
          {entity.kind && <span className="ml-1 font-normal text-subtle">（{entity.kind}）</span>}
        </span>
        <span className="flex-shrink-0 font-mono text-3xs text-subtle">{chapterSpan(entity)}</span>
      </div>
      {entity.aliases.length > 0 && (
        <div className="mt-1 text-2xs text-muted">别名：{entity.aliases.join('、')}</div>
      )}
      {entity.holdings.map((holding) => (
        <div key={holding.item} className="mt-1 text-2xs text-muted">
          持有：{holding.item}
          {holding.fromChapter != null &&
            `（第 ${holding.fromChapter} 章起${holding.toChapter != null ? `至第 ${holding.toChapter} 章` : ''}）`}
        </div>
      ))}
      {entity.lifespan && (
        <div className="mt-1 text-2xs text-muted">
          生命期：第 {entity.lifespan.exitsAfterChapter} 章后退场
          {entity.lifespan.reason ? `（${entity.lifespan.reason}）` : ''}
        </div>
      )}
      {related.map((observation) => (
        <PlainButton
          key={observation.id}
          className={`mt-1.5 block w-full rounded-sm border px-2 py-1 text-left text-2xs leading-relaxed ${
            observation.severity === 'error'
              ? 'border-error/40 bg-error/10 text-error'
              : 'border-warning/40 bg-warning/10 text-warning'
          } ${observation.anchor && onLocateObservation ? 'cursor-pointer' : ''}`}
          onClick={
            observation.anchor && onLocateObservation
              ? () => onLocateObservation(observation)
              : undefined
          }
          data-testid="entity-related-observation"
        >
          {observation.title}
        </PlainButton>
      ))}
      {entity.provenance.length > 0 && (
        <PlainButton
          className="mt-1.5 flex items-center gap-1 text-3xs text-subtle hover:text-foreground"
          onClick={() => setProvenanceOpen((value) => !value)}
          data-testid="entity-provenance-toggle"
        >
          {provenanceOpen ? (
            <ChevronDown size={10} strokeWidth={1.7} />
          ) : (
            <ChevronRight size={10} strokeWidth={1.7} />
          )}
          出现 {entity.totalCount} 处
        </PlainButton>
      )}
      {provenanceOpen &&
        entity.provenance.map((occurrence) => (
          <PlainButton
            key={`${occurrence.path}-${occurrence.firstLine ?? 0}`}
            className="mt-0.5 block w-full truncate text-left font-mono text-3xs text-subtle hover:text-foreground"
            onClick={
              onLocateAnchor
                ? () =>
                    onLocateAnchor({
                      path: occurrence.path,
                      line: occurrence.firstLine ?? undefined,
                    })
                : undefined
            }
            data-testid="entity-provenance-row"
          >
            {occurrence.chapter != null ? `第 ${occurrence.chapter} 章 ` : ''}
            {occurrence.path}
            {occurrence.firstLine != null ? `:${occurrence.firstLine}` : ''}
            {occurrence.count != null ? `（${occurrence.count} 处）` : ''}
          </PlainButton>
        ))}
      {provenanceOpen && entity.provenanceTruncated && (
        <div className="mt-0.5 text-3xs text-subtle">…仅列前 20 处</div>
      )}
    </div>
  );
}
