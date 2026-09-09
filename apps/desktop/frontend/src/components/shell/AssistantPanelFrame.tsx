import type { ReactNode } from 'react';
import {
  ASSISTANT_PANEL_MIN_WIDTH,
  ASSISTANT_PANEL_WIDTH,
  WORKSPACE_PRIMARY_MIN_WIDTH,
} from '../../lib/workspace-layout';

export function AssistantPanelFrame({
  visible,
  wide = false,
  children,
}: {
  visible: boolean;
  // 对话聚焦占满中右；平衡态保留默认宽度，小窗口允许适度收窄。
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`${visible ? 'flex' : 'hidden'} min-h-0 ${wide ? 'flex-1' : 'shrink'} flex-col overflow-hidden border-l border-border bg-panel`}
      style={{
        width: wide ? undefined : ASSISTANT_PANEL_WIDTH,
        minWidth: wide ? WORKSPACE_PRIMARY_MIN_WIDTH : ASSISTANT_PANEL_MIN_WIDTH,
      }}
      data-testid="assistant-panel"
      data-wide={wide ? 'true' : 'false'}
      hidden={!visible}
    >
      {children}
    </section>
  );
}
