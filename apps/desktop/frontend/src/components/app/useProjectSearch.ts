import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { isVisibleProjectTreeEntry } from '../../lib/project/entry-visibility';
import {
  countHits,
  findHitsInContent,
  MAX_TOTAL_HITS,
  MAX_HITS_PER_FILE,
  SEARCH_MIN_QUERY,
  type SearchFileResult,
} from '../../lib/project-search';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../../lib/tauri-fs';

/** 同时在读的文件数上限：全并发会让几百章的项目一次性打满 IPC。 */
const READ_CONCURRENCY = 8;
const DEBOUNCE_MS = 220;

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';
type SearchState = {
  results: SearchFileResult[];
  status: SearchStatus;
  error: string;
  capped: boolean;
  unreadableCount: number;
};
const EMPTY_SEARCH: SearchState = {
  results: [],
  status: 'idle',
  error: '',
  capped: false,
  unreadableCount: 0,
};

/**
 * 项目全文搜索。走 readProjectFile（Rust 侧带路径 containment 校验，见 PR #118），
 * 不用无校验的 read_file。
 *
 * 取消语义与观测扫描同一纪律：每次搜索递增 seq，过期响应一律丢弃 ——
 * 否则打字快一点就会看到上一次查询的结果盖住这一次的。
 */
export function useProjectSearch(projectPath: string | null) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const scope = useMemo(
    () => ({ projectPath, query, caseSensitive, fileVersion }),
    [projectPath, query, caseSensitive, fileVersion],
  );
  const [stored, setStored] = useState<{ scope: typeof scope | null; value: SearchState }>({
    scope: null,
    value: EMPTY_SEARCH,
  });
  const lifetimeRef = useRef<{ scope: typeof scope; seq: number } | null>(null);
  useLayoutEffect(() => {
    lifetimeRef.current = { scope, seq: 0 };
    return () => {
      lifetimeRef.current = null;
    };
  }, [scope]);
  const pending = Boolean(projectPath && query.trim().length >= SEARCH_MIN_QUERY);
  const current =
    stored.scope === scope
      ? stored.value
      : { ...EMPTY_SEARCH, status: pending ? ('searching' as const) : ('idle' as const) };

  const runSearch = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    if (!lifetime || lifetime.scope !== scope) return;
    const seq = ++lifetime.seq;
    const isCurrent = () => lifetimeRef.current === lifetime && lifetime.seq === seq;
    const commit = (update: Partial<SearchState>) => {
      if (!isCurrent()) return;
      setStored((previous) => ({
        scope,
        value: { ...(previous.scope === scope ? previous.value : EMPTY_SEARCH), ...update },
      }));
    };
    const { projectPath, query: rawQuery, caseSensitive: matchCase } = scope;
    const trimmed = rawQuery.trim();
    if (!projectPath || trimmed.length < SEARCH_MIN_QUERY) {
      commit(EMPTY_SEARCH);
      return;
    }
    commit({ status: 'searching', error: '', capped: false, unreadableCount: 0 });

    try {
      const entries = await TauriFileSystem.listDir(projectPath, true);
      if (!isCurrent()) return;
      const files = entries
        .filter(isVisibleProjectTreeEntry)
        .filter((entry) => !entry.isDir)
        .map((entry) => entry.path);

      const collected: SearchFileResult[] = [];
      let total = 0;
      let hitCap = false;
      let unreadableCount = 0;

      for (let offset = 0; offset < files.length; offset += READ_CONCURRENCY) {
        if (!isCurrent()) return;
        if (total >= MAX_TOTAL_HITS) {
          hitCap = true;
          break;
        }
        const batch = files.slice(offset, offset + READ_CONCURRENCY);
        const contents = await Promise.all(
          batch.map(async (path) => {
            try {
              return { path, content: await TauriFileSystem.readProjectFile(projectPath, path) };
            } catch {
              // 保留可读文件的命中，但必须说明结果不完整。
              unreadableCount += 1;
              return null;
            }
          }),
        );
        if (!isCurrent()) return;

        for (const item of contents) {
          if (total >= MAX_TOTAL_HITS) {
            hitCap = true;
            break;
          }
          if (!item) continue;
          const { hits, truncated } = findHitsInContent(item.content, trimmed, {
            caseSensitive: matchCase,
            maxHits: Math.min(MAX_HITS_PER_FILE, MAX_TOTAL_HITS - total),
          });
          if (hits.length === 0) continue;
          collected.push({ path: item.path, hits, truncated });
          total += hits.length;
        }
        // 边搜边出：长项目不至于一直空白等到最后。
        commit({ results: [...collected], unreadableCount });
      }

      if (!isCurrent()) return;
      commit({
        results: collected,
        capped: hitCap || total >= MAX_TOTAL_HITS,
        status: 'done',
        unreadableCount,
      });
    } catch (err) {
      if (!isCurrent()) return;
      commit({ error: err instanceof Error ? err.message : String(err), status: 'error' });
    }
  }, [scope]);

  useEffect(() => {
    if (!projectPath || query.trim().length < SEARCH_MIN_QUERY) return;
    // Invalidate immediately; the existing debounce coalesces save/writeback event bursts.
    const onMutation = () => setFileVersion((version) => version + 1);
    window.addEventListener(FS_MUTATION_EVENT, onMutation);
    return () => window.removeEventListener(FS_MUTATION_EVENT, onMutation);
  }, [projectPath, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [caseSensitive, query, runSearch]);

  return {
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    ...current,
    totalHits: countHits(current.results),
    rerun: () => void runSearch(),
  };
}
