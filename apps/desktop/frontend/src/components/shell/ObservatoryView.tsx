/**
 * 世界线观测镜：左栏第二视图（#13 从右栏迁来；与资源管理器 CSS 互斥不卸载）。
 * 五个可折叠分区——待确认提案 / 事实台账 / 伏笔账 / 实体 / 检查器，数据全部来自
 * observatory.scan payload v2 的结构化台账（确定性、无 LLM）。
 *
 * 诚实边界：观测是参考信号不是质量判定；实体卡红描边只反映后端已判定的 blocking 观测，
 * 前端不自算结论。提案「并入」、伏笔「标为已回收」由作者点下后前端写 canon.json（后端绝不写
 * 作者项目文件），先确认、写前存快照、可撤销；「不要」只在本机记下不再摆出，不碰 canon.json。
 */
import type { ReactNode } from 'react';

import { FileText, Radar, RefreshCw } from '../icons/shell-icons';
import type { CanonMergeTarget } from '../../lib/canon-merge';
import {
  NO_OBSERVATORY_FACTS,
  type ObservationAnchor,
  type ObservatoryChecker,
  type ObservatoryDispute,
  type ObservatoryEntity,
  type ObservatoryFact,
  type ObservatoryFacts,
  type ObservatoryPromise,
  type ObservatoryPromises,
  type ObservatoryProposals,
} from '../../lib/observations';
import { FactLedgerBody, factLedgerCount, type FactBackfill } from './ObservatoryFacts';
import type { Observation, ObservationAvailability } from './ObsPanel';
import { LiveStatus } from './LiveStatus';
import { PanelSection } from './PanelSection';
import { EntityCard, PromiseCard } from './ObservatoryCards';
import { checkerKeyOf, CheckerRow } from './ObservatoryCheckers';
import { Button, IconButton, Spinner } from '../ui';

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

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-2xs leading-relaxed text-subtle">{children}</p>;
}

function DismissButton({ onDismiss }: { onDismiss?: () => void }) {
  if (!onDismiss) return null;
  return (
    <Button
      onClick={onDismiss}
      variant="ghost"
      size="mini"
      title="不再摆在这里（canon.json 不动，可撤销）"
      data-testid="proposal-dismiss"
    >
      不要
    </Button>
  );
}

function MergeButton({ onMerge, busy }: { onMerge?: () => void; busy: boolean }) {
  if (!onMerge) return null;
  return (
    <Button onClick={onMerge} disabled={busy} size="compact" data-testid="proposal-merge">
      并入
    </Button>
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
    <PanelSection
      prefix="obs"
      defaultOpen
      stack
      title="待确认提案"
      meta={proposals.available ? proposals.pendingCount : null}
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
    </PanelSection>
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
  facts = NO_OBSERVATORY_FACTS,
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
  onRetireFact,
  onResolveDispute,
  factBackfill,
}: {
  availability: ObservationAvailability;
  scanning?: boolean;
  observations: Observation[];
  checkers: ObservatoryChecker[];
  entities: ObservatoryEntity[];
  promises: ObservatoryPromises;
  proposals: ObservatoryProposals;
  facts?: ObservatoryFacts;
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
  onRetireFact?: (fact: ObservatoryFact) => void;
  onResolveDispute?: (dispute: ObservatoryDispute, choice: 'accept' | 'reject') => void;
  factBackfill?: FactBackfill;
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
    ? '正在扫描作品观测数据…'
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
        <IconButton
          size="xs"
          label="重新扫描世界观"
          tooltip="重新扫描（不调用模型）"
          icon={<Spinner icon={RefreshCw} spinning={busy} size={14} strokeWidth={1.6} />}
          onClick={onRescan}
          disabled={busy}
          data-testid="observatory-rescan"
        />
        <IconButton
          size="xs"
          label="回到资源管理器"
          tooltip="回到资源管理器 · Ctrl Shift E"
          icon={<FileText size={14} strokeWidth={1.6} />}
          onClick={onBackToChat}
          data-testid="observatory-back-to-chat"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {availability !== 'available' ? (
          <p className="px-4 py-4 text-2xs leading-relaxed text-subtle">
            {availability === 'loading'
              ? '正在扫描作品观测数据。'
              : availability === 'error'
                ? '观测数据加载失败，请点击重新扫描。'
                : '观测尚未启用，当前没有可用于判断作品状态的数据。'}
          </p>
        ) : (
          <>
            <ProposalsSection
              proposals={proposals}
              onMergeProposal={onMergeProposal}
              onDismissProposal={onDismissProposal}
              merging={merging}
            />
            <PanelSection
              prefix="obs"
              defaultOpen
              stack
              title="事实台账"
              meta={factLedgerCount(facts)}
              testid="facts"
            >
              <FactLedgerBody
                facts={facts}
                onLocate={onLocateAnchor}
                onRetire={onRetireFact}
                onResolveDispute={onResolveDispute}
                backfill={factBackfill}
              />
            </PanelSection>
            <PanelSection
              prefix="obs"
              defaultOpen
              stack
              title="伏笔账"
              meta={promises.ledger.length}
              testid="promises"
            >
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
            </PanelSection>
            <PanelSection
              prefix="obs"
              defaultOpen
              stack
              title="实体"
              meta={entities.length}
              testid="entities"
            >
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
            </PanelSection>
            <PanelSection
              prefix="obs"
              defaultOpen
              stack
              title="检查器"
              meta={checkers.length}
              testid="checkers"
            >
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
            </PanelSection>
            <p className="px-3 py-3 text-3xs leading-relaxed text-subtle">
              以上是按规则算出的参考信号，不调用模型；提醒需要对照原文核实，不代表写得好坏。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
