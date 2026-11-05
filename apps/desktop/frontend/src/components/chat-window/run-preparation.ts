import { flushActiveEditorToDisk } from '../../lib/assistant-events';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
import { resolveProjectRelativePath } from '../../lib/project-context';
import type { RunAuthorAgentOptions, RetryRequest } from './types';
import type { ChatWindowState } from './useChatWindowState';

/** 停止属于这一次连续修改请求；不会把新运行的状态改成 stopped。 */
export function createRevisionStopGuard(
  signal: AbortSignal | undefined,
  runId: string,
  ownsRun: () => boolean,
  {
    setAgentBusy,
    setAgentRun,
    textStream,
  }: Pick<ChatWindowState, 'setAgentBusy' | 'setAgentRun' | 'textStream'>,
) {
  let requestSent = false;
  return {
    get requestSent() {
      return requestSent;
    },
    markSent: () => {
      requestSent = true;
    },
    stop: () => {
      if (!signal?.aborted) return false;
      if (ownsRun()) {
        setAgentBusy(false);
        setAgentRun((run) => (run?.id === runId ? { ...run, status: 'stopped' } : run));
        textStream.settle(
          runId,
          {
            kind: 'diagnostic',
            detail: requestSent
              ? '连续修改已停止，未交付迟到的修订；请核对本轮状态。'
              : '连续修改已停止，本章未发送给 AI。',
          },
          'stopped',
        );
      }
      return true;
    },
  };
}

type PreparedRunFile =
  | {
      kind: 'ready';
      content: string | null;
      revisionTarget: string | null;
      contextFile: string | null;
    }
  | { kind: 'abandoned' }
  | { kind: 'cancelled' };

/** 读取实际目标全文，每次连续修改的异步准备完成后先核归属，再核停止。 */
export async function prepareRunFile({
  project,
  file,
  ref,
  intent,
  options,
  abandonIfTaskMoved,
  stopPreparation,
}: {
  project: string;
  file: string | null;
  ref: string | null;
  intent: RetryRequest['intent'];
  options: RunAuthorAgentOptions;
  abandonIfTaskMoved: () => boolean;
  stopPreparation: () => boolean;
}): Promise<PreparedRunFile> {
  let content: string | null = null;
  const revisionTarget = options.revisionTargetFilePath
    ? resolveProjectRelativePath(project, options.revisionTargetFilePath)
    : null;
  if (options.revisionTargetFilePath && (!revisionTarget || intent !== 'file.revise'))
    throw new Error('连续修改的目标文件无效。');
  if (revisionTarget) {
    await flushActiveEditorToDisk(revisionTarget);
    if (abandonIfTaskMoved()) return { kind: 'abandoned' };
    if (stopPreparation()) return { kind: 'cancelled' };
    content = await TauriFileSystem.readProjectFile(project, revisionTarget);
    if (abandonIfTaskMoved()) return { kind: 'abandoned' };
    if (stopPreparation()) return { kind: 'cancelled' };
    if (!content.trim()) throw new Error('目标章节没有正文，连续修改已停止。');
  }
  // 新章不把当前编辑器当目标正文；已保存当前文件仍可作为普通参考。
  if (!revisionTarget && file && ref && !options.targetFilePath && !options.planFallback) {
    await flushActiveEditorToDisk(file);
    content = await TauriFileSystem.readProjectFile(project, file);
  }
  const contextFile =
    revisionTarget ??
    (options.targetFilePath
      ? resolveProjectRelativePath(project, options.targetFilePath)
      : options.planFallback
        ? null
        : file);
  return { kind: 'ready', content, revisionTarget, contextFile };
}
