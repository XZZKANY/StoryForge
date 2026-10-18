/**
 * 观测镜「事实台账」分区：写章时检查器顺带抽出、接受后自动记下的已写事实，按章列出、最近的章在前。
 * 原句在原章里已经找不到的标「依据已失效」（起草不再带）。点一条跳到原文；记错的可以作废，
 * 作废写进 facts.json（写前快照、可撤销），它替代过的旧状态重新有效。数据全来自 observatory.scan。
 */
import { useState } from 'react';

import { ChevronDown, ChevronRight } from '../icons/shell-icons';
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

export function factLedgerCount(facts: ObservatoryFacts): number | null {
  return facts.status === 'ready' ? facts.active : null;
}

export function FactLedgerBody({
  facts,
  onLocate,
  onRetire,
}: {
  facts: ObservatoryFacts;
  onLocate?: (anchor: ObservationAnchor) => void;
  onRetire?: (fact: ObservatoryFact) => void;
}) {
  if (facts.status === 'none')
    return (
      <p className="text-2xs leading-relaxed text-subtle">
        还没有事实台账。用「写一章」写完并接受后，会自动记下这章新定下的事实，下一章起草时带上。
      </p>
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
