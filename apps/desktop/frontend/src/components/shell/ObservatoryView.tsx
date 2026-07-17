/**
 * 世界线观测镜：右栏第二视图（与对话 CSS 互斥，不卸载 ChatWindow）。
 * 四个可折叠分区——待确认提案 / 伏笔账 / 实体 / 检查器，数据全部来自
 * observatory.scan payload v2 的结构化台账（确定性、无 LLM）。
 *
 * 诚实边界：观测是参考信号不是质量判定；提案区本刀只读（并入 / 忽略是后续刀）；
 * 实体卡红描边只反映后端已判定的 blocking 观测，前端不自算结论。
 */
import { useState, type ReactNode } from 'react';

import { Check, ChevronDown, ChevronRight, Radar, RefreshCw, Sparkles } from '../icons/shell-icons';
import type {
  ObservationAnchor,
  ObservatoryChecker,
  ObservatoryEntity,
  ObservatoryPromise,
  ObservatoryPromises,
  ObservatoryProposals,
} from '../../lib/observations';
import type { Observation, ObservationAvailability } from './ObsPanel';

const CHECKER_LABELS: Record<string, string> = {
  canon: 'canon 闸门',
  promise: '伏笔承诺账',
  prose: '文笔气味',
  consistency: '一致性观察',
  collapse: '场景承重',
  entity_budget: '实体预算',
  deep_consistency: '深度一致性',
};

const CLAIM_INVARIANT_LABELS: Record<string, string> = {
  single_holder: '唯一持有',
  lifespan: '生命期',
  timeline_order: '时间线',
};

function chapterSpan(entity: ObservatoryEntity): string {
  if (entity.appearanceMissing || entity.firstChapter == null) return '未在正文出现';
  if (entity.firstChapter === entity.lastChapter) return `第 ${entity.firstChapter} 章`;
  return `第 ${entity.firstChapter}–${entity.lastChapter} 章`;
}

function claimSummary(invariant: string, entry: Record<string, unknown>): string {
  if (invariant === 'single_holder') {
    return `「${String(entry.item ?? '?')}」由 ${String(entry.holder ?? '?')} 持有`;
  }
  if (invariant === 'lifespan') {
    return `${String(entry.entity ?? '?')} 第 ${String(entry.exits_after_chapter ?? '?')} 章后退场`;
  }
  if (invariant === 'timeline_order') {
    return `${String(entry.before ?? '?')} 早于 ${String(entry.after ?? '?')}`;
  }
  return JSON.stringify(entry);
}

function Section({
  title,
  count,
  testid,
  children,
}: {
  title: string;
  count?: number | null;
  testid: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border" data-testid={`obs-section-${testid}`}>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1.5 px-3 text-[11px] font-semibold tracking-[0.06em] text-subtle hover:bg-elevated hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        data-testid={`obs-section-toggle-${testid}`}
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={1.7} />
        ) : (
          <ChevronRight size={12} strokeWidth={1.7} />
        )}
        <span>{title}</span>
        {count != null && (
          <span className="rounded-full bg-elevated px-1.5 font-mono text-[10px]">{count}</span>
        )}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-subtle">{children}</p>;
}

function ProposalsSection({ proposals }: { proposals: ObservatoryProposals }) {
  return (
    <Section
      title="待确认提案"
      count={proposals.available ? proposals.pendingCount : null}
      testid="proposals"
    >
      {!proposals.available ? (
        <EmptyLine>暂无提案草稿——由对话内 Agent 的 canon_delta 工具生成。</EmptyLine>
      ) : proposals.pendingCount === 0 ? (
        <EmptyLine>无待确认提案。</EmptyLine>
      ) : (
        <>
          {proposals.newEntities.map((entity) => (
            <div
              key={entity.id}
              className="rounded-md border border-border bg-surface px-2.5 py-2"
              data-testid="proposal-card"
            >
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="font-medium text-foreground">{entity.canonicalName}</span>
                <span className="font-mono text-[10px] text-subtle">新实体</span>
              </div>
              {entity.aliases.length > 0 && (
                <div className="mt-1 text-[11px] text-muted">别名：{entity.aliases.join('、')}</div>
              )}
            </div>
          ))}
          {proposals.newClaims.map((claim, index) => (
            <div
              key={`${claim.invariant}-${index}`}
              className="rounded-md border border-border bg-surface px-2.5 py-2"
              data-testid="proposal-card"
            >
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {claimSummary(claim.invariant, claim.entry)}
                </span>
                <span className="flex-shrink-0 font-mono text-[10px] text-subtle">
                  {CLAIM_INVARIANT_LABELS[claim.invariant] ?? claim.invariant}声明
                </span>
              </div>
            </div>
          ))}
          <EmptyLine>并入 / 忽略操作后续接入；提案只是草稿，canon.json 未被改动。</EmptyLine>
        </>
      )}
    </Section>
  );
}

function PromiseCard({ promise }: { promise: ObservatoryPromise }) {
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
      <div className="flex items-center gap-2 text-[12px]">
        {resolved ? (
          <Check size={12} strokeWidth={2} className="flex-shrink-0 text-success" />
        ) : (
          <span
            className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${overdue ? 'bg-warning' : 'bg-agent'}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{promise.title}</span>
        <span className="flex-shrink-0 font-mono text-[10px] text-subtle">{statusLabel}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {promise.plantedChapter != null && `埋设 第 ${promise.plantedChapter} 章`}
        {promise.dueChapter != null && ` · 截止 第 ${promise.dueChapter} 章`}
        {!resolved &&
          promise.lastTouchChapter != null &&
          ` · 最近推进 第 ${promise.lastTouchChapter} 章`}
      </div>
      {promise.issues.map((issue, index) => (
        <div
          key={issue.id ?? index}
          className={`mt-1 text-[11px] leading-relaxed ${issue.severity === 'blocking' ? 'text-error' : 'text-warning'}`}
        >
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function EntityCard({
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
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {entity.canonicalName}
          {entity.kind && <span className="ml-1 font-normal text-subtle">（{entity.kind}）</span>}
        </span>
        <span className="flex-shrink-0 font-mono text-[10px] text-subtle">
          {chapterSpan(entity)}
        </span>
      </div>
      {entity.aliases.length > 0 && (
        <div className="mt-1 text-[11px] text-muted">别名：{entity.aliases.join('、')}</div>
      )}
      {entity.holdings.map((holding) => (
        <div key={holding.item} className="mt-1 text-[11px] text-muted">
          持有：{holding.item}
          {holding.fromChapter != null &&
            `（第 ${holding.fromChapter} 章起${holding.toChapter != null ? `至第 ${holding.toChapter} 章` : ''}）`}
        </div>
      ))}
      {entity.lifespan && (
        <div className="mt-1 text-[11px] text-muted">
          生命期：第 {entity.lifespan.exitsAfterChapter} 章后退场
          {entity.lifespan.reason ? `（${entity.lifespan.reason}）` : ''}
        </div>
      )}
      {related.map((observation) => (
        <button
          key={observation.id}
          type="button"
          className={`mt-1.5 block w-full rounded border px-2 py-1 text-left text-[11px] leading-relaxed ${
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
        </button>
      ))}
      {entity.provenance.length > 0 && (
        <button
          type="button"
          className="mt-1.5 flex items-center gap-1 text-[10.5px] text-subtle hover:text-foreground"
          onClick={() => setProvenanceOpen((value) => !value)}
          data-testid="entity-provenance-toggle"
        >
          {provenanceOpen ? (
            <ChevronDown size={10} strokeWidth={1.7} />
          ) : (
            <ChevronRight size={10} strokeWidth={1.7} />
          )}
          出现 {entity.totalCount} 处
        </button>
      )}
      {provenanceOpen &&
        entity.provenance.map((occurrence) => (
          <button
            key={`${occurrence.path}-${occurrence.firstLine ?? 0}`}
            type="button"
            className="mt-0.5 block w-full truncate text-left font-mono text-[10px] text-subtle hover:text-foreground"
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
          </button>
        ))}
      {provenanceOpen && entity.provenanceTruncated && (
        <div className="mt-0.5 text-[10px] text-subtle">…仅列前 20 处</div>
      )}
    </div>
  );
}

function CheckerRow({ checker }: { checker: ObservatoryChecker }) {
  const label = CHECKER_LABELS[checker.key] ?? checker.tool;
  const ran = checker.status === 'ran';
  const isLLM = checker.key === 'deep_consistency';
  const counts = ran
    ? ['conflict_count', 'advisory_count', 'issue_count']
        .map((field) => (typeof checker[field] === 'number' ? `${checker[field]}` : null))
        .filter((value): value is string => value !== null)
        .join(' / ')
    : '';
  return (
    <div
      className="flex items-center gap-2 py-1 text-[11px]"
      data-testid="checker-row"
      data-checker={checker.key}
      title={typeof checker.reason === 'string' ? checker.reason : checker.tool}
    >
      <span
        className={`h-[6px] w-[6px] flex-shrink-0 rounded-full ${ran ? 'bg-success' : 'bg-border-strong'}`}
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      {counts && <span className="flex-shrink-0 font-mono text-[10px] text-subtle">{counts}</span>}
      <span className="flex-shrink-0 font-mono text-[10px] text-subtle">
        {ran ? '确定性 · 保存时' : isLLM ? 'LLM · 按需' : '按需'}
      </span>
    </div>
  );
}

export function ObservatoryView({
  availability,
  observations,
  checkers,
  entities,
  promises,
  proposals,
  generatedAt,
  litEntityIds = [],
  onRescan,
  onBackToChat,
  onLocateObservation,
  onLocateAnchor,
}: {
  availability: ObservationAvailability;
  observations: Observation[];
  checkers: ObservatoryChecker[];
  entities: ObservatoryEntity[];
  promises: ObservatoryPromises;
  proposals: ObservatoryProposals;
  generatedAt: string | null;
  litEntityIds?: string[];
  onRescan: () => void;
  onBackToChat: () => void;
  onLocateObservation?: (observation: Observation) => void;
  onLocateAnchor?: (anchor: ObservationAnchor) => void;
}) {
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const statusLabel =
    availability === 'loading'
      ? '扫描中…'
      : availability === 'error'
        ? '扫描失败'
        : availability === 'available' && generatedAt
          ? `上次扫描 ${generatedAt.slice(11, 16)}`
          : '';
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="observatory-view"
    >
      <header
        className="flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border bg-panel px-3 pr-2"
        data-testid="observatory-header"
      >
        <Radar size={14} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          世界线观测镜
        </span>
        {statusLabel && (
          <span className="flex-shrink-0 font-mono text-[10px] text-subtle">{statusLabel}</span>
        )}
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="重新扫描（确定性 · 无 LLM）"
          onClick={onRescan}
          data-testid="observatory-rescan"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.6}
            className={availability === 'loading' ? 'animate-spin' : ''}
          />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="回到对话 · Ctrl+4"
          onClick={onBackToChat}
          data-testid="observatory-back-to-chat"
        >
          <Sparkles size={14} strokeWidth={1.6} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {availability !== 'available' ? (
          <p className="px-4 py-4 text-[11px] leading-relaxed text-subtle">
            {availability === 'loading'
              ? '正在扫描项目观测数据。'
              : availability === 'error'
                ? '观测数据加载失败，请点击重新扫描。'
                : '观测尚未接线，当前没有可用于判断项目状态的数据。'}
          </p>
        ) : (
          <>
            <ProposalsSection proposals={proposals} />
            <Section title="伏笔账" count={promises.ledger.length} testid="promises">
              {promises.ledger.length === 0 ? (
                <EmptyLine>
                  canon.json 尚无伏笔承诺声明（invariants.promises）。
                  {promises.currentChapter != null && promises.currentChapter > 0
                    ? ` 正文已到第 ${promises.currentChapter} 章。`
                    : ''}
                </EmptyLine>
              ) : (
                <>
                  {promises.currentChapter != null && (
                    <div className="text-[10.5px] text-subtle">
                      正文已写到第 {promises.currentChapter} 章
                    </div>
                  )}
                  {promises.ledger.map((promise) => (
                    <PromiseCard key={promise.id} promise={promise} />
                  ))}
                </>
              )}
            </Section>
            <Section title="实体" count={entities.length} testid="entities">
              {entities.length === 0 ? (
                <EmptyLine>canon.json 尚无实体声明。</EmptyLine>
              ) : (
                entities.map((entity) => (
                  <EntityCard
                    key={entity.id}
                    entity={entity}
                    lit={litEntityIds.includes(entity.id)}
                    observationById={observationById}
                    onLocateObservation={onLocateObservation}
                    onLocateAnchor={onLocateAnchor}
                  />
                ))
              )}
            </Section>
            <Section title="检查器" count={checkers.length} testid="checkers">
              {checkers.length === 0 ? (
                <EmptyLine>暂无检查器信息。</EmptyLine>
              ) : (
                <div className="flex flex-col">
                  {checkers.map((checker) => (
                    <CheckerRow key={checker.key} checker={checker} />
                  ))}
                </div>
              )}
            </Section>
            <p className="px-3 py-3 text-[10.5px] leading-relaxed text-subtle">
              确定性参考信号（无 LLM）：advisory 需结合原文核实，不是质量判定。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
