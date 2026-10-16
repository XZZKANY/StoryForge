/**
 * 作品底座取数：打开项目 / 切换当前文件即重取，写盘后防抖重取。
 *
 * `book.context` 是纯只读投影（stat + 读 canon 缓存，不写盘、无 LLM、零成本），所以敢跟着
 * 当前文件变化走——底座里的「当前第几章」必须跟得上作者切页签，否则左栏会长期显示错的章号。
 *
 * 过期响应守卫沿用 useObservatory 的纪律（同 F26 会话切换守卫）：项目切换或新请求发起后，
 * 旧响应一律丢弃，否则慢响应会把上一个项目的手稿写进当前面板。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { executeIdeCommand } from '../../lib/api/ide-commands';
import { FS_MUTATION_EVENT } from '../../lib/tauri-fs';
import { mapBookContextPayload, type BookContextSnapshot } from '../../lib/book-context';

// 与观测镜同档：autoSave 防抖 900ms 之上再叠一层，连续小写只触发一次重取。
const REFRESH_DEBOUNCE_MS = 1200;

/** 连不上（fetch 的 TypeError）或只有状态码的失败没什么可告诉作者的，其余是命令给的原文。 */
function authorFacingError(error: unknown): string | null {
  if (!(error instanceof Error) || error instanceof TypeError) return null;
  const message = error.message.trim();
  return message && !/^API 返回 \d+$/.test(message) ? message : null;
}

export type BookContextAvailability = 'unavailable' | 'loading' | 'available' | 'error';

export type BookContextHandle = {
  snapshot: BookContextSnapshot | null;
  availability: BookContextAvailability;
  /** 读取失败时给作者看的原文（比如作者声明哪一行写错了）；没有可说的就是 null。 */
  errorMessage: string | null;
  refreshing: boolean;
  refresh: () => void;
};

export function useBookContext({
  activeProject,
  currentFile,
}: {
  activeProject: string | null;
  currentFile: string | null;
}): BookContextHandle {
  const [snapshot, setSnapshot] = useState<BookContextSnapshot | null>(null);
  const [availability, setAvailability] = useState<BookContextAvailability>('unavailable');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seqRef = useRef(0);
  // 上一次取数的项目：只有换项目才该清空面板，切页签也清会让章节列表每次闪一下。
  const loadedProjectRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!activeProject) return;
    const seq = ++seqRef.current;
    setRefreshing(true);
    setAvailability((previous) => (previous === 'available' ? 'available' : 'loading'));
    try {
      const result = await executeIdeCommand('book.context', {
        project_root: activeProject,
        ...(currentFile ? { current_file: currentFile } : {}),
      });
      if (seq !== seqRef.current) return;
      const payload = (result as { payload?: { book_context?: unknown } }).payload?.book_context;
      const mapped = mapBookContextPayload(payload);
      if (!mapped) {
        // 形状不对就如实报错，不拿空手稿糊弄——空列表会让作者以为书里没东西。
        setErrorMessage(null);
        setAvailability('error');
        return;
      }
      setSnapshot(mapped);
      setErrorMessage(null);
      setAvailability('available');
    } catch (error) {
      if (seq !== seqRef.current) return;
      console.error('读取作品底座失败', error);
      setErrorMessage(authorFacingError(error));
      setAvailability('error');
    } finally {
      if (seq === seqRef.current) setRefreshing(false);
    }
  }, [activeProject, currentFile]);

  // 项目或当前文件任一变化都重取（load 的依赖已含两者）；换项目额外清空并作废在途响应，
  // 否则上一个项目的章节列表会短暂留在新项目的面板上。
  useEffect(() => {
    seqRef.current += 1;
    if (loadedProjectRef.current !== activeProject) {
      loadedProjectRef.current = activeProject;
      setSnapshot(null);
      setErrorMessage(null);
      setAvailability(activeProject ? 'loading' : 'unavailable');
      setRefreshing(false);
    }
    // load 起手就置 loading（与 useObservatory 首扫同规矩）：这里的「effect 内同步 setState」
    // 是外部 prop（项目 / 当前文件）驱动的取数起点，不是渲染派生态。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeProject) void load();
  }, [activeProject, load]);

  useEffect(() => {
    if (!activeProject) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFsMutation = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(FS_MUTATION_EVENT, onFsMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(FS_MUTATION_EVENT, onFsMutation);
    };
  }, [activeProject, load]);

  const refresh = useCallback(() => void load(), [load]);

  return { snapshot, availability, errorMessage, refreshing, refresh };
}
