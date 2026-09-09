import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AssistantPanelFrame } from '../src/components/shell/AssistantPanelFrame';
import { ASSISTANT_PANEL_MIN_WIDTH, ASSISTANT_PANEL_WIDTH } from '../src/lib/workspace-layout';

function StatefulPanelContent() {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="panel-counter" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

test('折叠再展开 Agent 面板时保留已挂载的会话状态', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderPanel = (visible: boolean, wide = false) => {
    act(() => {
      root.render(
        <AssistantPanelFrame visible={visible} wide={wide}>
          <StatefulPanelContent />
        </AssistantPanelFrame>,
      );
    });
  };

  try {
    renderPanel(true);
    const counter = container.querySelector<HTMLButtonElement>('[data-testid="panel-counter"]');
    assert.ok(counter);
    act(() => counter.click());
    assert.equal(counter.textContent, '1');

    const frame = container.querySelector<HTMLElement>('[data-testid="assistant-panel"]');
    assert.ok(frame);
    assert.equal(frame.style.width, `${ASSISTANT_PANEL_WIDTH}px`);
    assert.equal(frame.style.minWidth, `${ASSISTANT_PANEL_MIN_WIDTH}px`);
    assert.equal(frame.classList.contains('flex-shrink-0'), false);
    renderPanel(true, true);
    assert.equal(frame.style.width, '');
    assert.equal(counter.isConnected, true);
    assert.equal(counter.textContent, '1');
    renderPanel(true);
    assert.equal(frame.style.width, `${ASSISTANT_PANEL_WIDTH}px`);

    renderPanel(false);
    const collapsed = container.querySelector<HTMLElement>('[data-testid="assistant-panel"]');
    assert.ok(collapsed);
    assert.equal(collapsed.hidden, true);
    assert.equal(counter.isConnected, true);

    renderPanel(true);
    assert.equal(counter.isConnected, true);
    assert.equal(counter.textContent, '1');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
