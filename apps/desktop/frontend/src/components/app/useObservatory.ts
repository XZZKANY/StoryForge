/**
 * 世界线观测：打开项目即首扫，写盘后防抖重扫（observatory.scan 为本地确定性纯函数，无 LLM 零成本）。
 *
 * 数据流：executeIdeCommand('observatory.scan') → payload.observatory → mapObservatoryPayload
 * → ObsPanel/StatusBar。已处理态（resolved）按稳定 id 记在前端，跨扫描保留；按项目落盘，跨重启保留。
 * 过期响应守卫：项目切换或新扫描发起后，旧响应一律丢弃（同 F26 会话切换守卫纪律）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Observation, ObservationAvailability } from '../shell/ObsPanel';
import { executeIdeCommand } from '../../lib/api/ide-commands';
import { EDITOR_CURSOR_LINE_EVENT, type EditorCursorLineDetail } from '../../lib/assistant-events';
import { mergeProposalIntoCanon, type CanonMergeTarget } from '../../lib/canon-merge';
import { emitToast } from '../../lib/toast';
import { FS_MUTATION_EVENT } from '../../lib/tauri-fs';
import {
  EMPTY_OBSERVATORY_PROMISES,
  EMPTY_OBSERVATORY_PROPOSALS,
  loadResolvedObservationIds,
  mapObservatoryPayload,
  matchEntityIdsInLine,
  saveResolvedObservationIds,
  type ObservatoryChecker,
  type ObservatoryEntity,
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
  generatedAt: string | null;
  availability: ObservationAvailability;
};

const EMPTY_STATE: ObservatoryState = {
  observations: [],
  checkers: [],
  entities: [],
  promises: EMPTY_OBSERVATORY_PROMISES,
  proposals: EMPTY_OBSERVATORY_PROPOSALS,
  generatedAt: null,
  availability: 'unavailable',
};

export function useObservatory({ activeProject }: { activeProject: string | null }) {
  const [state, setState] = useState<ObservatoryState>(EMPTY_STATE);
  const [litEntityIds, setLitEntityIds] = useState<string[]>([]);
  // scanning 独立于 availability：已有数据时重扫仍静默保留旧观测（availability 停 available），
  // 但按钮要转圈给反馈——此前 spinner 绑 availability='loading' 故有数据时点重扫毫无反应。
  const [scanning, setScanning] = useState(false);
  const [merging, setMerging] = useState(false);
  const resolvedIdsRef = useRef<Set<string>>(new Set());
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
        generatedAt: mapped.generatedAt,
        availability: 'available',
      });
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

  // 并入提案：读盘 → 追加 → 写回 canon.json。写盘会触发 FS_MUTATION_EVENT，
  // 防抖重扫后该条从后端差集里自然消失（自愈），故这里不必手改本地提案态。
  const mergeProposal = useCallback(
    async (target: CanonMergeTarget) => {
      if (!activeProject) return;
      setMerging(true);
      try {
        await mergeProposalIntoCanon(activeProject, target);
      } catch (error) {
        console.error('并入 canon 提案失败', error);
        emitToast(`并入失败：${error instanceof Error ? error.message : String(error)}`, {
          tone: 'error',
        });
      } finally {
        setMerging(false);
      }
    },
    [activeProject],
  );

  return {
    observations: state.observations,
    checkers: state.checkers,
    entities: state.entities,
    promises: state.promises,
    proposals: state.proposals,
    generatedAt: state.generatedAt,
    availability: state.availability,
    scanning,
    litEntityIds,
    merging,
    resolveObservation,
    mergeProposal,
    runScan,
  };
}
