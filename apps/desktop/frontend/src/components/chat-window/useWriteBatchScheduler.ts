import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AgentPermissionProfile } from '../../lib/agent-permission';
import type { ApiWriteBatch, ApiWriteBatchPlan } from '../../lib/api/contracts';
import {
  currentWriteBatchModelKey,
  markWriteBatchReviewed,
  previewWriteBatchResume,
  readWriteBatch,
  recoverInterruptedWriteBatch,
  resumeWriteBatch,
  startWriteBatch,
} from '../../lib/api/write-batch';
import { emitToast } from '../../lib/toast';
import type { WriteBatchStartFeedback } from './WriteBatchCard';
import {
  buildWriteBatchResult,
  createWriteBatchRun,
  driveWriteBatchRun,
  failedWriteBatchResult,
  leaveWriteBatch,
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
  /**
   * 续写确认：引擎只读出的续写计划（记录没动），作者点开始才真续写。
   * note 是这一批记录里作者附的要求。
   */
  | { kind: 'confirming'; plan: ApiWriteBatchPlan; note: string | null }
  | { kind: 'running'; progress: WriteBatchProgress }
  | { kind: 'result'; result: WriteBatchResult };

const IDLE: WriteBatchPhase = { kind: 'idle' };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
      leaveWriteBatch(runRef.current);
      runRef.current = null;
    };
  }, [projectPath]);

  /** 停下 / 写完以后读一遍记录（章名、能不能续写由引擎说），出卡。 */
  const showLatest = useCallback(
    async (
      owner: WriteBatchOwner,
      project: string,
      extra: { error?: string | null; notice?: string | null },
    ) => {
      try {
        const view = await readWriteBatch(project);
        setPhase(owner, { kind: 'result', result: await buildWriteBatchResult(view, extra) });
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
      const result = await buildWriteBatchResult(view);
      if (!owner.active || runRef.current) return;
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
    ) => {
      const run = createWriteBatchRun(project, batch, plan);
      runRef.current = run;
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
          note,
        });
        if (!owner.active) return {};
        if (!result.started) return { plan: result.plan };
        void runBatch(owner, project, result.batch, result.plan);
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

  /** 续写前只读出计划（记录不动），交给确认卡；作者点开始才真续写。 */
  const preview = useCallback(
    async (owner: WriteBatchOwner, project: string, note: string | null) => {
      const plan = await previewWriteBatchResume({
        projectRoot: project,
        permissionProfile: latest.current.permissionProfile,
        modelKey: await currentWriteBatchModelKey(),
      });
      setPhase(owner, { kind: 'confirming', plan, note });
    },
    [setPhase],
  );

  const resumeFromResult = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    if (!project || runRef.current) return;
    updateResult(owner, { pending: true, error: null });
    const note = lastResultRef.current?.batch?.note ?? null;
    preview(owner, project, note).catch((error: unknown) =>
      updateResult(owner, { pending: false, error: `没能续写：${errorText(error)}` }),
    );
  }, [preview, updateResult]);

  /** 对话里打了不带范围的 `/写`：停下的那一批就走续写确认，不能续在卡上说明原因。 */
  const resumeFromCommand = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    if (!project || runRef.current) return;
    void (async () => {
      const view = await readWriteBatch(project);
      const batch = view.batch;
      if (batch?.status === 'stopped') {
        // 先把停下的卡垫在下面：确认卡上取消就回到它。
        lastResultRef.current = await buildWriteBatchResult(view);
        return preview(owner, project, batch.note);
      }
      const notice = !batch
        ? '这部作品还没有批量写章的记录，没有可续写的。'
        : batch.status === 'running'
          ? '上一批还在写。'
          : batch.reviewed
            ? '上一批已经写完、审完了，没有可续写的。'
            : '上一批已经写完了，没有可续写的：看过以后点「这批审完了」。';
      setPhase(owner, { kind: 'result', result: await buildWriteBatchResult(view, { notice }) });
    })().catch((error: unknown) =>
      setPhase(owner, {
        kind: 'result',
        result: failedWriteBatchResult(`没能续写：${errorText(error)}`),
      }),
    );
  }, [preview, setPhase]);

  /** 续写确认卡上点了「开始写」：这时才真续写（引擎新开一段），开得了就接着循环。 */
  const confirmResume = useCallback(async (): Promise<WriteBatchStartFeedback> => {
    const owner = ownerRef.current;
    const project = owner.project;
    if (!project || runRef.current) return { error: '已经有一批在写了。' };
    try {
      const result = await resumeWriteBatch({
        projectRoot: project,
        permissionProfile: latest.current.permissionProfile,
        modelKey: await currentWriteBatchModelKey(),
      });
      if (!owner.active) return {};
      if (result.started) {
        void runBatch(owner, project, result.batch, result.plan);
        return { started: true };
      }
      if (result.batch?.status === 'finished') {
        // 确认这会儿章都有了正文：引擎记成写完，说明去审完。
        await showLatest(owner, project, { notice: result.plan.blockers[0]?.message ?? null });
        return { started: true };
      }
      return { plan: result.plan };
    } catch (error) {
      return { error: errorText(error) };
    }
  }, [runBatch, showLatest]);

  /** 续写确认卡上点了取消 / 关闭：什么都没动，回到原来那张卡。 */
  const cancelConfirm = useCallback(() => {
    const owner = ownerRef.current;
    const result = lastResultRef.current;
    setPhase(owner, result ? { kind: 'result', result: { ...result, pending: false } } : IDLE);
  }, [setPhase]);

  const markReviewed = useCallback(() => {
    const owner = ownerRef.current;
    const project = owner.project;
    const batch = lastResultRef.current?.batch;
    if (!project || !batch) return;
    updateResult(owner, { pending: true, error: null });
    markWriteBatchReviewed(project, batch.id).then(
      // 章名是读记录时取的，标审完的回包里没有：只换「审完了」这一位。
      (record) =>
        updateResult(owner, { pending: false, batch: { ...batch, reviewed: record.reviewed } }),
      (error: unknown) =>
        updateResult(owner, { pending: false, error: `没能标审完：${errorText(error)}` }),
    );
  }, [updateResult]);

  const closeResult = useCallback(() => setPhase(ownerRef.current, IDLE), [setPhase]);

  return {
    phase,
    /** 批量在写：不能发别的话、不能切换或新建会话。 */
    occupied: phase.kind === 'running',
    running: phase.kind === 'running',
    /** 续写确认卡开着：和 `/写` 确认卡一样，别的话先不发、起草快捷入口收起。 */
    confirming: phase.kind === 'confirming',
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
