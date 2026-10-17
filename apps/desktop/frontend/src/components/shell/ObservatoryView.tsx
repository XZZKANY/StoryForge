/**
 * 世界线观测镜：左栏第二视图（#13 从右栏迁来；与资源管理器 CSS 互斥不卸载）。
 * 四个可折叠分区——待确认提案 / 伏笔账 / 实体 / 检查器，数据全部来自
 * observatory.scan payload v2 的结构化台账（确定性、无 LLM）。
 *
 * 诚实边界：观测是参考信号不是质量判定；实体卡红描边只反映后端已判定的 blocking 观测，
 * 前端不自算结论。提案「并入」、伏笔「标为已回收」由作者点下后前端写 canon.json（后端绝不写
 * 作者项目文件），先确认、写前存快照、可撤销；「不要」只在本机记下不再摆出，不碰 canon.json。
 */
import { useState, type ReactNode } from 'react';

import { Check, ChevronDown, ChevronRight, FileText, Radar, RefreshCw } from '../icons/shell-icons';
import type { CanonMergeTarget } from '../../lib/canon-merge';
import type {
  ObservationAnchor,
  ObservatoryChecker,
  ObservatoryEntity,
  ObservatoryPromise,
  ObservatoryPromises,
  ObservatoryProposals,
} from '../../lib/observations';
import type { Observation, ObservationAvailability } from './ObsPanel';
import { LiveStatus } from './LiveStatus';

const CHECKER_LABELS: Record<string, string> = {
  canon: '设定检查',
  promise: '伏笔承诺账',
  prose: '文笔气味',
  consistency: '一致性观察',
  collapse: '场景承重',
  entity_budget: '实体预算',
  deep_consistency: '深度一致性',
};

/** 观测扫描时间按作者本地时区显示（此前直接切 ISO 串取 UTC，差 8 小时）；非法值兜底原串。 */
function formatScanTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CLAIM_INVARIANT_LABELS: Record<string, string> = {
  single_holder: '唯一持有',
  lifespan: '生命期',
  timeline_order: '时间线',
  promises: '伏笔',
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
  if (invariant === 'promises') {
    const due = entry.due_chapter == null ? '开放窗口' : `第 ${String(entry.due_chapter)} 章前兑现`;
    return `${String(entry.title ?? '?')}（第 ${String(entry.planted_chapter ?? '?')} 章埋下 · ${due}）`;
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
    <section className="mb-2" data-testid={`obs-section-${testid}`}>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1.5 px-3 text-2xs font-semibold tracking-[0.06em] text-subtle hover:bg-elevated hover:text-foreground"
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
          <span className="rounded-full bg-elevated px-1.5 font-mono text-3xs">{count}</span>
        )}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-2xs leading-relaxed text-subtle">{children}</p>;
}

function DismissButton({ onDismiss }: { onDismiss?: () => void }) {
  if (!onDismiss) return null;
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="flex-shrink-0 rounded-sm px-1.5 py-0.5 text-3xs text-subtle hover:bg-elevated hover:text-foreground"
      title="不再摆在这里（canon.json 不动，可撤销）"
      data-testid="proposal-dismiss"
    >
      不要
    </button>
  );
}

function MergeButton({ onMerge, busy }: { onMerge?: () => void; busy: boolean }) {
  if (!onMerge) return null;
  return (
    <button
      type="button"
      onClick={onMerge}
      disabled={busy}
      className="flex-shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-3xs text-muted hover:bg-elevated hover:text-foreground disabled:opacity-50"
      data-testid="proposal-merge"
    >
      并入
    </button>
  );
}

function ProposalsSection({
  proposals,
  onMergeProposal,
  onDismissProposal,
  merging = false,
}: {
  proposals: ObservatoryProposals;
  onMergeProposal?: (target: CanonMergeTarget, label: string) => void;
  onDismissProposal?: (target: CanonMergeTarget) => void;
  merging?: boolean;
}) {
  return (
    <Section
      title="待确认提案"
      count={proposals.available ? proposals.pendingCount : null}
      testid="proposals"
    >
      {!proposals.available ? (
        <EmptyLine>
          暂无待确认的设定变更。在对话里请 AI 核对本章设定，它提出的修改会先放在这里。
        </EmptyLine>
      ) : proposals.pendingCount === 0 ? (
        <EmptyLine>无待确认提案。</EmptyLine>
      ) : (
        <>
          {proposals.newEntities.map((entity) => {
            const target: CanonMergeTarget = { kind: 'entity', entity: entity.raw };
            const aliases =
              entity.aliases.length > 0 ? `（别名：${entity.aliases.join('、')}）` : '';
            const label = `新实体「${entity.canonicalName}」${aliases}`;
            return (
              <div
                key={entity.id}
                className="rounded-md border border-border bg-surface px-2.5 py-2"
                data-testid="proposal-card"
              >
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {entity.canonicalName}
                  </span>
                  <span className="flex-shrink-0 font-mono text-3xs text-subtle">新实体</span>
                  <DismissButton
                    onDismiss={onDismissProposal && (() => onDismissProposal(target))}
                  />
                  <MergeButton
                    busy={merging}
                    onMerge={onMergeProposal && (() => onMergeProposal(target, label))}
                  />
                </div>
                {entity.aliases.length > 0 && (
                  <div className="mt-1 text-2xs text-muted">别名：{entity.aliases.join('、')}</div>
                )}
              </div>
            );
          })}
          {proposals.newClaims.map((claim, index) => {
            const target: CanonMergeTarget = {
              kind: 'claim',
              invariant: claim.invariant,
              entry: claim.entry,
            };
            const kindLabel = `${CLAIM_INVARIANT_LABELS[claim.invariant] ?? claim.invariant}声明`;
            const summary = claimSummary(claim.invariant, claim.entry);
            return (
              <div
                key={`${claim.invariant}-${index}`}
                className="rounded-md border border-border bg-surface px-2.5 py-2"
                data-testid="proposal-card"
              >
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground" title={summary}>
                    {summary}
                  </span>
                  <span className="flex-shrink-0 font-mono text-3xs text-subtle">{kindLabel}</span>
                  <DismissButton
                    onDismiss={onDismissProposal && (() => onDismissProposal(target))}
                  />
                  <MergeButton
                    busy={merging}
                    onMerge={
                      onMergeProposal && (() => onMergeProposal(target, `${kindLabel}：${summary}`))
                    }
                  />
                </div>
              </div>
            );
          })}
          <EmptyLine>
            「并入」写进 canon.json：先问你一声、写前存快照、写完可撤销。「不要」只是不再摆在这里。
          </EmptyLine>
        </>
      )}
    </Section>
  );
}

function PromiseCard({
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
          <button
            type="button"
            onClick={() => onResolve(promise)}
            disabled={busy}
            className="flex-shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-3xs text-muted hover:bg-elevated hover:text-foreground disabled:opacity-50"
            title="写进 canon.json：状态改成已回收、记下回收章（先存快照，可撤销）"
            data-testid="promise-resolve"
          >
            标为已回收
          </button>
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
        <button
          key={observation.id}
          type="button"
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
        </button>
      ))}
      {entity.provenance.length > 0 && (
        <button
          type="button"
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
        </button>
      )}
      {provenanceOpen &&
        entity.provenance.map((occurrence) => (
          <button
            key={`${occurrence.path}-${occurrence.firstLine ?? 0}`}
            type="button"
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
          </button>
        ))}
      {provenanceOpen && entity.provenanceTruncated && (
        <div className="mt-0.5 text-3xs text-subtle">…仅列前 20 处</div>
      )}
    </div>
  );
}

// 「按需」检查器要 Agent 给语义参数（场景节拍、新实体清单）或本身走模型，只能在对话里跑：
// 按钮替作者把话说出来，走输入框同一条路径。
const ASK_PROMPTS: Record<string, string> = {
  consistency: '做一次一致性观察：当前这章和前文在人物、物件、时间上有没有对不上的地方？',
  collapse: '检查一下当前这章的场景承重：哪场戏没推动情节，可以合并或删掉？',
  entity_budget: '检查一下当前这章新出场的人物和物件是不是太多，读者记不记得住？',
  deep_consistency: '做一次深度一致性检查：通读前文，找出和当前这章矛盾的设定或情节。',
};

// 引擎在说明末尾附的是修订策略 id，作者看的是改法。
const STRATEGY_LABELS: Record<string, string> = {
  line_edit: '改法：逐句改',
  scene_patch: '改法：动整场戏',
};

function plainDetail(detail: string): string {
  return detail.replace(/建议策略 (\w+)/g, (match, id: string) => STRATEGY_LABELS[id] ?? match);
}

/** 观测的 source 形如 `prose·dimension`，点号前是产出它的检查器。 */
function checkerKeyOf(observation: Observation): string | null {
  return observation.source?.split('·')[0] ?? null;
}

function CheckerFinding({
  finding,
  onLocate,
  onResolve,
}: {
  finding: Observation;
  onLocate?: (observation: Observation) => void;
  onResolve?: (id: string) => void;
}) {
  const locatable = Boolean(finding.anchor && onLocate);
  return (
    <li
      className="flex items-start gap-1.5 rounded-sm px-1 py-1 hover:bg-elevated"
      data-testid="checker-finding"
      data-resolved={finding.resolved ? 'true' : 'false'}
    >
      <button
        type="button"
        className={`min-w-0 flex-1 text-left ${locatable ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={locatable ? () => onLocate?.(finding) : undefined}
        title={locatable ? '定位到原文' : undefined}
        data-testid="checker-finding-locate"
      >
        <span
          className={`block truncate text-2xs ${finding.resolved ? 'text-subtle line-through' : 'text-foreground'}`}
        >
          {finding.title}
        </span>
        {finding.location && (
          <span className="block truncate font-mono text-3xs text-subtle">{finding.location}</span>
        )}
        {finding.detail && (
          <span className="mt-0.5 line-clamp-2 block text-3xs leading-relaxed text-muted">
            {plainDetail(finding.detail)}
          </span>
        )}
      </button>
      {onResolve && !finding.resolved && (
        <button
          type="button"
          className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border border-border text-subtle hover:border-success/50 hover:bg-success/15 hover:text-success"
          aria-label={`标记已处理：${finding.title}`}
          title="标记已处理"
          onClick={() => onResolve(finding.id)}
          data-testid="checker-finding-resolve"
        >
          <Check size={10} strokeWidth={2} />
        </button>
      )}
    </li>
  );
}

function CheckerRow({
  checker,
  findings,
  onLocate,
  onResolve,
  onAsk,
}: {
  checker: ObservatoryChecker;
  findings: Observation[];
  onLocate?: (observation: Observation) => void;
  onResolve?: (id: string) => void;
  onAsk?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = CHECKER_LABELS[checker.key] ?? checker.tool;
  const ran = checker.status === 'ran';
  const counts = ran
    ? (
        [
          ['conflict_count', '冲突'],
          ['advisory_count', '提醒'],
          ['issue_count', '问题'],
        ] as const
      )
        .map(([field, label]) =>
          typeof checker[field] === 'number' ? `${label} ${checker[field]}` : null,
        )
        .filter((value): value is string => value !== null)
        .join(' · ')
    : '';
  const expandable = ran && findings.length > 0;
  const prompt = ASK_PROMPTS[checker.key];
  const summary = (
    <>
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      {counts && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{counts}</span>}
    </>
  );
  return (
    <div data-testid="checker-row" data-checker={checker.key}>
      <div
        className="flex items-center gap-2 py-1 text-2xs"
        title={typeof checker.reason === 'string' ? checker.reason : checker.tool}
      >
        <span
          className={`h-[6px] w-[6px] flex-shrink-0 rounded-full ${ran ? 'bg-success' : 'bg-border-strong'}`}
        />
        {expandable ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:bg-elevated"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            data-testid="checker-toggle"
          >
            {summary}
            {open ? (
              <ChevronDown size={11} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
            ) : (
              <ChevronRight size={11} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
            )}
          </button>
        ) : (
          summary
        )}
        {ran ? (
          <span className="flex-shrink-0 font-mono text-3xs text-subtle">保存时自动</span>
        ) : prompt && onAsk ? (
          <button
            type="button"
            className="flex-shrink-0 rounded-sm border border-agent/40 px-1.5 py-0.5 text-3xs text-agent hover:bg-agent/10"
            title="在对话里请 AI 用这个检查看当前这章（会调用你配置的模型）"
            onClick={() => onAsk(prompt)}
            data-testid="checker-ask"
          >
            让 AI 查
          </button>
        ) : (
          <span className="flex-shrink-0 font-mono text-3xs text-subtle">按需</span>
        )}
      </div>
      {open && expandable && (
        <ul className="mb-1 ml-3 border-l border-border pl-1" data-testid="checker-findings">
          {findings.map((finding) => (
            <CheckerFinding
              key={finding.id}
              finding={finding}
              onLocate={onLocate}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ObservatoryView({
  availability,
  scanning = false,
  observations,
  checkers,
  entities,
  promises,
  proposals,
  generatedAt,
  litEntityIds = [],
  merging = false,
  onRescan,
  onBackToChat,
  onLocateObservation,
  onLocateAnchor,
  onMergeProposal,
  onDismissProposal,
  onResolvePromise,
  onResolveObservation,
  onAskAgent,
}: {
  availability: ObservationAvailability;
  scanning?: boolean;
  observations: Observation[];
  checkers: ObservatoryChecker[];
  entities: ObservatoryEntity[];
  promises: ObservatoryPromises;
  proposals: ObservatoryProposals;
  generatedAt: string | null;
  litEntityIds?: string[];
  merging?: boolean;
  onRescan: () => void;
  onBackToChat: () => void;
  onLocateObservation?: (observation: Observation) => void;
  onLocateAnchor?: (anchor: ObservationAnchor) => void;
  onMergeProposal?: (target: CanonMergeTarget, label: string) => void;
  onDismissProposal?: (target: CanonMergeTarget) => void;
  onResolvePromise?: (promise: ObservatoryPromise) => void;
  onResolveObservation?: (id: string) => void;
  onAskAgent?: (text: string) => void;
}) {
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  // busy 合并首扫 loading 与「已有数据时的重扫」：后者 availability 停在 available，靠 scanning 反馈。
  const busy = scanning || availability === 'loading';
  // 第一次写 canon.json 要先给整本书拍快照，可能要好几秒：按钮灰着之外得说一声在干什么。
  const statusLabel = merging
    ? '正在写入设定…'
    : busy
      ? '扫描中…'
      : availability === 'error'
        ? '扫描失败'
        : availability === 'available' && generatedAt
          ? `上次扫描 ${formatScanTime(generatedAt)}`
          : '';
  // 相位级播报：扫描中 / 失败 / 完成（带时间）。同相位内 generatedAt 不变则文案恒定。
  const liveText = busy
    ? '正在扫描项目观测数据…'
    : availability === 'error'
      ? '观测数据加载失败，请重新扫描。'
      : availability === 'available' && generatedAt
        ? `观测扫描完成，上次扫描 ${formatScanTime(generatedAt)}。`
        : '';
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      data-testid="observatory-view"
    >
      <LiveStatus text={liveText} testid="observatory-live" />
      <header
        className="flex h-shell-row flex-shrink-0 items-center gap-2 bg-panel px-3 pr-2"
        data-testid="observatory-header"
      >
        <Radar size={14} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          世界线观测镜
        </h2>
        {statusLabel && (
          <span className="flex-shrink-0 font-mono text-3xs text-subtle">{statusLabel}</span>
        )}
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
          title="重新扫描（不调用模型）"
          aria-label="重新扫描世界观"
          onClick={onRescan}
          disabled={busy}
          data-testid="observatory-rescan"
        >
          <RefreshCw size={14} strokeWidth={1.6} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
          title="回到资源管理器 · Ctrl Shift E"
          aria-label="回到资源管理器"
          onClick={onBackToChat}
          data-testid="observatory-back-to-chat"
        >
          <FileText size={14} strokeWidth={1.6} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {availability !== 'available' ? (
          <p className="px-4 py-4 text-2xs leading-relaxed text-subtle">
            {availability === 'loading'
              ? '正在扫描项目观测数据。'
              : availability === 'error'
                ? '观测数据加载失败，请点击重新扫描。'
                : '观测尚未启用，当前没有可用于判断项目状态的数据。'}
          </p>
        ) : (
          <>
            <ProposalsSection
              proposals={proposals}
              onMergeProposal={onMergeProposal}
              onDismissProposal={onDismissProposal}
              merging={merging}
            />
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
                    <div className="text-3xs text-subtle">
                      正文已写到第 {promises.currentChapter} 章
                    </div>
                  )}
                  {promises.ledger.map((promise) => (
                    <PromiseCard
                      key={promise.id}
                      promise={promise}
                      onResolve={onResolvePromise}
                      busy={merging}
                    />
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
                    <CheckerRow
                      key={checker.key}
                      checker={checker}
                      findings={observations.filter(
                        (observation) => checkerKeyOf(observation) === checker.key,
                      )}
                      onLocate={onLocateObservation}
                      onResolve={onResolveObservation}
                      onAsk={onAskAgent}
                    />
                  ))}
                </div>
              )}
            </Section>
            <p className="px-3 py-3 text-3xs leading-relaxed text-subtle">
              以上是按规则算出的参考信号，不调用模型；提醒需要对照原文核实，不代表写得好坏。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
