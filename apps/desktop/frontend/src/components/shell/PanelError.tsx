/**
 * 面板级错误态的统一皮。
 *
 * 此前文件树 / 故事索引 / 版本历史三处都是把原始 error 字符串整条铺出来，
 * 作者看到的是「无法读取文件 D:\连载\…\第003章.md: Access is denied. (os error 5)」
 * 这类东西：既不知道发生了什么，也不知道能做什么。
 *
 * 规矩：**一句人话说清发生了什么 + 明确的下一步（有重试就给按钮）+ 原始报错降级为细节**。
 * 原始报错不隐藏 —— 排障时它是唯一线索 —— 但它不该占据标题位。
 */
import type { ReactNode } from 'react';

export function PanelError({
  title,
  detail,
  hint,
  onRetry,
  retryLabel = '重试',
  compact = false,
}: {
  /** 一句人话：发生了什么。 */
  title: string;
  /** 原始报错，降级为细节行；没有就不渲染。 */
  detail?: string | null;
  /** 可选的下一步提示（无重试动作时尤其有用）。 */
  hint?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** 窄栏（文件树 / 故事索引）用更紧的排版。 */
  compact?: boolean;
}) {
  return (
    <div
      className={`${compact ? 'mx-2 mt-2 rounded-sm bg-error/10 p-2' : 'px-3 py-4'}`}
      role="alert"
      data-testid="panel-error"
    >
      <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} text-error`}>{title}</p>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
      {detail && (
        <p
          className="mt-1 break-words text-[11px] leading-relaxed text-subtle"
          data-testid="panel-error-detail"
        >
          {detail}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="panel-error-retry"
          className="mt-2 h-7 rounded-md border border-border-strong px-2.5 text-[12px] text-foreground hover:bg-elevated"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
