/**
 * `/写` 批量写章的调度循环（方案 docs/internal/write-batch-plan-2026-10.md 第 2、6 节）：
 * 问引擎下一步 → 发起这一章 → 等它写进文件、事实记账落定 → 记一笔 → 再问下一步。
 * 判断全在引擎里（写哪章、停不停、为什么停）；这里只按顺序发起、等待，出错就停下、不重试别的章。
 * 不碰 React，依赖全由调度器注入，好让时序可以单独钉住。
 */
import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ApiWriteBatch, ApiWriteBatchStep } from '../../lib/api/contracts';
import type { WriteBatchInterfaceStopCode } from '../../lib/api/write-batch';
import type { ChapterWriteback } from '../../lib/write-batch-writeback';
import type { RunAuthorAgentOutcome } from './types';

export type WriteBatchWriteStep = Extract<ApiWriteBatchStep, { action: 'write' }>;
export type WriteBatchPosition = { index: number; total: number };

export type WriteBatchLoopDeps = {
  next: (input: {
    permissionProfile: AgentPermissionProfile;
    modelKey: string;
  }) => Promise<ApiWriteBatchStep>;
  record: (input: {
    ordinal: number;
    runId: string;
    writtenPath: string | null;
    snapshotVersion: string | null;
    factsBefore: string | null;
    factDisputes: number;
  }) => Promise<ApiWriteBatch>;
  stop: (input: { code: WriteBatchInterfaceStopCode; message: string }) => Promise<ApiWriteBatch>;
  /** 作者这会儿存的档位：每问一次下一步都重新读，改成只读引擎就停。 */
  permissionProfile: () => AgentPermissionProfile;
  modelKey: () => Promise<string>;
  /** 发起这一章（调度器拼好话、带上这一批的授权），等到这一轮的终态。 */
  dispatch: (
    step: WriteBatchWriteStep,
    position: WriteBatchPosition,
  ) => Promise<RunAuthorAgentOutcome>;
  /** 等这一轮的修订写进文件、事实记账落定。 */
  awaitWriteback: (runId: string) => Promise<ChapterWriteback>;
  /** 这一段要写几章（计划里要写的），进度条上的分母。 */
  total: number;
  stopRequested: () => boolean;
  /** 还归这个调度器管（没换作品、没卸载）；不归了就什么也不写，悄悄退出。 */
  alive: () => boolean;
  onChapterStart?: (step: WriteBatchWriteStep, position: WriteBatchPosition) => void;
  onRecorded?: (batch: ApiWriteBatch) => void;
  /** 上一章写进了这个文件、下一章要开写：调度器打开的页签可以关了（最后一章不会走到这里）。 */
  onLeaveChapter?: (filePath: string) => void;
};

/** ended：批量记录已经落成写完或停下（error 是出错停下时给作者看的原因）；abandoned：不归这里管了。 */
export type WriteBatchLoopEnd = { kind: 'ended'; error: string | null } | { kind: 'abandoned' };

const ABANDONED: WriteBatchLoopEnd = { kind: 'abandoned' };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const AUTHOR_STOP_MESSAGE = '你按了停止，这一批停下了。';

export async function runWriteBatchLoop(deps: WriteBatchLoopDeps): Promise<WriteBatchLoopEnd> {
  let index = 0;
  let current: number | null = null;
  // 上一章写进的文件：等下一章真要开写时才关它的页签，最后一章留着。
  let leaving: string | null = null;
  const stop = async (code: WriteBatchInterfaceStopCode, message: string) => {
    await deps.stop({ code, message });
    return { kind: 'ended', error: null } as const;
  };
  try {
    for (;;) {
      if (!deps.alive()) return ABANDONED;
      if (deps.stopRequested()) return await stop('author_stopped', AUTHOR_STOP_MESSAGE);
      const step = await deps.next({
        permissionProfile: deps.permissionProfile(),
        modelKey: await deps.modelKey(),
      });
      if (!deps.alive()) return ABANDONED;
      if (step.action !== 'write') return { kind: 'ended', error: null };
      if (deps.stopRequested()) return await stop('author_stopped', AUTHOR_STOP_MESSAGE);
      if (leaving !== null) deps.onLeaveChapter?.(leaving);
      leaving = null;
      index += 1;
      current = step.ordinal;
      const position = { index, total: Math.max(deps.total, index) };
      deps.onChapterStart?.(step, position);
      const outcome = await deps.dispatch(step, position);
      if (!deps.alive()) return ABANDONED;
      if (outcome.kind === 'not_dispatched')
        return await stop(
          'run_not_started',
          `第 ${step.ordinal} 章没能开跑：AI 正忙，或上一轮的结果还不确定。`,
        );
      if (outcome.kind === 'unsettled')
        return await stop(
          'scheduler_error',
          `第 ${step.ordinal} 章这一轮的结果拿不到（连接断了或结果未知）：先核对这一轮，再续写。`,
        );
      const { proposal } = outcome;
      // 要作者点接受的、没交出修订的，都不等写进文件，直接记，交给引擎判。
      const writeback =
        proposal !== null && !proposal.requiresConfirmation
          ? await deps.awaitWriteback(outcome.runId)
          : null;
      if (!deps.alive()) return ABANDONED;
      const written = writeback?.written ? writeback : null;
      const batch = await deps.record({
        ordinal: step.ordinal,
        runId: outcome.runId,
        writtenPath: written?.filePath ?? null,
        snapshotVersion: written?.snapshotVersion ?? null,
        factsBefore: written?.factsBefore ?? null,
        factDisputes: written?.factDisputes ?? 0,
      });
      if (!deps.alive()) return ABANDONED;
      deps.onRecorded?.(batch);
      if (written?.factError)
        return await stop(
          'scheduler_error',
          `第 ${step.ordinal} 章写进文件了，但事实没记上（${written.factError}）：` +
            '后面的章先不写，免得章纲漏读这一章的事实。处理好再续写。',
        );
      if (written !== null) leaving = written.filePath;
    }
  } catch (error) {
    if (!deps.alive()) return ABANDONED;
    const message = errorText(error);
    const where = current !== null ? `第 ${current} 章` : '这一批';
    try {
      await deps.stop({ code: 'scheduler_error', message: `${where}出错停下：${message}` });
    } catch (stopError) {
      return { kind: 'ended', error: `${message}；停下时也出错了：${errorText(stopError)}` };
    }
    return { kind: 'ended', error: message };
  }
}
