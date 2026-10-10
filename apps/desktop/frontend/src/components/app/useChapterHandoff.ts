/**
 * 「接着写」取数：以「下一章」为当前文件向 `book.context` 要上一章结尾，再与章节列表、
 * 伏笔台账拼成交接（`lib/chapter-handoff.ts`）。
 *
 * 为什么另发一次 `book.context` 而不读 useBookContext 的快照：那份快照跟着当前页签走，
 * 刚打开作品时没有当前文件，后端就不给上一章结尾。按下一章问，后端走同一条阅读序
 * （未创建的章节也参与排序），拿到的正是最后一章的结尾——与起草下一章时模型收到的同一段。
 * 只读、无 LLM、零成本。
 *
 * 过期守卫同 useBookContext：项目或目标变化后，在途响应一律丢弃。
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { executeIdeCommand } from '../../lib/api/ide-commands';
import { nextChapterWriteRequest } from '../../lib/assistant-events';
import { mapBookContextPayload } from '../../lib/book-context';
import {
  buildChapterHandoff,
  type ChapterHandoff,
  type HandoffChapter,
} from '../../lib/chapter-handoff';
import type { ObservatoryPromises } from '../../lib/observations';

type PreviousChapter = { relativePath: string; tail: string } | null;

export function useChapterHandoff({
  projectPath,
  chapters,
  promises,
  enabled = true,
}: {
  projectPath: string | null;
  /** 后端阅读序章节（book.context）；尚未读到时传 null，不当成空手稿。 */
  chapters: ReadonlyArray<HandoffChapter & { estimatedChars?: number | null }> | null;
  promises: ObservatoryPromises | null;
  enabled?: boolean;
}): ChapterHandoff | null {
  const [fetched, setFetched] = useState<{ key: string; previous: PreviousChapter } | null>(null);
  const seqRef = useRef(0);

  const target =
    chapters && chapters.length > 0 ? nextChapterWriteRequest(chapters).targetPath : null;
  const last = chapters?.reduce<(typeof chapters)[number] | null>(
    (latest, chapter) => (latest === null || chapter.ordinal > latest.ordinal ? chapter : latest),
    null,
  );
  // 最后一章字数变了，结尾多半也变了：带进 key，写完回来看到的是新结尾。
  const key =
    projectPath && target && last
      ? [projectPath, target, last.relativePath, last.estimatedChars ?? ''].join('\u0000')
      : null;

  useEffect(() => {
    if (!enabled || !key || !projectPath || !target) return;
    const seq = ++seqRef.current;
    void executeIdeCommand('book.context', { project_root: projectPath, current_file: target })
      .then((result) => {
        if (seq !== seqRef.current) return;
        const payload = (result as { payload?: { book_context?: unknown } }).payload?.book_context;
        setFetched({ key, previous: mapBookContextPayload(payload)?.previousChapter ?? null });
      })
      .catch((error: unknown) => {
        if (seq !== seqRef.current) return;
        // 拿不到结尾只是少一句引文，交接其余部分照常显示。
        console.error('读取上一章结尾失败', error);
        setFetched({ key, previous: null });
      });
    return () => {
      seqRef.current += 1;
    };
  }, [enabled, key, projectPath, target]);

  const previousChapter = fetched && fetched.key === key ? fetched.previous : null;
  return useMemo(
    () =>
      projectPath && chapters ? buildChapterHandoff({ chapters, previousChapter, promises }) : null,
    [chapters, previousChapter, projectPath, promises],
  );
}
