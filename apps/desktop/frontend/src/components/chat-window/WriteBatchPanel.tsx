import type { ReactNode } from 'react';
import { Button } from '../ui';

import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ApiWriteBatchPlan } from '../../lib/api/contracts';
import { CHAT_COLUMN } from './column';
import type { WriteBatchRequest } from './useChatSubmission';
import type { WriteBatchProgress, WriteBatchScheduler } from './useWriteBatchScheduler';
import { WriteBatchCard, type WriteBatchStartFeedback } from './WriteBatchCard';
import { WriteBatchResultCard } from './WriteBatchResultCard';

function resumeTitle(plan: ApiWriteBatchPlan): string {
  const first = plan.chapters.find((chapter) => chapter.status === 'write');
  return first ? `从第 ${first.ordinal} 章接着写` : `续写第 ${plan.from}–${plan.to} 章`;
}

/**
 * 批量写章在对话里那一格（输入框上方、章纲卡同一位置）：一次只出一张——续写的确认卡、`/写` 的确认卡、
 * 停下或写完的清单。卡片自己管滚动：章列表在卡内滚，底部按钮始终露着。
 */
export function WriteBatchPanel({
  projectPath,
  permissionProfile,
  request,
  scheduler,
  onStart,
  onClose,
}: {
  projectPath: string | null;
  permissionProfile: AgentPermissionProfile;
  /** 对话里打的 `/写 …`。 */
  request: WriteBatchRequest | null;
  scheduler?: WriteBatchScheduler;
  onStart?: (plan: ApiWriteBatchPlan) => Promise<WriteBatchStartFeedback>;
  onClose: () => void;
}) {
  if (!projectPath) return null;
  const phase = scheduler?.phase;
  let card: ReactNode = null;
  if (scheduler && phase?.kind === 'confirming') {
    const { plan } = phase;
    card = (
      <WriteBatchCard
        key="resume"
        command={{ kind: 'range', from: plan.from, to: plan.to, note: phase.note }}
        title={resumeTitle(plan)}
        projectPath={projectPath}
        permissionProfile={permissionProfile}
        plan={plan}
        onStart={scheduler.confirmResume}
        onClose={scheduler.cancelConfirm}
      />
    );
  } else if (request) {
    card = (
      <WriteBatchCard
        key={request.id}
        command={request.command}
        projectPath={projectPath}
        permissionProfile={permissionProfile}
        onStart={onStart}
        onClose={onClose}
      />
    );
  } else if (scheduler && phase?.kind === 'result') {
    card = (
      <WriteBatchResultCard
        result={phase.result}
        projectPath={projectPath}
        onReviewed={scheduler.markReviewed}
        onResume={scheduler.resumeFromResult}
        onPrepareUndo={scheduler.prepareUndo}
        onCancelUndo={scheduler.cancelUndo}
        onUndo={scheduler.undoFrom}
        onClose={scheduler.closeResult}
      />
    );
  }
  if (!card) return null;
  return (
    // 比章纲卡多给一成高度：1400×759 下底部说明占去不少，六成只露得出三章。
    <section
      className="flex max-h-[70%] min-h-0 flex-shrink-0 flex-col px-5 py-3"
      aria-label="批量写章"
      data-testid="write-batch-decision"
    >
      <div className={`${CHAT_COLUMN} flex min-h-0 flex-col`}>{card}</div>
    </section>
  );
}

/** 批量写章进行中：输入框上方一条，和运行状态条同一个位置、同一套样式。 */
export function WriteBatchProgressBar({
  progress,
  onStop,
}: {
  progress: WriteBatchProgress;
  onStop: () => void;
}) {
  const head =
    progress.ordinal !== null
      ? `批量写章 · 第 ${progress.ordinal} 章（${progress.index} / ${progress.total}）`
      : '批量写章 ';
  const usage =
    progress.used !== null
      ? `· 已用 ${progress.used}${progress.cap !== null ? ` / 上限 ${progress.cap}` : ''}`
      : '';
  return (
    <div className="flex-shrink-0 animate-slide-in-up px-3 pt-2" data-testid="write-batch-progress">
      <div
        className={`${CHAT_COLUMN} flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2`}
      >
        <span
          role="status"
          className="min-w-0 flex-1 text-xs font-medium text-muted"
          data-testid="write-batch-progress-text"
        >
          {`${head}${usage}`.trim()}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="interactive-press text-xs font-medium transition-colors"
          onClick={onStop}
          disabled={progress.stopping}
          data-testid="write-batch-stop"
        >
          {progress.stopping ? '正在停…' : '停止'}
        </Button>
      </div>
    </div>
  );
}
