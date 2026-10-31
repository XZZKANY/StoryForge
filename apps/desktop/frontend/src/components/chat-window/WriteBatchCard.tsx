import { WRITE_BATCH_USAGE, type WriteBatchCommand } from '@storyforge/project-core';
import { Button } from '../ui';

import { useEffect, useId, useRef, useState } from 'react';

import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type {
  ApiWriteBatchChapter,
  ApiWriteBatchEstimate,
  ApiWriteBatchPlan,
} from '../../lib/api/contracts';
import { planWriteBatch } from '../../lib/api/write-batch';

/** 只有不写的章挂小标；要写的是默认，不标。 */
const STATUS_TAG: Partial<Record<ApiWriteBatchChapter['status'], string>> = {
  skip_written: '已有正文，跳过',
  after_trial: '试写后再估',
};

/** token 数按「万」显示，保留一位小数。 */
export function formatTenThousands(tokens: number): string {
  return (tokens / 10_000).toFixed(1);
}

/** 标题下紧贴的一行：能不能开跑、要花多少，一眼看清。 */
export function planSummary(plan: ApiWriteBatchPlan): string | null {
  if (plan.blockers.length > 0) return `有 ${plan.blockers.length} 处要先处理`;
  if (!plan.can_start) return null;
  if (plan.estimate) {
    const wan = formatTenThousands;
    return (
      `要写 ${plan.estimate.chapter_count} 章 · 预估 ${wan(plan.estimate.estimated_tokens)} 万` +
      ` · 上限 ${wan(plan.estimate.cap_tokens)} 万`
    );
  }
  const first = plan.chapters.find((chapter) => chapter.status === 'write');
  return plan.basis === 'trial' && first ? `先试写第 ${first.ordinal} 章量一量` : null;
}

function estimateDetails(estimate: ApiWriteBatchEstimate): string[] {
  const wan = formatTenThousands;
  const lines = [
    `按本书最近 ${estimate.sample_count} 章，每章平均 ${wan(estimate.average_tokens)} 万` +
      `（最少 ${wan(estimate.min_tokens)} 万、最多 ${wan(estimate.max_tokens)} 万）。`,
  ];
  const parts = [
    estimate.estimated_calls > 0 && `${estimate.estimated_calls} 次服务商没报用量，是按字数估的`,
    estimate.unknown_calls > 0 && `${estimate.unknown_calls} 次没拿到用量，没算进去`,
  ].filter(Boolean);
  if (parts.length) lines.push(`其中 ${parts.join('；')}。`);
  lines.push('这里算的是 token 数，不是钱。');
  return lines;
}

function cardTitle(command: WriteBatchCommand): string {
  if (command.kind === 'resume') return '续写上一批：下一步接上';
  if (command.kind === 'invalid') return '格式不对';
  return command.from === command.to
    ? `写第 ${command.from} 章`
    : `批量写第 ${command.from}–${command.to} 章`;
}

type PlanView =
  | { status: 'loading' }
  | { status: 'ready'; plan: ApiWriteBatchPlan }
  | { status: 'error'; message: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 范围指令才排计划；结果连同是哪次请求一起存，换了档位或作品时旧结果不冒充新的。 */
function useWriteBatchPlan(
  command: WriteBatchCommand,
  projectPath: string,
  permissionProfile: AgentPermissionProfile,
  skip: boolean,
): PlanView | null {
  const key =
    command.kind === 'range' && !skip
      ? `${projectPath}\n${command.from}\n${command.to}\n${permissionProfile}`
      : null;
  const [loaded, setLoaded] = useState<{ key: string; view: PlanView } | null>(null);
  useEffect(() => {
    if (command.kind !== 'range' || key === null) return;
    let cancelled = false;
    const settle = (view: PlanView) => {
      if (!cancelled) setLoaded({ key, view });
    };
    planWriteBatch({
      projectRoot: projectPath,
      from: command.from,
      to: command.to,
      permissionProfile,
    }).then(
      (plan) => settle({ status: 'ready', plan }),
      (error: unknown) => settle({ status: 'error', message: errorText(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [command, key, projectPath, permissionProfile]);
  if (key === null) return null;
  return loaded?.key === key ? loaded.view : { status: 'loading' };
}

/** 点了「开始写」之后：开不了时引擎重出的计划（带新的拦法），或出错的原因；开成了卡片会被收起。 */
export type WriteBatchStartFeedback = { plan?: ApiWriteBatchPlan; error?: string; started?: true };

/**
 * `/写 …` 的确认卡：列出这一批写哪几章、为什么还不能开始、预估多少。
 * 「开始写」只把计划交给外面传进来的 onStart（调度器）；开不了时把引擎重出的计划显示回卡上。
 * 续写时调度器已经拿到了引擎重出的计划，直接用 plan 显示，不再排一遍。
 * 从上到下：标题与摘要 → 不能开跑的原因 → 章列表（限高、卡内滚动）→ 底部说明与按钮。
 * 右栏窄、窗口矮时让中间一段让位，底部按钮始终露在卡片里。
 */
export function WriteBatchCard({
  command,
  projectPath,
  permissionProfile,
  plan: givenPlan,
  title,
  onStart,
  onClose,
}: {
  command: WriteBatchCommand;
  projectPath: string;
  /** 作者为这部作品存的档位。 */
  permissionProfile: AgentPermissionProfile;
  /** 已经由引擎出好的计划（续写）；给了就不再排计划。 */
  plan?: ApiWriteBatchPlan;
  title?: string;
  onStart?: (plan: ApiWriteBatchPlan) => void | Promise<WriteBatchStartFeedback>;
  onClose: () => void;
}) {
  const fetched = useWriteBatchPlan(command, projectPath, permissionProfile, Boolean(givenPlan));
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState<WriteBatchStartFeedback | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const view: PlanView | null = feedback?.plan
    ? { status: 'ready', plan: feedback.plan }
    : givenPlan
      ? { status: 'ready', plan: givenPlan }
      : fetched;
  const startHintId = useId();
  const plan = view?.status === 'ready' ? view.plan : null;
  // 能开跑的计划；有不能开跑的原因时为 null，卡上不给「开始写」。
  const ready = plan?.can_start ? plan : null;
  const summary = plan ? planSummary(plan) : null;
  const chapters = plan?.chapters ?? [];
  return (
    <section
      className="flex min-h-0 flex-col rounded-lg border border-agent/40 bg-panel px-3 py-3"
      aria-label={title ?? cardTitle(command)}
      data-testid="write-batch-card"
    >
      <div className="flex-shrink-0">
        <div className="text-xs font-semibold text-foreground" data-testid="write-batch-title">
          {title ?? cardTitle(command)}
        </div>
        {summary && (
          <div className="mt-0.5 text-xs text-muted" data-testid="write-batch-summary">
            {summary}
          </div>
        )}
        {command.kind === 'range' && command.note && (
          <div className="mt-0.5 truncate text-xs text-subtle" title={command.note}>
            要求：{command.note}
          </div>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {command.kind === 'invalid' && (
          <div className="mt-2 text-xs" data-testid="write-batch-invalid">
            <p className="text-foreground">{command.message}</p>
            <ul className="mt-2 space-y-1">
              {WRITE_BATCH_USAGE.map((item) => (
                <li key={item.example} className="flex gap-2">
                  <span className="shrink-0 text-foreground">{item.example}</span>
                  <span className="text-subtle">{item.meaning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view?.status === 'loading' && (
          <p className="mt-2 text-xs text-muted" role="status" data-testid="write-batch-loading">
            正在排这一批…
          </p>
        )}
        {view?.status === 'error' && (
          <p
            className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning"
            data-testid="write-batch-error"
          >
            排不出这一批：{view.message}
          </p>
        )}
        {feedback?.error && (
          <p
            className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning"
            data-testid="write-batch-start-error"
          >
            没能开始：{feedback.error}
          </p>
        )}
        {plan && plan.blockers.length > 0 && (
          <div
            className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2"
            data-testid="write-batch-blockers"
          >
            <div className="text-xs font-medium text-warning">还不能开始写</div>
            <ul className="mt-1 space-y-1 text-xs text-foreground">
              {plan.blockers.map((blocker) => (
                <li key={blocker.code} data-testid="write-batch-blocker">
                  {blocker.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {chapters.length > 0 && (
          // 限高 11rem：每章两行字加上下内边距约 2.9rem，露出将近 4 行，最后一行露半截提示下面还有。
          <ul
            className="mt-2 max-h-44 divide-y divide-border/60 overflow-y-auto"
            data-testid="write-batch-chapters"
          >
            {chapters.map((chapter) => (
              <li
                key={chapter.ordinal}
                className="flex items-start gap-2 py-1.5"
                data-testid="write-batch-chapter"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground">
                    第 {chapter.ordinal} 章{chapter.title ? `《${chapter.title}》` : ''}
                  </div>
                  <div
                    className="mt-0.5 truncate text-3xs text-subtle"
                    title={chapter.goal ?? undefined}
                  >
                    {chapter.goal ?? '计划里没写本章目标'}
                  </div>
                </div>
                {STATUS_TAG[chapter.status] && (
                  <span
                    className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-3xs text-subtle"
                    data-testid="write-batch-chapter-tag"
                  >
                    {STATUS_TAG[chapter.status]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex-shrink-0" data-testid="write-batch-footer">
        {ready && (
          <div className="mt-2 space-y-0.5 text-2xs leading-4 text-muted">
            {ready.estimate && (
              <div className="space-y-0.5" data-testid="write-batch-estimate">
                {estimateDetails(ready.estimate).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            {ready.basis === 'trial' && ready.note && (
              <p data-testid="write-batch-trial">{ready.note}</p>
            )}
            <ul className="space-y-0.5" data-testid="write-batch-notes">
              <li>写完直接写进文件，每章写进去之前都留快照，可以撤销。</li>
              {/* 只在有上限时说：试写只写一章，不设上限。 */}
              {ready.estimate && (
                <li>到了上限会把正在写的这一章写完再停，实际用量可能比上限多出一章。</li>
              )}
              {ready.permission_profile === 'ask' && (
                <li>这一批的修订不用逐章点接受，算你这次点了开始的授权；平时的权限档位不变。</li>
              )}
            </ul>
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {ready && !onStart && (
            <span id={startHintId} className="mr-auto text-3xs text-subtle">
              下一步接上
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="text-xs"
            onClick={onClose}
            data-testid="write-batch-close"
          >
            {ready ? '取消' : '关闭'}
          </Button>
          {ready && (
            <Button
              type="button"
              size="sm"
              variant="agent"
              className="text-xs"
              disabled={!onStart || starting}
              title={onStart ? undefined : '下一步接上'}
              aria-describedby={onStart ? undefined : startHintId}
              onClick={() => {
                if (!onStart || starting) return;
                setStarting(true);
                setFeedback(null);
                void Promise.resolve(onStart(ready)).then(
                  (result) => {
                    if (!mounted.current) return;
                    setStarting(false);
                    if (result && !result.started) setFeedback(result);
                  },
                  (error: unknown) => {
                    if (!mounted.current) return;
                    setStarting(false);
                    setFeedback({ error: errorText(error) });
                  },
                );
              }}
              data-testid="write-batch-start"
            >
              开始写
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
