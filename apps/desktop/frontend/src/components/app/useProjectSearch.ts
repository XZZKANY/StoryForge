import { useCallback, useEffect, useRef, useState } from 'react';

import { isVisibleProjectTreeEntry } from '../../lib/project/entry-visibility';
import {
  countHits,
  findHitsInContent,
  MAX_TOTAL_HITS,
  SEARCH_MIN_QUERY,
  type SearchFileResult,
} from '../../lib/project-search';
import { TauriFileSystem } from '../../lib/tauri-fs';

/** 同时在读的文件数上限：全并发会让几百章的项目一次性打满 IPC。 */
const READ_CONCURRENCY = 8;
const DEBOUNCE_MS = 220;

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

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
  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState('');
  const [capped, setCapped] = useState(false);
  const seqRef = useRef(0);

  const runSearch = useCallback(
    async (rawQuery: string, matchCase: boolean) => {
      const seq = ++seqRef.current;
      const trimmed = rawQuery.trim();
      if (!projectPath || trimmed.length < SEARCH_MIN_QUERY) {
        setResults([]);
        setStatus('idle');
        setError('');
        setCapped(false);
        return;
      }

      setStatus('searching');
      setError('');
      setCapped(false);

      try {
        const entries = await TauriFileSystem.listDir(projectPath, true);
        if (seq !== seqRef.current) return;
        const files = entries
          .filter(isVisibleProjectTreeEntry)
          .filter((entry) => !entry.isDir)
          .map((entry) => entry.path);

        const collected: SearchFileResult[] = [];
        let total = 0;
        let hitCap = false;

        for (let offset = 0; offset < files.length; offset += READ_CONCURRENCY) {
          if (seq !== seqRef.current) return;
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
                // 单个文件读不动（权限 / 正被占用）不该让整次搜索失败，跳过即可。
                return null;
              }
            }),
          );
          if (seq !== seqRef.current) return;

          for (const item of contents) {
            if (!item) continue;
            const { hits, truncated } = findHitsInContent(item.content, trimmed, {
              caseSensitive: matchCase,
            });
            if (hits.length === 0) continue;
            collected.push({ path: item.path, hits, truncated });
            total += hits.length;
          }
          // 边搜边出：长项目不至于一直空白等到最后。
          setResults([...collected]);
        }

        if (seq !== seqRef.current) return;
        setResults(collected);
        setCapped(hitCap || total >= MAX_TOTAL_HITS);
        setStatus('done');
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [projectPath],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(query, caseSensitive), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [caseSensitive, query, runSearch]);

  // 切项目后旧结果指向的是别的项目的路径，必须清掉。
  useEffect(() => {
    seqRef.current += 1;
    /* eslint-disable react-hooks/set-state-in-effect -- 换项目清搜索结果，同 useObservatory 既有豁免 */
    setResults([]);
    setStatus('idle');
    setError('');
    setCapped(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [projectPath]);

  return {
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    results,
    status,
    error,
    capped,
    totalHits: countHits(results),
    rerun: () => void runSearch(query, caseSensitive),
  };
}
