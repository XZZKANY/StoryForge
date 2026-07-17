/**
 * 世界线观测：打开项目即首扫，写盘后防抖重扫（observatory.scan 为本地确定性纯函数，无 LLM 零成本）。
 *
 * 数据流：executeIdeCommand('observatory.scan') → payload.observatory → mapObservatoryPayload
 * → ObsPanel/StatusBar。已处理态（resolved）按稳定 id 记在前端，跨扫描保留；切项目清空。
 * 过期响应守卫：项目切换或新扫描发起后，旧响应一律丢弃（同 F26 会话切换守卫纪律）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Observation, ObservationAvailability } from '../shell/ObsPanel';
import { executeIdeCommand } from '../../lib/api/ide-commands';
import { EDITOR_CURSOR_LINE_EVENT, type EditorCursorLineDetail } from '../../lib/assistant-events';
import { FS_MUTATION_EVENT } from '../../lib/tauri-fs';
import {
  EMPTY_OBSERVATORY_PROMISES,
  EMPTY_OBSERVATORY_PROPOSALS,
  mapObservatoryPayload,
  matchEntityIdsInLine,
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
  const resolvedIdsRef = useRef<Set<string>>(new Set());
  const scanSeqRef = useRef(0);

  const runScan = useCallback(async () => {
    if (!activeProject) return;
    const seq = ++scanSeqRef.current;
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
    }
  }, [activeProject]);

  // 项目切换：使在途响应过期、清已处理记忆与观测；打开项目即首扫。
  useEffect(() => {
    scanSeqRef.current += 1;
    resolvedIdsRef.current = new Set();
    // 换项目重置观测态是外部 prop 驱动的本地清态（同 Editor 视图恢复的既有豁免）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      ...EMPTY_STATE,
      availability: activeProject ? 'loading' : 'unavailable',
    });
    setLitEntityIds([]);
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

  const resolveObservation = useCallback((id: string) => {
    resolvedIdsRef.current.add(id);
    setState((previous) => ({
      ...previous,
      observations: previous.observations.map((observation) =>
        observation.id === id ? { ...observation, resolved: true } : observation,
      ),
    }));
  }, []);

  return {
    observations: state.observations,
    checkers: state.checkers,
    entities: state.entities,
    promises: state.promises,
    proposals: state.proposals,
    generatedAt: state.generatedAt,
    availability: state.availability,
    litEntityIds,
    resolveObservation,
    runScan,
  };
}
