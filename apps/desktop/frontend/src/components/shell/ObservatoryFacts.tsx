/**
 * 观测镜「事实台账」分区：写章时检查器顺带抽出、接受后自动记下的已写事实，按章列出、最近的章在前。
 * 原句在原章里已经找不到的标「依据已失效」（起草不再带）。点一条跳到原文；记错的可以作废，
 * 作废写进 facts.json（写前快照、可撤销），它替代过的旧状态重新有效。数据全来自 observatory.scan。
 */
import { useState } from 'react';

import { ChevronDown, ChevronRight } from '../icons/shell-icons';
import { BACKFILL_BATCH, type UnrecordedChapter } from '../../lib/api/facts';
import {
  factLabel,
  type ObservationAnchor,
  type ObservatoryFact,
  type ObservatoryFactChapter,
  type ObservatoryFacts,
} from '../../lib/observations';

const chapterTitle = (chapter: ObservatoryFactChapter) =>
  chapter.ordinal !== null
    ? `第 ${chapter.ordinal} 章`
    : `${chapter.path.split('/').pop()}（章节文件已不在）`;

function FactRow({
  fact,
  path,
  onLocate,
  onRetire,
}: {
  fact: ObservatoryFact;
  path: string;
  onLocate?: (anchor: ObservationAnchor) => void;
  onRetire?: (fact: ObservatoryFact) => void;
}) {
  const label = factLabel(fact);
  return (
    <li className="flex items-start gap-1.5" data-testid="obs-fact">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-sm text-left text-2xs leading-relaxed text-foreground hover:bg-elevated"
        title={fact.quote ? `原句：「${fact.quote}」` : undefined}
        onClick={() =>
          onLocate?.({
            path,
            ...(fact.line !== null ? { line: fact.line } : {}),
            ...(fact.quote ? { snippet: fact.quote } : {}),
          })
        }
        data-testid="obs-fact-locate"
      >
        {label}
        {!fact.valid && (
          <span className="ml-1.5 text-3xs text-warning" data-testid="obs-fact-stale">
            依据已失效
          </span>
        )}
      </button>
      {onRetire && (
        <button
          type="button"
          onClick={() => onRetire(fact)}
          className="flex-shrink-0 rounded-sm px-1.5 py-0.5 text-3xs text-subtle hover:bg-elevated hover:text-foreground"
          title="记错了：作废这条，起草不再带它（写 facts.json，先存快照，可撤销）"
          data-testid="obs-fact-retire"
        >
          作废
        </button>
      )}
    </li>
  );
}

function ChapterGroup({
  chapter,
  initiallyOpen,
  onLocate,
  onRetire,
}: {
  chapter: ObservatoryFactChapter;
  initiallyOpen: boolean;
  onLocate?: (anchor: ObservationAnchor) => void;
  onRetire?: (fact: ObservatoryFact) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const stale = chapter.facts.filter((fact) => !fact.valid).length;
  return (
    <div data-testid="obs-fact-chapter">
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-sm text-2xs text-muted hover:bg-elevated hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="obs-fact-chapter-toggle"
      >
        {open ? (
          <ChevronDown size={11} strokeWidth={1.7} />
        ) : (
          <ChevronRight size={11} strokeWidth={1.7} />
        )}
        <span>
          {chapterTitle(chapter)} · {chapter.facts.length} 条
        </span>
        {stale > 0 && <span className="text-3xs text-warning">（{stale} 条依据已失效）</span>}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 pl-4">
          {chapter.facts.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              path={chapter.path}
              onLocate={onLocate}
              onRetire={onRetire}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export type FactBackfill = {
  unrecorded: UnrecordedChapter[];
  progress: { done: number; total: number; path: string } | null;
  start: () => void;
};

/**
 * 老章补录：手写或更早写的章不会自动记账。每章调一次作者配置的模型，所以先在原地说清次数、
 * 作者点确定才开始；跑的时候显示进度。结果和撤销在右下角通知里。
 */
function BackfillPanel({ backfill }: { backfill: FactBackfill }) {
  const [confirming, setConfirming] = useState(false);
  const { unrecorded, progress } = backfill;
  if (progress) {
    const current = unrecorded.find((chapter) => chapter.path === progress.path);
    const name = current ? `第 ${current.ordinal} 章` : progress.path.split('/').pop();
    return (
      <p className="text-2xs leading-relaxed text-muted" data-testid="obs-facts-backfill-progress">
        补录中 {Math.min(progress.done + 1, progress.total)}/{progress.total}
        {progress.path ? `：${name}…` : '…'}
      </p>
    );
  }
  if (!unrecorded.length) return null;
  const batch = Math.min(unrecorded.length, BACKFILL_BATCH);
  const first = unrecorded[0].ordinal;
  const last = unrecorded[batch - 1].ordinal;
  const range = batch === 1 ? `第 ${first} 章` : `第 ${first}–${last} 章`;
  return (
    <div
      className="rounded-md border border-border px-2 py-1.5 text-2xs leading-relaxed text-muted"
      data-testid="obs-facts-backfill"
    >
      {confirming ? (
        <>
          <p>
            补录{range}，共 {batch} 章，会调用你配置的模型 {batch} 次。
          </p>
          <div className="mt-1 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-sm px-1.5 py-0.5 text-3xs text-subtle hover:bg-elevated hover:text-foreground"
              onClick={() => setConfirming(false)}
              data-testid="obs-facts-backfill-cancel"
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-sm border border-border px-1.5 py-0.5 text-3xs text-foreground hover:bg-elevated"
              onClick={() => {
                setConfirming(false);
                backfill.start();
              }}
              data-testid="obs-facts-backfill-confirm"
            >
              确定补录
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1">
            还有 {unrecorded.length} 章没记账（手写或更早写的章不会自动记）。
            {unrecorded.length > BACKFILL_BATCH ? `一次补 ${BACKFILL_BATCH} 章。` : ''}
          </p>
          <button
            type="button"
            className="flex-shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-3xs text-muted hover:bg-elevated hover:text-foreground"
            onClick={() => setConfirming(true)}
            data-testid="obs-facts-backfill-start"
          >
            补录…
          </button>
        </div>
      )}
    </div>
  );
}

export function factLedgerCount(facts: ObservatoryFacts): number | null {
  return facts.status === 'ready' ? facts.active : null;
}

export function FactLedgerBody({
  facts,
  onLocate,
  onRetire,
  backfill,
}: {
  facts: ObservatoryFacts;
  onLocate?: (anchor: ObservationAnchor) => void;
  onRetire?: (fact: ObservatoryFact) => void;
  backfill?: FactBackfill;
}) {
  if (facts.status === 'none')
    return (
      <>
        <p className="text-2xs leading-relaxed text-subtle">
          还没有事实台账。用「写一章」写完并接受后，会自动记下这章新定下的事实，下一章起草时带上。
        </p>
        {backfill && <BackfillPanel backfill={backfill} />}
      </>
    );
  if (facts.status === 'error')
    return (
      <p className="text-2xs leading-relaxed text-error" data-testid="obs-facts-error">
        facts.json 读不了：{facts.message}。改好之前，记账和起草都用不上它。
      </p>
    );
  const extra = [
    facts.stale ? `${facts.stale} 条依据已失效，起草不再带` : '',
    facts.superseded ? `${facts.superseded} 条已被新状态替代` : '',
    facts.retired ? `${facts.retired} 条已作废` : '',
  ].filter(Boolean);
  return (
    <>
      <p className="text-3xs leading-relaxed text-subtle" data-testid="obs-facts-summary">
        有效 {facts.active} 条，来自 {facts.chapters.length} 章
        {extra.length ? `；${extra.join('，')}` : ''}。点一条看原文。
      </p>
      {backfill && <BackfillPanel backfill={backfill} />}
      {facts.chapters.map((chapter, index) => (
        <ChapterGroup
          key={chapter.path}
          chapter={chapter}
          initiallyOpen={index === 0}
          onLocate={onLocate}
          onRetire={onRetire}
        />
      ))}
    </>
  );
}
