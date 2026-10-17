import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';

import { AssistantPanelFrame } from '../src/components/shell/AssistantPanelFrame';
import { ASSISTANT_PANEL_MIN_WIDTH } from '../src/lib/workspace-layout';

function StatefulPanelContent() {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="panel-counter" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: number[] = [];
  const resets = { count: 0 };
  const renderPanel = ({
    visible = true,
    wide = false,
    compact = false,
    width = 420,
    maxWidth = 600,
  } = {}) => {
    act(() => {
      root.render(
        <AssistantPanelFrame
          visible={visible}
          wide={wide}
          compact={compact}
          width={width}
          maxWidth={maxWidth}
          onWidthChange={(next) => calls.push(next)}
          onWidthReset={() => {
            resets.count += 1;
          }}
        >
          <StatefulPanelContent />
        </AssistantPanelFrame>,
      );
    });
  };
  const frame = () => container.querySelector<HTMLElement>('[data-testid="assistant-panel"]')!;
  const handle = () =>
    container.querySelector<HTMLElement>('[data-testid="assistant-panel-resize"]');
  return {
    container,
    renderPanel,
    frame,
    handle,
    calls,
    resets,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('折叠再展开 Agent 面板时保留已挂载的会话状态', () => {
  const { container, renderPanel, frame, cleanup } = mount();
  try {
    renderPanel();
    const counter = container.querySelector<HTMLButtonElement>('[data-testid="panel-counter"]');
    assert.ok(counter);
    act(() => counter.click());
    assert.equal(counter.textContent, '1');

    assert.equal(frame().style.width, '420px');
    assert.equal(frame().style.minWidth, `${ASSISTANT_PANEL_MIN_WIDTH}px`);
    assert.equal(frame().classList.contains('flex-shrink-0'), false);
    renderPanel({ wide: true });
    assert.equal(frame().style.width, '');
    assert.equal(counter.isConnected, true);
    assert.equal(counter.textContent, '1');
    renderPanel({ width: 518 });
    assert.equal(frame().style.width, '518px', '宽度跟着调用方按窗口换算出的值走');

    renderPanel({ visible: false });
    assert.equal(frame().hidden, true);
    assert.equal(counter.isConnected, true);

    renderPanel();
    assert.equal(counter.isConnected, true);
    assert.equal(counter.textContent, '1');
  } finally {
    cleanup();
  }
});

test('对话栏左缘把手：往左拖变宽、往右拖变窄，松手才提交一次，夹在上下限内', () => {
  const { renderPanel, frame, handle, calls, cleanup } = mount();
  try {
    renderPanel();
    const grip = handle();
    assert.ok(grip);
    assert.equal(grip.getAttribute('aria-label'), '调整对话栏宽度');
    assert.equal(grip.getAttribute('aria-controls'), frame().id);
    assert.equal(grip.getAttribute('aria-valuemax'), '600');
    act(() => {
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 940 }));
    });
    assert.equal(frame().style.width, '480px', '左缘往左拖 60px，对话栏宽 60px');
    assert.deepEqual(calls, []);
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 900 })));
    assert.deepEqual(calls, [520]);
    act(() => {
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 300 }));
    });
    assert.equal(calls.at(-1), 600, '拖过头停在此刻的上限');
    act(() => {
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 1900 }));
    });
    assert.equal(calls.at(-1), ASSISTANT_PANEL_MIN_WIDTH);
  } finally {
    cleanup();
  }
});

test('对话栏把手的方向键与把手在屏幕上的移动方向一致，Enter / 双击复位到默认比例', () => {
  const { renderPanel, handle, calls, resets, cleanup } = mount();
  try {
    renderPanel();
    const grip = handle()!;
    for (const [key, shiftKey, expected] of [
      ['ArrowLeft', false, 430],
      ['ArrowRight', false, 410],
      ['ArrowLeft', true, 470],
      ['Home', false, ASSISTANT_PANEL_MIN_WIDTH],
      ['End', false, 600],
    ] as const) {
      act(() => grip.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })));
      assert.equal(calls.at(-1), expected, `${key}${shiftKey ? '+Shift' : ''}`);
    }
    act(() => grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    assert.equal(resets.count, 2);
  } finally {
    cleanup();
  }
});

test('对话聚焦（占满中右）与窄窗口轮流显示时没有把手', () => {
  const { renderPanel, handle, cleanup } = mount();
  try {
    renderPanel({ wide: true });
    assert.equal(handle(), null);
    renderPanel({ compact: true });
    assert.equal(handle(), null);
    renderPanel();
    assert.ok(handle());
  } finally {
    cleanup();
  }
});
