import type { ReactNode } from 'react';

/**
 * 贴在输入框顶边的小条：批量写章进度、本轮参考资料各占一行，比输入框窄一圈、下沿压在输入框边框上，
 * 不再各自是一张悬在输入框上方的卡。各行自己决定出不出，全不出时整条收起。
 */
export function ComposerDock({ children }: { children?: ReactNode }) {
  return (
    <div
      data-testid="composer-dock"
      className="mx-3 flex flex-col divide-y divide-border/60 rounded-t-lg border border-b-0 border-border bg-elevated/50 empty:hidden"
    >
      {children}
    </div>
  );
}
