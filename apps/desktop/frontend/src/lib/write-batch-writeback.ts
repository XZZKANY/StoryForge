/**
 * 批量写章的交接口：调度器要等「这一章写进文件、事实记账落定」才记一笔、问引擎下一步（下一章的章纲要读已写事实）。
 * 编辑器接受整份写章修订、事实记账落定后，按运行 id 把结果交到这里；调度器按同一个 id 来取。
 * 平时一章一章写也会交，但没人取：只留最近几条，不影响编辑器那边不等记账的老行为。
 */
import type { AcceptedChapterFacts } from './fact-write';
import { relativePathInsideProject } from './project/path';

export type ChapterWriteback =
  | {
      written: true;
      /** 写进的文件（编辑器打开它用的绝对路径）。 */
      filePath: string;
      /** 写前快照那条版本记录（作品内相对路径，`/` 分隔）；这次没拍快照为 null。 */
      snapshotVersion: string | null;
      /** 记账前给事实台账拍的那条版本记录；这次没写台账为 null。 */
      factsBefore: string | null;
      /** 和已记事实对不上、存成待定的条数。 */
      factDisputes: number;
      /** 新记下的事实条数（不含待定的）；没记账或记账出错为 null。 */
      factsAdded: number | null;
      /** 正文写进去了，但事实没记上：调度器据此停下，不带着漏掉的事实写下一章。 */
      factError: string | null;
    }
  | { written: false; reason: string };

const KEEP = 16;
const delivered = new Map<string, Promise<ChapterWriteback>>();
const waiters = new Map<string, (result: Promise<ChapterWriteback>) => void>();

/** 编辑器交结果；result 可以是还在记账的 Promise。同一次运行再交一次以后交的为准。 */
export function reportChapterWriteback(
  runId: string | null | undefined,
  result: ChapterWriteback | Promise<ChapterWriteback>,
): void {
  if (!runId) return;
  const promise = Promise.resolve(result);
  // 没人等时也不能留下未处理的拒绝。
  promise.catch(() => undefined);
  const waiter = waiters.get(runId);
  if (waiter) {
    waiters.delete(runId);
    waiter(promise);
    return;
  }
  delivered.delete(runId);
  delivered.set(runId, promise);
  while (delivered.size > KEEP) delivered.delete(delivered.keys().next().value as string);
}

export class ChapterWritebackAbortedError extends Error {
  constructor() {
    super('不再等这一章写进文件了。');
    this.name = 'ChapterWritebackAbortedError';
  }
}

/**
 * 等这次运行的修订写进文件、事实记账落定。等过 timeoutMs 还没结果就当没写进去（交给引擎判「被保护拦下」）；
 * signal 中止（换作品、卸载）就抛 ChapterWritebackAbortedError。
 */
export function awaitChapterWriteback(
  runId: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ChapterWriteback> {
  const { signal, timeoutMs } = options;
  if (signal?.aborted) return Promise.reject(new ChapterWritebackAbortedError());
  return new Promise<ChapterWriteback>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (waiters.get(runId) === adopt) waiters.delete(runId);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(new ChapterWritebackAbortedError()));
    const timer = setTimeout(
      () =>
        finish(() =>
          resolve({
            written: false,
            reason: `等了 ${Math.round(timeoutMs / 1000)} 秒，这一章还没写进文件。`,
          }),
        ),
      timeoutMs,
    );
    const adopt = (result: Promise<ChapterWriteback>) =>
      void result.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    signal?.addEventListener('abort', onAbort, { once: true });
    const ready = delivered.get(runId);
    if (ready) {
      delivered.delete(runId);
      adopt(ready);
    } else waiters.set(runId, adopt);
  });
}

/** 版本记录的绝对路径换成作品内相对路径（`/` 分隔），存进批量记录；不在作品里为 null。 */
export function versionRecordRef(
  projectPath: string | null,
  recordPath: string | null | undefined,
): string | null {
  if (!projectPath || !recordPath) return null;
  return relativePathInsideProject(projectPath, recordPath)?.replace(/\\/g, '/') ?? null;
}

/** 正文已经写进去：等事实记账落定，连同写前快照一起交给调度器。记账出错也算写进去了，原因放 factError。 */
export async function writtenChapter(
  projectPath: string | null,
  filePath: string,
  snapshotPath: string | null,
  facts: Promise<AcceptedChapterFacts> | null,
): Promise<ChapterWriteback> {
  const settled = facts ? await facts : null;
  return {
    written: true,
    filePath,
    snapshotVersion: versionRecordRef(projectPath, snapshotPath),
    factsBefore: versionRecordRef(projectPath, settled?.snapshotPath),
    factDisputes: settled?.disputes ?? 0,
    factsAdded: settled && !settled.error ? settled.added : null,
    factError: settled?.error ?? null,
  };
}
