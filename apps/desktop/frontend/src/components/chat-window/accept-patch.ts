import {
  emitAcceptCurrentFileSuggestion,
  reofferPendingFileSuggestion,
  type AcceptClaim,
  type FileSuggestionTarget,
} from '../../lib/assistant-events';
import { emitToast } from '../../lib/toast';
import { relativePath } from './path-utils';

/** 对话框里点「接受」：交给编辑器写；没接住时说清去哪里接受，不笼统报「目标仍在打开」。 */
export function acceptPatchFromChat(
  target: FileSuggestionTarget,
  projectPath: string | null,
): AcceptClaim {
  const claim = emitAcceptCurrentFileSuggestion(target);
  if (claim === 'busy') emitToast('正在处理这份修订，请稍候', { tone: 'info' });
  // 半截稿不在对话里一键写进去：编辑器横幅已武装，要作者看过对比后在那里再点一次。
  if (claim === 'armed')
    emitToast(
      '这份修订可能没写完，没有写入。请到编辑器里看过对比；要整份写入，在横幅上点「接受」后再点一次「仍然整份接受」。',
      { tone: 'info' },
    );
  if (claim !== 'unclaimed') return claim;
  const name = relativePath(projectPath, target.filePath);
  emitToast(
    reofferPendingFileSuggestion(target)
      ? `已在编辑器打开 ${name}，看过对比后再点一次接受`
      : `编辑器里没有这份修订，请先打开 ${name}`,
    { tone: 'info' },
  );
  return claim;
}
