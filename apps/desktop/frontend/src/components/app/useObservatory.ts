/**
 * 世界线观测：打开项目即首扫，写盘后防抖重扫（observatory.scan 为本地确定性纯函数，无 LLM 零成本）。
 *
 * 数据流：executeIdeCommand('observatory.scan') → payload.observatory → mapObservatoryPayload
 * → ObsPanel/StatusBar。已处理态（resolved）按稳定 id 记在前端，跨扫描保留；按项目落盘，跨重启保留。
 * 过期响应守卫：项目切换或新扫描发起后，旧响应一律丢弃（同 F26 会话切换守卫纪律）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppDialogApi } from './AppDialog';
import type { Observation, ObservationAvailability } from '../shell/ObsPanel';
import { executeIdeCommand } from '../../lib/api/ide-commands';
import { EDITOR_CURSOR_LINE_EVENT, type EditorCursorLineDetail } from '../../lib/assistant-events';
import {
  applyCanonMerge,
  applyPromiseResolved,
  type CanonDeclaration,
  type CanonMergeTarget,
} from '../../lib/canon-merge';
import { writeCanonGuarded } from '../../lib/canon-write';
import {
  BACKFILL_BATCH,
  listUnrecordedChapters,
  type UnrecordedChapter,
} from '../../lib/api/facts';
import {
  backfillFactsGuarded,
  backfillMessage,
  resolveDisputeGuarded,
  retireFactGuarded,
} from '../../lib/fact-write';
import {
  DISMISSED_PROPOSALS_EVENT,
  loadDismissedProposals,
  proposalKey,
  saveDismissedProposals,
  withoutDismissed,
} from '../../lib/dismissed-proposals';
import { emitToast } from '../../lib/toast';
import { FS_MUTATION_EVENT } from '../../lib/tauri-fs';
import {
  EMPTY_OBSERVATORY_PROMISES,
  EMPTY_OBSERVATORY_PROPOSALS,
  factLabel,
  loadResolvedObservationIds,
  NO_OBSERVATORY_FACTS,
  mapObservatoryPayload,
  matchEntityIdsInLine,
  saveResolvedObservationIds,
  type ObservatoryChecker,
  type ObservatoryDispute,
  type ObservatoryEntity,
  type ObservatoryFact,
  type ObservatoryFacts,
  type ObservatoryPromise,
  type ObservatoryPromises,
  type ObservatoryProposals,
} from '../../lib/observations';

// 写盘密集时合并重扫：autoSave 防抖 900ms，再叠 1200ms 让连续小写只触发一次。
const RESCAN_DEBOUNCE_MS = 1200;

type ObservatoryState = {
  observations: Observation[];
  checkers: ObservatoryChecker[];
  entities: ObservatoryEntity[];
  promises: ObservatoryPromises;
  proposals: ObservatoryProposals;
  facts: ObservatoryFacts;
  generatedAt: string | null;
  availability: ObservationAvailability;
};

const EMPTY_STATE: ObservatoryState = {
  observations: [],
  checkers: [],
  entities: [],
  promises: EMPTY_OBSERVATORY_PROMISES,
  proposals: EMPTY_OBSERVATORY_PROPOSALS,
  facts: NO_OBSERVATORY_FACTS,
  generatedAt: null,
  availability: 'unavailable',
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Candidates = { project: string | null; chapters: UnrecordedChapter[] };
const NO_CANDIDATES: Candidates = { project: null, chapters: [] };
const CANON_WRITE_NOTE =
  '会写进 .storyforge/canon/canon.json。写之前先存一版快照，写完右下角可以撤销。';

export function useObservatory({
  activeProject,
  dialogs,
}: {
  activeProject: string | null;
  dialogs: Pick<AppDialogApi, 'confirm' | 'prompt'>;
}) {
  const [state, setState] = useState<ObservatoryState>(EMPTY_STATE);
  const [litEntityIds, setLitEntityIds] = useState<string[]>([]);
  // scanning 独立于 availability：已有数据时重扫仍静默保留旧观测（availability 停 available），
  // 但按钮要转圈给反馈——此前 spinner 绑 availability='loading' 故有数据时点重扫毫无反应。
  const [scanning, setScanning] = useState(false);
  const [merging, setMerging] = useState(false);
  // 补录候选按作品记：切书后新书的列表还没读回来时，旧书的章节不能拿去给新书补录。
  const [candidates, setCandidates] = useState(NO_CANDIDATES);
  const unrecorded = (candidates.project === activeProject ? candidates : NO_CANDIDATES).chapters;
  // 补录按作品记：在 A 补着时切到 B，B 不该看到 A 的进度，也不该被 A 的「正在补录」挡住。
  const [backfill, setBackfill] = useState<
    Readonly<Record<string, { done: number; total: number; path: string }>>
  >({});
  const backfillingRef = useRef<Set<string>>(new Set());
  const liveProjectRef = useRef(activeProject);
  const resolvedIdsRef = useRef<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const scanSeqRef = useRef(0);

  const runScan = useCallback(async () => {
    if (!activeProject) return;
    const seq = ++scanSeqRef.current;
    setScanning(true);
    // 已有数据时静默刷新（保持旧观测可见），首扫才显示 loading。
    setState((previous) => ({
      ...previous,
      availability: previous.availability === 'available' ? 'available' : 'loading',
    }));
    try {
      const result = await executeIdeCommand('observatory.scan', { project_root: activeProject });
      if (seq !== scanSeqRef.current) return;
      const payload = (result as { payload?: { observatory?: unknown } }).payload?.observatory;
      const mapped = mapObservatoryPayload(payload, resolvedIdsRef.current);
      setState({
        observations: mapped.observations,
        checkers: mapped.checkers,
        entities: mapped.entities,
        promises: mapped.promises,
        proposals: mapped.proposals,
        facts: mapped.facts,
        generatedAt: mapped.generatedAt,
        availability: 'available',
      });
      // 补录候选跟着扫描走：读不到只是不给补录入口，不挡观测镜。
      const missing = await listUnrecordedChapters(activeProject).catch((error: unknown) => {
        console.error('读取没记账的章失败', error);
        return [];
      });
      if (seq === scanSeqRef.current) setCandidates({ project: activeProject, chapters: missing });
    } catch (error) {
      if (seq !== scanSeqRef.current) return;
      console.error('观测重扫失败', error);
      // 已有旧数据时不打回 error（旧观测仍真实，只是未刷新）；首扫失败如实显示。
      setState((previous) => ({
        ...previous,
        availability: previous.availability === 'available' ? 'available' : 'error',
      }));
    } finally {
      // 只有最新一次扫描负责熄灭 spinner：被后发扫描顶替的旧扫描不抢关。
      if (seq === scanSeqRef.current) setScanning(false);
    }
  }, [activeProject]);

  // 项目切换：使在途响应过期、按项目换回已处理记忆与观测；打开项目即首扫。
  useEffect(() => {
    scanSeqRef.current += 1;
    liveProjectRef.current = activeProject;
    // 已处理标记按项目落盘（写作时刻 01）：此前只在内存，重启即全部复活，
    // 作者上次「这条我看过了」的判断白做一遍。
    resolvedIdsRef.current = loadResolvedObservationIds(activeProject);
    // 换项目重置观测态是外部 prop 驱动的本地清态（同 Editor 视图恢复的既有豁免）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      ...EMPTY_STATE,
      availability: activeProject ? 'loading' : 'unavailable',
    });
    setLitEntityIds([]);
    setScanning(false);
    setDismissed(loadDismissedProposals(activeProject));
    if (activeProject) void runScan();
  }, [activeProject, runScan]);

  // 光标行实体联动：编辑器广播行文本，按实体表面形匹配（纯确定性注意力提示，不下结论）。
  const entities = state.entities;
  useEffect(() => {
    if (!activeProject || entities.length === 0) return;
    const onCursorLine = (event: Event) => {
      const detail = (event as CustomEvent<EditorCursorLineDetail>).detail;
      if (!detail) return;
      setLitEntityIds((previous) => {
        const next = matchEntityIdsInLine(entities, detail.lineText ?? '');
        const unchanged =
          previous.length === next.length && previous.every((id, index) => id === next[index]);
        return unchanged ? previous : next;
      });
    };
    window.addEventListener(EDITOR_CURSOR_LINE_EVENT, onCursorLine);
    return () => window.removeEventListener(EDITOR_CURSOR_LINE_EVENT, onCursorLine);
  }, [activeProject, entities]);

  // 写盘后重扫：FS_MUTATION_EVENT 由 TauriFileSystem 各写操作 finally 广播（保存/补丁写回/新建等）。
  useEffect(() => {
    if (!activeProject) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFsMutation = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runScan(), RESCAN_DEBOUNCE_MS);
    };
    window.addEventListener(FS_MUTATION_EVENT, onFsMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(FS_MUTATION_EVENT, onFsMutation);
    };
  }, [activeProject, runScan]);

  const resolveObservation = useCallback(
    (id: string) => {
      resolvedIdsRef.current.add(id);
      saveResolvedObservationIds(activeProject, resolvedIdsRef.current);
      setState((previous) => ({
        ...previous,
        observations: previous.observations.map((observation) =>
          observation.id === id ? { ...observation, resolved: true } : observation,
        ),
      }));
    },
    [activeProject],
  );

  // 观测镜对 canon.json 的写（并入提案、伏笔已回收）都走 writeCanonGuarded：确认 → 快照 → 写 → 可撤销。
  // 写盘会触发 FS_MUTATION_EVENT，防抖重扫后已并入的提案从后端差集里自然消失。
  const writeCanon = useCallback(
    async ({
      edit,
      confirm,
      summary,
      done,
    }: {
      edit: (canon: CanonDeclaration['canon']) => CanonDeclaration['canon'];
      confirm: () => Promise<boolean>;
      summary: string;
      done: string;
    }) => {
      if (!activeProject) return;
      setMerging(true);
      try {
        const result = await writeCanonGuarded({
          projectPath: activeProject,
          edit,
          confirm,
          summary,
        });
        if (result.status === 'unchanged') emitToast('canon.json 里已经是这样了，没有改动。');
        if (result.status !== 'written') return;
        emitToast(done, {
          tone: 'success',
          action: {
            label: '撤销',
            run: async () => {
              try {
                await result.undo();
                emitToast('已撤销，canon.json 回到写入前。');
              } catch (error) {
                emitToast(message(error), { tone: 'error' });
              }
            },
          },
        });
      } catch (error) {
        console.error('写 canon.json 失败', error);
        emitToast(`没写进 canon.json：${message(error)}`, { tone: 'error' });
      } finally {
        setMerging(false);
      }
    },
    [activeProject],
  );

  const mergeProposal = useCallback(
    (target: CanonMergeTarget, label: string) =>
      writeCanon({
        edit: (canon) => applyCanonMerge(canon, target),
        confirm: () =>
          dialogs.confirm({
            title: '并入设定？',
            message: `${label}\n\n${CANON_WRITE_NOTE}`,
            confirmLabel: '并入',
          }),
        summary: `并入设定：${label}`,
        done: `已并入设定：${label}`,
      }),
    [dialogs, writeCanon],
  );

  const resolvePromise = useCallback(
    async (promise: ObservatoryPromise) => {
      const answer = await dialogs.prompt({
        title: `「${promise.title}」在第几章回收？`,
        message: `把这条伏笔标为已回收，并记下回收章。${CANON_WRITE_NOTE}`,
        defaultValue: String(state.promises.currentChapter ?? promise.plantedChapter ?? 1),
        confirmLabel: '标为已回收',
      });
      if (answer === null) return;
      const chapter = Number(answer.trim());
      if (!Number.isInteger(chapter) || chapter < 1) {
        emitToast('章号要写成正整数，这次没有写入。', { tone: 'error' });
        return;
      }
      if (promise.plantedChapter != null && chapter < promise.plantedChapter) {
        emitToast(
          `这条第 ${promise.plantedChapter} 章才埋下，不能在第 ${chapter} 章回收；这次没有写入。`,
          {
            tone: 'error',
          },
        );
        return;
      }
      await writeCanon({
        edit: (canon) => applyPromiseResolved(canon, promise.id, chapter),
        confirm: async () => true,
        summary: `伏笔已回收：${promise.title}（第 ${chapter} 章）`,
        done: `已把「${promise.title}」记为第 ${chapter} 章回收`,
      });
    },
    [dialogs, state.promises.currentChapter, writeCanon],
  );

  // 「不要」只是不再摆出来：记在本机、按作品分开，canon.json 一个字都不动。
  const setProposalDismissed = useCallback((project: string, key: string, on: boolean) => {
    const next = loadDismissedProposals(project);
    if (on) next.add(key);
    else next.delete(key);
    const saved = saveDismissedProposals(project, next);
    if (!saved) emitToast('本机存储写不进去，提案没有隐藏。', { tone: 'error' });
    return saved;
  }, []);
  useEffect(() => {
    const onChange = (event: Event) => {
      const project = (event as CustomEvent<{ project?: string }>).detail?.project;
      if (project && project === activeProject) setDismissed(loadDismissedProposals(project));
    };
    window.addEventListener(DISMISSED_PROPOSALS_EVENT, onChange);
    return () => window.removeEventListener(DISMISSED_PROPOSALS_EVENT, onChange);
  }, [activeProject]);
  const dismissProposal = useCallback(
    (target: CanonMergeTarget) => {
      if (!activeProject) return;
      const project = activeProject;
      const key = proposalKey(target);
      if (!setProposalDismissed(project, key, true)) return;
      emitToast('这条提案不要了（canon.json 没动）', {
        action: {
          label: '撤销',
          run: () => {
            setProposalDismissed(project, key, false);
          },
        },
      });
    },
    [activeProject, setProposalDismissed],
  );
  // 作废不先问：一键可撤销胜过先确认（写前快照 + 右下角撤销）。写完 facts.json 会触发重扫。
  const retireFact = useCallback(
    async (fact: ObservatoryFact) => {
      if (!activeProject) return;
      const label = factLabel(fact);
      try {
        const { undo } = await retireFactGuarded({
          projectPath: activeProject,
          factId: fact.id,
          label,
        });
        emitToast(`已作废：${label}。起草不再带它。`, {
          action: {
            label: '撤销',
            run: async () => {
              try {
                await undo();
              } catch (error) {
                emitToast(message(error), { tone: 'error' });
              }
            },
          },
        });
      } catch (error) {
        emitToast(`没有作废：${message(error)}`, { tone: 'error' });
      }
    },
    [activeProject],
  );
  const resolveDispute = useCallback(
    async (dispute: ObservatoryDispute, choice: 'accept' | 'reject') => {
      if (!activeProject) return;
      const what = dispute.attribute ? `${dispute.subject}的${dispute.attribute}` : dispute.subject;
      const label = `${what}「${dispute.value}」`;
      try {
        const { undo } = await resolveDisputeGuarded({
          projectPath: activeProject,
          factId: dispute.id,
          choice,
          label,
        });
        const done =
          choice === 'accept'
            ? `以本章为准：${label}，原来记的不再用。`
            : `保留已记的，不用本章的${label}。`;
        emitToast(done, {
          action: {
            label: '撤销',
            run: async () => {
              try {
                await undo();
              } catch (error) {
                emitToast(message(error), { tone: 'error' });
              }
            },
          },
        });
      } catch (error) {
        emitToast(`没有写入：${message(error)}`, { tone: 'error' });
      }
    },
    [activeProject],
  );
  // 每章一次模型调用，作者在分区里确认过才会到这里；一次写入、可整批撤销。
  const backfillFacts = useCallback(async () => {
    if (!activeProject || backfillingRef.current.has(activeProject)) return;
    const project = activeProject;
    const paths = unrecorded.slice(0, BACKFILL_BATCH).map((chapter) => chapter.path);
    if (!paths.length) return;
    backfillingRef.current.add(project);
    const progress = (done: number, total: number, path: string) =>
      setBackfill((current) => ({ ...current, [project]: { done, total, path } }));
    progress(0, paths.length, paths[0]);
    // 跑完时作者可能已在看别的作品：通知带上书的目录名，免得以为是当前这本。
    const prefix = () =>
      liveProjectRef.current === project ? '' : `「${project.split(/[\\/]/).pop()}」`;
    try {
      const { plan, undo } = await backfillFactsGuarded({
        projectPath: project,
        paths,
        onProgress: progress,
      });
      const failedOnly = plan.added === 0 && plan.chapters.some((item) => item.status === 'failed');
      emitToast(prefix() + backfillMessage(plan), {
        tone: failedOnly ? 'error' : 'info',
        action: undo
          ? {
              label: '撤销补录',
              run: async () => {
                try {
                  await undo();
                } catch (error) {
                  emitToast(message(error), { tone: 'error' });
                }
              },
            }
          : undefined,
      });
    } catch (error) {
      emitToast(`${prefix()}补录没完成：${message(error)}`, { tone: 'error' });
    } finally {
      backfillingRef.current.delete(project);
      setBackfill((current) => {
        const { [project]: _finished, ...rest } = current;
        return rest;
      });
    }
  }, [activeProject, unrecorded]);
  const factBackfill = useMemo(() => {
    const progress = (activeProject && backfill[activeProject]) || null;
    return { unrecorded, progress, start: backfillFacts };
  }, [activeProject, unrecorded, backfill, backfillFacts]);
  const proposals = useMemo(
    () => withoutDismissed(state.proposals, dismissed),
    [state.proposals, dismissed],
  );

  return {
    observations: state.observations,
    checkers: state.checkers,
    entities: state.entities,
    promises: state.promises,
    proposals,
    facts: state.facts,
    generatedAt: state.generatedAt,
    availability: state.availability,
    scanning,
    litEntityIds,
    merging,
    resolveObservation,
    mergeProposal,
    resolvePromise,
    dismissProposal,
    retireFact,
    resolveDispute,
    factBackfill,
    runScan,
  };
}
