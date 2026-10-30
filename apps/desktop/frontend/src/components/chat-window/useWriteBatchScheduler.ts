import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ApiWriteBatch, ApiWriteBatchPlan } from '../../lib/api/contracts';
import {
  currentWriteBatchModelKey,
  markWriteBatchReviewed,
  readWriteBatch,
  recoverInterruptedWriteBatch,
  resumeWriteBatch,
  startWriteBatch,
  stopWriteBatch,
} from '../../lib/api/write-batch';
import { emitToast } from '../../lib/toast';
import type { WriteBatchStartFeedback } from './WriteBatchCard';
import {
  buildWriteBatchResult,
  createWriteBatchRun,
  driveWriteBatchRun,
  failedWriteBatchResult,
  leaveWriteBatch,
  rememberedNote,
  type WriteBatchOwner,
  type WriteBatchProgress,
  type WriteBatchResult,
  type WriteBatchRun,
} from './write-batch-run';
import type { RunAuthorAgent } from './types';
import type { ChatWindowState } from './useChatWindowState';

export type { WriteBatchProgress, WriteBatchResult } from './write-batch-run';

export type WriteBatchPhase =
  | { kind: 'idle' }
  /** 续写：引擎已重出计划（started 时已新开一段），等作者在确认卡上再点一次开始。 */
  | {
      kind: 'confirming';
      plan: ApiWriteBatchPlan;
      batch: ApiWriteBatch | null;
      started: boolean;
      /** 作者开这一批时附的要求（记在内存里，重开应用后就没了）。 */
      note: string | null;
    }
  | { kind: 'running'; progress: WriteBatchProgress }
  | { kind: 'result'; result: WriteBatchResult };

const IDLE: WriteBatchPhase = { kind: 'idle' };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const CANCEL_MESSAGE = '续写没有开始：你在确认卡上点了取消。';

/**
 * `/写` 批量写章调度器（E 刀）：确认卡上点了开始，就一章接一章地发起写章、等写进文件和事实记账落定、
 * 记一笔、问引擎下一步；停与续、重开作品后的提示。判断全在引擎里，这里只管发起、等待、出卡。
 * 状态按作品记：换作品或卸载，这一批就地停下，晚到的结果不写进别的作品。
 */
export function useWriteBatchScheduler({
  state,
  runAuthorAgent,
  stopCurrentRun,
  projectPath,
  permissionProfile,
}: {
  state: Pick<ChatWindowState, 'setMessages' | 'agentRunIdRef'>;
  runAuthorAgent: RunAuthorAgent;
  /** 现有的「停止本轮」控制。 */
  stopCurrentRun: () => void;
  projectPath: string | null;
  /** 作者为这部作品存的档位（不是这一批升过的）。 */
  permissionProfile: AgentPermissionProfile;
}) {
  const [owned, setOwned] = useState<{ project: string | null; phase: WriteBatchPhase }>({
    project: projectPath,
    phase: IDLE,
  });
  const phase = owned.project === projectPath ? owned.phase : IDLE;
  const latest = useRef({ runAuthorAgent, stopCurrentRun, permissionProfile, state });
  useLayoutEffect(() => {
    latest.current = { runAuthorAgent, stopCurrentRun, permissionProfile, state };
  });
  const ownerRef = useRef<WriteBatchOwner>({
    project: null,
    active: false,
    abort: new AbortController(),
  });
  const runRef = useRef<WriteBatchRun | null>(null);
  const pendingResumeRef = useRef<{ project: string; batchId: string } | null>(null);
  const lastResultRef = useRef<WriteBatchResult | null>(null);

  const setPhase = useCallback((owner: WriteBatchOwner, next: WriteBatchPhase) => {
    if (!owner.active) return;
    if (next.kind === 'result') lastResultRef.current = next.result;
    setOwned({ project: owner.project, phase: next });
  }, []);

  useLayoutEffect(() => {
    const owner: WriteBatchOwner = {
      project: projectPath,
      active: true,
      abort: new AbortController(),
    };
    ownerRef.current = owner;
    lastResultRef.current = null;
    return () => {
      owner.active = false;
      owner.abort.abort();
      leaveWriteBatch(runRef.current, pendingResumeRef.current);
      runRef.current = null;
      pendingResumeRef.current = null;
    };
  }, [projectPath]);

  /** 停下 / 写完以后读一遍记录（能不能续写由引擎说），出卡。 */
  const showLatest = useCallback(
    async (
      owner: WriteBatchOwner,
      project: string,
      extra: { error?: string | null; notice?: string | null },
    ) => {
      try {
        const view = await readWriteBatch(project);
        setPhase(owner, {
          kind: 'result',
          result: await buildWriteBatchResult(project, view, extra),
        });
      } catch (error) {
        const message = [extra.error, `读不出批量记录：${errorText(error)}`].filter(Boolean);
        setPhase(owner, { kind: 'result', result: failedWriteBatchResult(message.join('；')) });
      }
    },
    [setPhase],
  );

  // 打开作品：上次关应用时还在写的那一批改成停下（不自动续）；停下或写完却没审完的，出那张卡。
  useEffect(() => {
    if (!projectPath) return;
    const owner = ownerRef.current;
    void (async () => {
      await recoverInterruptedWriteBatch(projectPath);
      const view = await readWriteBatch(projectPath);
      const batch = view.batch;
      if (!owner.active || !batch || batch.status === 'running' || batch.reviewed) return;
      const result = await buildWriteBatchResult(projectPath, view);
      if (!owner.active || runRef.current || pendingResumeRef.current) return;
      lastResultRef.current = result;
      setOwned((current) =>
        current.project === projectPath && current.phase.kind !== 'idle'
          ? current
          : { project: projectPath, phase: { kind: 'result', result } },
      );
    })().catch((error: unknown) => {
      if (owner.active)
        emitToast(`读不出上一批批量写章的记录：${errorText(error)}`, { tone: 'error' });
    });
  }, [projectPath]);

  const runBatch = useCallback(
    async (
      owner: WriteBatchOwner,
      project: string,
      batch: ApiWriteBatch,
      plan: ApiWriteBatchPlan,
      note: string | null,
    ) => {
      const run = createWriteBatchRun(project, batch, plan, note);
      runRef.current = run;
      pendingResumeRef.current = null;
      const end = await driveWriteBatchRun({
        run,
        owner,
        batch,
        isCurrent: () => runRef.current === run,
        chat: () => ({ ...latest.current.state, runAuthorAgent: latest.current.runAuthorAgent }),
        permissionProfile: () => latest.current.permissionProfile,
        show: (progress) => setPhase(owner, { kind: 'running', progress }),
      });
      if (runRef.current === run) runRef.current = null;
      if (end.kind === 'abandoned' || !owner.active) return;
      await showLatest(owner, project, { error: end.error });
    },
    [setPhase, showLatest],
  );

  /** 确认卡上点了「开始写」：引擎重出一次计划，开得了就开跑；开不了把新计划交回卡片。 */
  const start = useCallback(
    async (plan: ApiWriteBatchPlan, note: string | null): Promise<WriteBatchStartFeedback> => {
      const owner = ownerRef.current;
      const project = owner.project;
      if (!project || runRef.current) return { error: '已经有一批在写了。' };
      try {
        const result = await startWriteBatch({
          projectRoot: project,
          from: plan.from,
          to: plan.to,
          permissionProfile: latest.current.permissionProfile,
          modelKey: await currentWriteBatchModelKey(),
        });
        if (!owner.active) return {};
        if (!result.started) return { plan: result.plan };
        void runBatch(owner, project, result.batch, result.plan, note);
        return { started: true };
      } catch (error) {
        return { error: errorText(error) };
      }
    },
    [runBatch],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run || run.stopRequested) return;
    run.stopRequested = true;
    setOwned((current) =>
      current.phase.kind === 'running'
        ? {
            ...current,
            phase: { kind: 'running', progress: { ...current.phase.progress, stopping: true } },
          }
        : current,
    );
    // 正在跑的这一轮走现有的「停止本轮」；在等写进文件的就让它写完、记上，再停。
    if (run.inFlightRunId) latest.current.stopCurrentRun();
  }, []);

  const updateResult = useCallback(
    (owner: WriteBatchOwner, patch: Partial<WriteBatchResult>) => {
      const result = lastResultRef.current;
      if (result) setPhase(owner, { kind: 'result', result: { ...result, ...patch } });
    },
    [setPhase],
  );

  /** 续写最近一批：引擎重出计划、新开一段，交给确认卡让作者再点一次开始。 */
  const resume = useCallback(
    async (owner: WriteBatchOwner, project: string) => {
      const result = await resumeWriteBatch({
        projectRoot: project,
        permissionProfile: latest.current.permissionProfile,
        modelKey: await currentWriteBatchModelKey(),
      });
      if (!owner.active) return;
      if (!result.started && result.batch?.status === 'finished') {
        // 这一批的章都有正文了：引擎把它记成写完，说明去审完。
        await showLatest(owner, project, { notice: result.plan.blockers[0]?.message ?? null });
        return;
      }
      if (result.started) pendingResumeRef.current = { project, batchId: result.batch.id };
      setPhase(owner, {
        kind: 'confirming',
        plan: result.plan,
        batch: result.batch,
        started: result.started,
        note: result.batch ? rememberedNote(project, result.batch.id) : null,
      });
    },
    [setPhase, showLatest],
  );

  const resumeFromResult = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    if (!project || runRef.current) return;
    updateResult(owner, { pending: true, error: null });
    resume(owner, project).catch((error: unknown) =>
      updateResult(owner, { pending: false, error: `没能续写：${errorText(error)}` }),
    );
  }, [resume, updateResult]);

  /** 对话里打了不带范围的 `/写`：能续就走续写，不能续在卡上说明原因。 */
  const resumeFromCommand = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    if (!project || runRef.current) return;
    void (async () => {
      const view = await readWriteBatch(project);
      const batch = view.batch;
      // 停下了却续不了（章都有正文了）也交给引擎：它会记成写完并说明去审完。
      if (view.can_resume || batch?.status === 'stopped') return resume(owner, project);
      const notice = !batch
        ? '这部作品还没有批量写章的记录，没有可续写的。'
        : batch.status === 'running'
          ? '上一批还在写。'
          : batch.reviewed
            ? '上一批已经写完、审完了，没有可续写的。'
            : '上一批已经写完了，没有可续写的：看过以后点「这批审完了」。';
      setPhase(owner, {
        kind: 'result',
        result: await buildWriteBatchResult(project, view, { notice }),
      });
    })().catch((error: unknown) =>
      setPhase(owner, {
        kind: 'result',
        result: failedWriteBatchResult(`没能续写：${errorText(error)}`),
      }),
    );
  }, [resume, setPhase]);

  /** 续写确认卡上点了「开始写」：这一段已经开好，直接接着循环。 */
  const confirmResume = useCallback(
    async (plan: ApiWriteBatchPlan): Promise<WriteBatchStartFeedback> => {
      const owner = ownerRef.current;
      const project = owner.project;
      const current = owned.phase;
      if (!project || current.kind !== 'confirming' || !current.started || !current.batch)
        return { error: '这次续写已经不在了，再点一次「接着写」。' };
      void runBatch(owner, project, current.batch, plan, current.note);
      return { started: true };
    },
    [owned.phase, runBatch],
  );

  /** 续写确认卡上点了取消 / 关闭：开好的那一段停回去，回到停下的卡。 */
  const cancelConfirm = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    const pending = pendingResumeRef.current;
    pendingResumeRef.current = null;
    if (!project || !pending) {
      const result = lastResultRef.current;
      setPhase(owner, result ? { kind: 'result', result: { ...result, pending: false } } : IDLE);
      return;
    }
    stopWriteBatch({
      projectRoot: project,
      batchId: pending.batchId,
      code: 'author_stopped',
      message: CANCEL_MESSAGE,
    })
      .then(() => showLatest(owner, project, {}))
      .catch((error: unknown) =>
        showLatest(owner, project, { error: `没能停回去：${errorText(error)}` }),
      );
  }, [setPhase, showLatest]);

  const markReviewed = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    const batch = lastResultRef.current?.batch;
    if (!project || !batch) return;
    updateResult(owner, { pending: true, error: null });
    markWriteBatchReviewed(project, batch.id).then(
      (record) => updateResult(owner, { pending: false, batch: record }),
      (error: unknown) =>
        updateResult(owner, { pending: false, error: `没能标审完：${errorText(error)}` }),
    );
  }, [updateResult]);

  const closeResult = useCallback(() => setPhase(ownerRef.current, IDLE), [setPhase]);

  return {
    phase,
    /** 批量占着对话：在写，或续写开好了一段等确认。这时不能发别的话、不能切换或新建会话。 */
    occupied: phase.kind === 'running' || (phase.kind === 'confirming' && phase.started),
    running: phase.kind === 'running',
    start,
    stop,
    resumeFromResult,
    resumeFromCommand,
    confirmResume,
    cancelConfirm,
    markReviewed,
    closeResult,
  };
}

export type WriteBatchScheduler = ReturnType<typeof useWriteBatchScheduler>;
