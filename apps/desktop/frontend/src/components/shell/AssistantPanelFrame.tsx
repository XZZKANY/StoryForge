import type { ReactNode } from 'react';

export function AssistantPanelFrame({
  visible,
  wide = false,
  children,
}: {
  visible: boolean;
  // Q4 对话聚焦（chat 布局）：右栏占满中右，取代固定 384px；平时仍是固定侧栏宽。
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`${visible ? 'flex' : 'hidden'} min-h-0 ${wide ? 'flex-1' : 'w-[384px] flex-shrink-0'} flex-col overflow-hidden border-l border-border bg-panel`}
      data-testid="assistant-panel"
      data-wide={wide ? 'true' : 'false'}
      hidden={!visible}
    >
      {children}
    </section>
  );
}
