import { useId, type ReactNode } from 'react';
import { ASSISTANT_PANEL_MIN_WIDTH, WORKSPACE_PRIMARY_MIN_WIDTH } from '../../lib/workspace-layout';
import { usePanelResize } from './usePanelResize';

export function AssistantPanelFrame({
  visible,
  wide = false,
  compact = false,
  width,
  maxWidth,
  onWidthChange,
  onWidthReset,
  children,
}: {
  visible: boolean;
  // 对话聚焦占满中右；平衡态按窗口换算出的宽度摆，左缘可拖（存成比例，窗口变了跟着变）。
  wide?: boolean;
  compact?: boolean;
  width: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onWidthReset: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  const { displayWidth, handle } = usePanelResize({
    width,
    min: ASSISTANT_PANEL_MIN_WIDTH,
    max: maxWidth,
    edge: 'left',
    controlsId: panelId,
    label: '调整对话栏宽度',
    testId: 'assistant-panel-resize',
    onCommit: onWidthChange,
    onReset: onWidthReset,
  });
  return (
    <section
      id={panelId}
      className={`${visible ? 'flex' : 'hidden'} relative min-h-0 ${wide ? 'flex-1' : 'shrink'} flex-col overflow-hidden bg-panel`}
      style={{
        width: wide ? undefined : displayWidth,
        minWidth: compact ? 0 : wide ? WORKSPACE_PRIMARY_MIN_WIDTH : ASSISTANT_PANEL_MIN_WIDTH,
      }}
      data-testid="assistant-panel"
      data-wide={wide ? 'true' : 'false'}
      hidden={!visible}
    >
      {!wide && !compact && handle}
      {children}
    </section>
  );
}
