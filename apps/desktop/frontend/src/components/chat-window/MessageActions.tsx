/**
 * AI 回复下面的小操作（作者 10-17 巡检：单条消息上什么都做不了）：复制这条回复；
 * 最后一条回复还能「重新生成」——把它前面作者那句话再发一次。
 */
import { Copy, RefreshCw } from '../icons/shell-icons';
import { Button } from '../ui';

import { emitToast } from '../../lib/toast';

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('剪贴板不可用');
}

export function MessageActions({
  content,
  onRegenerate,
  copiedToast = '已复制这条回复',
  className = '',
}: {
  content: string;
  onRegenerate?: () => void;
  copiedToast?: string;
  className?: string;
}) {
  return (
    <div className={`mt-1 flex items-center gap-1 ${className}`} data-testid="message-actions">
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={<Copy size={12} strokeWidth={1.7} />}
        onClick={() =>
          void writeClipboard(content).then(
            () => emitToast(copiedToast),
            (error: unknown) =>
              emitToast(`复制失败：${error instanceof Error ? error.message : String(error)}`, {
                tone: 'error',
              }),
          )
        }
        data-testid="message-copy"
      >
        复制
      </Button>
      {onRegenerate && (
        <Button
          variant="ghost"
          size="compact"
          leadingIcon={<RefreshCw size={12} strokeWidth={1.7} />}
          onClick={onRegenerate}
          data-testid="message-regenerate"
          title="把上面那句话再发一次，让 AI 重新回答"
        >
          重新生成
        </Button>
      )}
    </div>
  );
}
