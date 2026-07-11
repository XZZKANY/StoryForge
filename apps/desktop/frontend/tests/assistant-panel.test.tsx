import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AssistantPanelFrame } from '../src/components/shell/AssistantPanelFrame';

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

  const renderPanel = (visible: boolean) => {
    act(() => {
      root.render(
        <AssistantPanelFrame visible={visible}>
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
