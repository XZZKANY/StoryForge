/**
 * 稿件卡：状态栏字数点开的写作进度面板。
 * 三段——本章（实时）、今日（已落盘净增量 + 日更目标）、全书（按需扫描正文目录）。
 * 全书统计是读盘操作，只在卡片打开时跑一次；读失败的文件如实报数，不当 0 字混进总和。
 */
import { useEffect, useRef, useState } from 'react';

import { readDailyProgress } from '../../lib/daily-progress';
import { scanManuscriptTotals, type ManuscriptTotals } from '../../lib/manuscript-stats';
import { useDismissableMenu } from './useDismissableMenu';

// 结果带上它属于哪个项目：换项目时不必在 effect 里同步置 loading（会触发级联渲染），
// 渲染侧比对 projectPath 不符即当作仍在统计，也就不会把上一本书的总字数留在卡上。
type ScanState =
  | { kind: 'pending' }
  | { kind: 'done'; projectPath: string; totals: ManuscriptTotals }
  | { kind: 'error'; projectPath: string; message: string };

const number = (value: number) => value.toLocaleString('zh-CN');

/** 目标进度：未设目标（0）时返回 null，UI 据此整段不渲染，而不是画一条永远 0% 的条。 */
export function goalProgress(chars: number, goal: number): number | null {
  if (!goal || goal <= 0) return null;
  return Math.max(0, Math.min(1, chars / goal));
}

export function ManuscriptCard({
  projectPath,
  chapterChars,
  chapterParagraphs,
  selectionChars,
  chapterLabel,
  dailyGoal,
  onClose,
  triggerRef,
}: {
  projectPath: string | null;
  chapterChars: number;
  chapterParagraphs: number;
  selectionChars: number;
  chapterLabel: string;
  dailyGoal: number;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  const [scan, setScan] = useState<ScanState>({ kind: 'pending' });
  const cardRef = useRef<HTMLDivElement>(null);
  const daily = readDailyProgress(projectPath);
  const progress = goalProgress(daily.chars, dailyGoal);
  // 上一本书的统计结果不算数：项目对不上就仍显示「统计中」。
  const current = scan.kind !== 'pending' && scan.projectPath === projectPath ? scan : null;

  useDismissableMenu(true, onClose, triggerRef);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void scanManuscriptTotals(projectPath)
      .then((totals) => {
        if (!cancelled) setScan({ kind: 'done', projectPath, totals });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setScan({
          kind: 'error',
          projectPath,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [onClose, triggerRef]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="稿件进度"
      className="absolute bottom-[30px] right-3 z-30 w-[268px] rounded-lg border border-border bg-surface p-3 text-[11px] text-muted shadow-[var(--shadow-dropdown)]"
      data-testid="manuscript-card"
    >
      <Section title={chapterLabel || '本章'}>
        <Row label="字数" value={`${number(chapterChars)} 字`} testId="manuscript-chapter-chars" />
        <Row label="段落" value={`${number(chapterParagraphs)} 段`} />
        {selectionChars > 0 && <Row label="选中" value={`${number(selectionChars)} 字`} />}
      </Section>

      <Section title="今日">
        <Row
          label="已存"
          value={`${daily.chars >= 0 ? '+' : ''}${number(daily.chars)} 字`}
          testId="manuscript-daily-chars"
        />
        {progress !== null && (
          <>
            <Row label="目标" value={`${number(dailyGoal)} 字`} />
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-agent transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
                data-testid="manuscript-goal-bar"
                data-progress={Math.round(progress * 100)}
              />
            </div>
          </>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-subtle">
          只算已保存的净增量，未保存的草稿不计入。
        </p>
      </Section>

      <Section title="全书" last>
        {!projectPath && <Row label="未打开项目" value="" />}
        {projectPath && current === null && <Row label="统计中…" value="" />}
        {current?.kind === 'error' && (
          <Row label="统计失败" value={current.message.slice(0, 40)} tone="error" />
        )}
        {current?.kind === 'done' && (
          <>
            <Row
              label="章节"
              value={`${number(current.totals.chapters)} 章`}
              testId="manuscript-total-chapters"
            />
            <Row
              label="总字数"
              value={`${number(current.totals.chars)} 字`}
              testId="manuscript-total-chars"
            />
            {current.totals.unreadable > 0 && (
              <Row label="读取失败" value={`${current.totals.unreadable} 个文件`} tone="error" />
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  last,
  children,
}: {
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={last ? '' : 'mb-2.5 border-b border-border pb-2.5'}>
      <h3 className="mb-1 truncate text-[10px] font-medium uppercase tracking-wide text-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'error';
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-px">
      <span className={tone === 'error' ? 'text-error' : undefined}>{label}</span>
      <span className="truncate tabular-nums text-foreground" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
