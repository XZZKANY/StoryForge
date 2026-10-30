/**
 * 批量写章调度器里不碰 React 的部分：一批开跑时的授权与内存记事、逐章发起、接循环、换作品时就地停下、
 * 停下 / 写完后出卡用的结果。状态与按钮在 useWriteBatchScheduler。
 */
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { sendAgentControlMessage } from '../../lib/api-client';
import type { ApiWriteBatch, ApiWriteBatchPlan, ApiWriteBatchView } from '../../lib/api/contracts';
import {
  currentWriteBatchModelKey,
  formatWriteBatchTokens,
  nextWriteBatchStep,
  recordWriteBatchChapter,
  stopWriteBatch,
} from '../../lib/api/write-batch';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { emitToast } from '../../lib/toast';
import {
  issueWriteBatchGrant,
  revokeWriteBatchGrant,
  type WriteBatchGrant,
} from '../../lib/write-batch-grant';
import { closeWriteBatchTab, noteWriteBatchTarget } from '../../lib/write-batch-tabs';
import { awaitChapterWriteback } from '../../lib/write-batch-writeback';
import {
  runWriteBatchLoop,
  type WriteBatchLoopEnd,
  type WriteBatchPosition,
  type WriteBatchWriteStep,
} from './write-batch-loop';
import { batchUsedTokens, chapterTitles } from './write-batch-view';
import type { RunAuthorAgent, RunAuthorAgentOutcome } from './types';
import type { ChatWindowState } from './useChatWindowState';

/** 等一章写进文件、事实记账落定的上限：整本书拍快照加记账，几秒到几十秒；过了就当被拦下。 */
export const WRITE_BATCH_WRITEBACK_TIMEOUT_MS = 180_000;

export type WriteBatchProgress = {
  ordinal: number | null;
  index: number;
  total: number;
  used: string | null;
  /** 试写段没有上限，为 null。 */
  cap: string | null;
  stopping: boolean;
};

export type WriteBatchResult = {
  batch: ApiWriteBatch | null;
  canResume: boolean;
  resumeFrom: number | null;
  titles: Record<number, string>;
  /** 这一批一共用了多少（按「万」说）。 */
  used: string | null;
  error: string | null;
  notice: string | null;
  /** 正在标审完或正在续写，按钮先不让点。 */
  pending: boolean;
};

/** 调度器归属：换作品或卸载就失效，晚到的结果一律不写。 */
export type WriteBatchOwner = { project: string | null; active: boolean; abort: AbortController };

export type WriteBatchRun = {
  project: string;
  batchId: string;
  grant: WriteBatchGrant;
  note: string | null;
  total: number;
  stopRequested: boolean;
  inFlightRunId: string | null;
};

export type WriteBatchChat = Pick<ChatWindowState, 'setMessages' | 'agentRunIdRef'> & {
  runAuthorAgent: RunAuthorAgent;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LEFT_MESSAGE = '换了作品或关掉了对话，这一批停下了。';

// 作者附在 `/写` 后面的要求与计划里的章名：记录里没有，续写与停下的卡要用，按作品 + 批次记在内存里。
const memory = new Map<string, { note: string | null; titles: Record<number, string> }>();
const memoryKey = (project: string, batchId: string) => `${project}\n${batchId}`;

export function rememberedNote(project: string, batchId: string): string | null {
  return memory.get(memoryKey(project, batchId))?.note ?? null;
}

/** 开跑或续跑：只给这一段计划里要写的章发授权，记下要求与章名。 */
export function createWriteBatchRun(
  project: string,
  batch: ApiWriteBatch,
  plan: ApiWriteBatchPlan,
  note: string | null,
): WriteBatchRun {
  const writing = plan.chapters.filter((chapter) => chapter.status === 'write');
  memory.set(memoryKey(project, batch.id), { note, titles: chapterTitles(plan) });
  return {
    project,
    batchId: batch.id,
    grant: issueWriteBatchGrant({
      projectPath: project,
      batchId: batch.id,
      targets: writing.map((chapter) => chapter.target_path),
    }),
    note,
    total: writing.length,
    stopRequested: false,
    inFlightRunId: null,
  };
}

/** 发起这一章：拼好作者那句话进对话，带上这一批的授权交给 runAuthorAgent，等这一轮的终态。 */
async function dispatchChapter(
  run: WriteBatchRun,
  chat: WriteBatchChat,
  step: WriteBatchWriteStep,
  position: WriteBatchPosition,
): Promise<RunAuthorAgentOutcome> {
  const target = resolveProjectRelativePath(run.project, step.target_path);
  if (target) noteWriteBatchTarget(target);
  const goal =
    `写第 ${step.ordinal} 章（批量第 ${position.index} / ${position.total} 章）` +
    (run.note ? `\n作者要求：${run.note}` : '');
  chat.setMessages((prev) => [...prev, { role: 'user', content: goal }]);
  const before = chat.agentRunIdRef.current;
  const pending = chat.runAuthorAgent(goal, 'agent', 'chapter.write', [], {
    targetFilePath: step.target_path,
    writeBatchGrant: run.grant,
  });
  // runAuthorAgent 在第一次 await 之前就换上了这一轮的 id：记下来，作者停止或换作品时停的是它。
  const started = chat.agentRunIdRef.current;
  run.inFlightRunId = started && started !== before ? started : null;
  try {
    return await pending;
  } finally {
    run.inFlightRunId = null;
  }
}

/** 接上调度循环跑完这一段；无论怎么结束，授权都撤掉。 */
export async function driveWriteBatchRun({
  run,
  owner,
  batch,
  isCurrent,
  chat,
  permissionProfile,
  show,
}: {
  run: WriteBatchRun;
  owner: WriteBatchOwner;
  batch: ApiWriteBatch;
  isCurrent: () => boolean;
  chat: () => WriteBatchChat;
  permissionProfile: () => AgentPermissionProfile;
  show: (progress: WriteBatchProgress) => void;
}): Promise<WriteBatchLoopEnd> {
  const scope = { projectRoot: run.project, batchId: run.batchId };
  let progress: WriteBatchProgress = {
    ordinal: null,
    index: 0,
    total: run.total,
    used: null,
    cap: null,
    stopping: false,
  };
  const update = (patch: Partial<WriteBatchProgress>) => {
    progress = { ...progress, ...patch, stopping: run.stopRequested };
    if (isCurrent()) show(progress);
  };
  const showUsage = async (record: ApiWriteBatch) => {
    const leg = record.legs[record.legs.length - 1];
    if (!leg) return;
    const used = await formatWriteBatchTokens(leg.used_tokens);
    const cap = leg.cap_tokens === null ? null : await formatWriteBatchTokens(leg.cap_tokens);
    update({ used, cap });
  };
  update({});
  try {
    await showUsage(batch);
    return await runWriteBatchLoop({
      next: (input) => nextWriteBatchStep({ ...scope, ...input }),
      record: (input) => recordWriteBatchChapter({ ...scope, ...input }),
      stop: (input) => stopWriteBatch({ ...scope, ...input }),
      permissionProfile,
      modelKey: currentWriteBatchModelKey,
      dispatch: (step, position) => dispatchChapter(run, chat(), step, position),
      awaitWriteback: (runId) =>
        awaitChapterWriteback(runId, {
          timeoutMs: WRITE_BATCH_WRITEBACK_TIMEOUT_MS,
          signal: owner.abort.signal,
        }),
      total: run.total,
      stopRequested: () => run.stopRequested,
      alive: () => owner.active && isCurrent(),
      onChapterStart: (step, position) => update({ ordinal: step.ordinal, ...position }),
      onRecorded: (record) => void showUsage(record).catch(() => undefined),
      onLeaveChapter: closeWriteBatchTab,
    });
  } catch (error) {
    // 循环之外的错（比如开跑前显示用量就读不出来）：同样停下这一批。
    await stopWriteBatch({
      ...scope,
      code: 'run_not_started',
      message: `这一批出错停下：${errorText(error)}`,
    }).catch(() => undefined);
    return { kind: 'ended', error: errorText(error) };
  } finally {
    revokeWriteBatchGrant(run.grant);
  }
}

/** 换作品或卸载：这一批就地停下，授权撤掉，进行中的这一轮也停掉；晚到的结果不归这里管。 */
export function leaveWriteBatch(
  run: WriteBatchRun | null,
  pending: { project: string; batchId: string } | null,
): void {
  const left = run ?? pending;
  if (!left) return;
  if (run) {
    revokeWriteBatchGrant(run.grant);
    if (run.inFlightRunId)
      void sendAgentControlMessage({
        sessionId: run.inFlightRunId,
        runId: run.inFlightRunId,
        type: 'stop_run',
        payload: { source: 'desktop.write-batch' },
      }).catch(() => undefined);
  }
  void stopWriteBatch({
    projectRoot: left.project,
    batchId: left.batchId,
    code: 'author_stopped',
    message: LEFT_MESSAGE,
  }).catch((error: unknown) =>
    emitToast(`批量写章没能停下：${errorText(error)}`, { tone: 'error' }),
  );
}

/** 停下 / 写完那张卡：记录、能不能续写都照引擎读回来的说。 */
export async function buildWriteBatchResult(
  project: string,
  view: Pick<ApiWriteBatchView, 'batch' | 'can_resume' | 'resume_from'>,
  extra: { error?: string | null; notice?: string | null } = {},
): Promise<WriteBatchResult> {
  const batch = view.batch;
  return {
    batch,
    canResume: view.can_resume,
    resumeFrom: view.resume_from,
    titles: batch ? (memory.get(memoryKey(project, batch.id))?.titles ?? {}) : {},
    used: batch ? await formatWriteBatchTokens(batchUsedTokens(batch)) : null,
    error: extra.error ?? null,
    notice: extra.notice ?? null,
    pending: false,
  };
}

/** 读不出记录时的卡：只有出错原因和「关闭」。 */
export function failedWriteBatchResult(error: string): WriteBatchResult {
  return {
    batch: null,
    canResume: false,
    resumeFrom: null,
    titles: {},
    used: null,
    error,
    notice: null,
    pending: false,
  };
}
