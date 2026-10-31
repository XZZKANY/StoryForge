/**
 * 批量写章调度器里不碰 React 的部分：一批开跑时的授权、逐章发起、接循环、换作品时就地停下、
 * 停下 / 写完后出卡用的结果。作者要求与章名都用引擎给的（记录里有，重开应用也在）。
 * 状态与按钮在 useWriteBatchScheduler。
 */
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import { sendAgentControlMessage } from '../../lib/api-client';
import type {
  ApiWriteBatch,
  ApiWriteBatchMismatch,
  ApiWriteBatchPlan,
  ApiWriteBatchUndoPlan,
  ApiWriteBatchView,
  ApiWriteBatchViewRecord,
} from '../../lib/api/contracts';
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
  bindWriteBatchRun,
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
import { batchUsedTokens } from './write-batch-view';
import type { RunAuthorAgent, RunAuthorAgentOutcome } from './types';
import type { ChatWindowState } from './useChatWindowState';

/** 等一章写进文件、事实记账落定的上限：整本书拍快照加记账，几秒到几十秒；过了就当被拦下。 */
export const WRITE_BATCH_WRITEBACK_TIMEOUT_MS = 180_000;

/** 这一批里的一章：去向是引擎记录里的，章名是开跑时计划里的。 */
export type WriteBatchProgressChapter = {
  ordinal: number;
  title: string | null;
  state: ApiWriteBatch['chapters'][number]['state'];
  /** 作品内相对路径。 */
  targetPath: string;
  /** 写进文件时记下的字数；没写或没记为 null。 */
  chars: number | null;
};

export type WriteBatchProgress = {
  ordinal: number | null;
  index: number;
  total: number;
  used: string | null;
  /** 试写段没有上限，为 null。 */
  cap: string | null;
  stopping: boolean;
  /** 引擎最近一次记下的每章去向；还没读到记录时为空。 */
  chapters: WriteBatchProgressChapter[];
};

export type WriteBatchResult = {
  /** 引擎读回来的记录，每章带着连载计划里的标题与本章目标。 */
  batch: ApiWriteBatchViewRecord | null;
  /** 引擎标出的记录与正文对不上的章。 */
  mismatches: ApiWriteBatchMismatch[];
  canResume: boolean;
  resumeFrom: number | null;
  /** 这一批一共用了多少（按「万」说）。 */
  used: string | null;
  /** 最近一段的预估与上限（按「万」说）；试写段没有，为 null。 */
  estimate: string | null;
  cap: string | null;
  /** 开跑加续跑一共几段：不止一段时预估与上限说的是最近一段。 */
  legs: number;
  /** 每章用量（按「万」说），没记过的章没有。 */
  chapterTokens: Record<number, string>;
  /** 「撤销这章及之后」不能撤的原因；什么都没动。 */
  undoBlockers: string[];
  /** 「撤销这章及之后」第一次点过、引擎说能撤：等作者第二次点确认（第 from–to 章，台账比对的结论）。 */
  undoConfirm: {
    from: number;
    to: number;
    factsLedger: ApiWriteBatchUndoPlan['facts_ledger'];
  } | null;
  error: string | null;
  notice: string | null;
  /** 正在标审完、续写或撤销，按钮先不让点。 */
  pending: boolean;
};

/** 调度器归属：换作品或卸载就失效，晚到的结果一律不写。 */
export type WriteBatchOwner = { project: string | null; active: boolean; abort: AbortController };

export type WriteBatchRun = {
  project: string;
  batchId: string;
  grant: WriteBatchGrant;
  total: number;
  /** 计划里的章名，记录里没有。 */
  titles: ReadonlyMap<number, string | null>;
  stopRequested: boolean;
  inFlightRunId: string | null;
};

export type WriteBatchChat = Pick<ChatWindowState, 'setMessages' | 'agentRunIdRef'> & {
  runAuthorAgent: RunAuthorAgent;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LEFT_MESSAGE = '换了作品或关掉了对话，这一批停下了。';

/** 开跑或续跑：只给这一段计划里要写的章发授权。 */
export function createWriteBatchRun(
  project: string,
  batch: ApiWriteBatch,
  plan: ApiWriteBatchPlan,
): WriteBatchRun {
  const writing = plan.chapters.filter((chapter) => chapter.status === 'write');
  return {
    project,
    batchId: batch.id,
    grant: issueWriteBatchGrant({
      projectPath: project,
      batchId: batch.id,
      targets: writing.map((chapter) => chapter.target_path),
    }),
    total: writing.length,
    titles: new Map(plan.chapters.map((chapter) => [chapter.ordinal, chapter.title])),
    stopRequested: false,
    inFlightRunId: null,
  };
}

/**
 * 发起这一章：拼好作者那句话进对话（作者附的要求用引擎记下的 step.note），带上这一批的授权交给
 * runAuthorAgent，等这一轮的终态。
 */
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
    (step.note ? `\n作者要求：${step.note}` : '');
  chat.setMessages((prev) => [...prev, { role: 'user', content: goal }]);
  const before = chat.agentRunIdRef.current;
  const pending = chat.runAuthorAgent(goal, 'agent', 'chapter.write', [], {
    targetFilePath: step.target_path,
    writeBatchGrant: run.grant,
  });
  // runAuthorAgent 在第一次 await 之前就换上了这一轮的 id：记下来，作者停止或换作品时停的是它。
  const started = chat.agentRunIdRef.current;
  run.inFlightRunId = started && started !== before ? started : null;
  // 这一章自动写进文件时不逐章弹撤销提示：撤销改由清单提供。
  if (run.inFlightRunId) bindWriteBatchRun(run.grant, run.inFlightRunId);
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
    chapters: [],
  };
  const update = (patch: Partial<WriteBatchProgress>) => {
    progress = { ...progress, ...patch, stopping: run.stopRequested };
    if (isCurrent()) show(progress);
  };
  const showChapters = (record: ApiWriteBatch) =>
    update({
      chapters: record.chapters.map((chapter) => ({
        ordinal: chapter.ordinal,
        title: run.titles.get(chapter.ordinal) ?? null,
        state: chapter.state,
        targetPath: chapter.target_path,
        chars: chapter.chars,
      })),
    });
  const showUsage = async (record: ApiWriteBatch) => {
    const leg = record.legs[record.legs.length - 1];
    if (!leg) return;
    const used = await formatWriteBatchTokens(leg.used_tokens);
    const cap = leg.cap_tokens === null ? null : await formatWriteBatchTokens(leg.cap_tokens);
    update({ used, cap });
  };
  showChapters(batch);
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
      onRecorded: (record) => {
        showChapters(record);
        void showUsage(record).catch(() => undefined);
      },
      onLeaveChapter: closeWriteBatchTab,
    });
  } catch (error) {
    // 循环之外的错（比如开跑前显示用量就读不出来）：同样停下这一批。
    await stopWriteBatch({
      ...scope,
      code: 'scheduler_error',
      message: `这一批出错停下：${errorText(error)}`,
    }).catch(() => undefined);
    return { kind: 'ended', error: errorText(error) };
  } finally {
    revokeWriteBatchGrant(run.grant);
  }
}

/** 换作品或卸载：这一批就地停下，授权撤掉，进行中的这一轮也停掉；晚到的结果不归这里管。 */
export function leaveWriteBatch(run: WriteBatchRun | null): void {
  if (!run) return;
  revokeWriteBatchGrant(run.grant);
  if (run.inFlightRunId)
    void sendAgentControlMessage({
      sessionId: run.inFlightRunId,
      runId: run.inFlightRunId,
      type: 'stop_run',
      payload: { source: 'desktop.write-batch' },
    }).catch(() => undefined);
  void stopWriteBatch({
    projectRoot: run.project,
    batchId: run.batchId,
    code: 'author_stopped',
    message: LEFT_MESSAGE,
  }).catch((error: unknown) =>
    emitToast(`批量写章没能停下：${errorText(error)}`, { tone: 'error' }),
  );
}

const formatOrNull = async (tokens: number | null | undefined) =>
  tokens === null || tokens === undefined ? null : formatWriteBatchTokens(tokens);

/** 停下 / 写完那张清单：记录、章名、对不上的章、能不能续写都照引擎读回来的说。 */
export async function buildWriteBatchResult(
  view: Pick<ApiWriteBatchView, 'batch' | 'can_resume' | 'resume_from'> &
    Partial<Pick<ApiWriteBatchView, 'mismatches'>>,
  extra: { error?: string | null; notice?: string | null } = {},
): Promise<WriteBatchResult> {
  const batch = view.batch;
  const leg = batch?.legs[batch.legs.length - 1];
  const chapterTokens: Record<number, string> = {};
  for (const chapter of batch?.chapters ?? [])
    if (chapter.tokens !== null)
      chapterTokens[chapter.ordinal] = await formatWriteBatchTokens(chapter.tokens);
  return {
    batch,
    mismatches: view.mismatches ?? [],
    canResume: view.can_resume,
    resumeFrom: view.resume_from,
    used: batch ? await formatWriteBatchTokens(batchUsedTokens(batch)) : null,
    estimate: await formatOrNull(leg?.estimated_tokens),
    cap: await formatOrNull(leg?.cap_tokens),
    legs: batch?.legs.length ?? 0,
    chapterTokens,
    undoBlockers: [],
    undoConfirm: null,
    error: extra.error ?? null,
    notice: extra.notice ?? null,
    pending: false,
  };
}

/** 读不出记录时的卡：只有出错原因和「关闭」。 */
export function failedWriteBatchResult(error: string): WriteBatchResult {
  return {
    batch: null,
    mismatches: [],
    canResume: false,
    resumeFrom: null,
    used: null,
    estimate: null,
    cap: null,
    legs: 0,
    chapterTokens: {},
    undoBlockers: [],
    undoConfirm: null,
    error,
    notice: null,
    pending: false,
  };
}
