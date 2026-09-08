import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';
import { SidePanel } from '../src/components/shell/SidePanel';
import {
  clampSidePanelWidth,
  defaultSidePanelWidth,
  draggedSidePanelWidth,
  resolveSidePanelWidth,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from '../src/lib/side-panel-width';
import { sanitizeAppSettings } from '../src/lib/user-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('没拖过的视图吃档位默认：作品/手稿/观测镜宽，资源管理器窄', () => {
  assert.equal(defaultSidePanelWidth('explorer'), 236);
  assert.equal(defaultSidePanelWidth('search'), 236);
  for (const view of ['book', 'manuscript', 'observatory']) {
    assert.ok(defaultSidePanelWidth(view) > 300, `${view} 应比改前的 300px 更宽`);
  }
});

test('宽度一律夹限——手改过的 localStorage 不该把面板撑成 0 或 5000', () => {
  assert.equal(clampSidePanelWidth(10), SIDE_PANEL_WIDTH_MIN);
  assert.equal(clampSidePanelWidth(5000), SIDE_PANEL_WIDTH_MAX);
  assert.equal(clampSidePanelWidth(320.4), 320);
  assert.equal(clampSidePanelWidth(Number.NaN), 236);

  assert.equal(resolveSidePanelWidth('book', { book: 9999 }), SIDE_PANEL_WIDTH_MAX);
  assert.equal(resolveSidePanelWidth('book', { book: 420 }), 420);
  // 没记过的视图不受别的视图影响
  assert.equal(resolveSidePanelWidth('explorer', { book: 420 }), 236);

  const restored = sanitizeAppSettings({
    sidePanelWidths: { book: 9999, bad: 'x', explorer: 260 },
  });
  assert.deepEqual(restored.sidePanelWidths, { book: SIDE_PANEL_WIDTH_MAX, explorer: 260 });
});

test('拖拽宽度 = 起始宽 + 位移，两端夹住', () => {
  assert.equal(draggedSidePanelWidth(300, 60), 360);
  assert.equal(draggedSidePanelWidth(300, -60), 240);
  assert.equal(draggedSidePanelWidth(300, -9999), SIDE_PANEL_WIDTH_MIN);
  assert.equal(draggedSidePanelWidth(300, 9999), SIDE_PANEL_WIDTH_MAX);
});

function renderPanel(widths: Record<string, number>, maxWidth?: number) {
  const calls: Array<[string, number]> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (limit = maxWidth) =>
    act(() => {
      root.render(
        <SidePanel
          view="book"
          widths={widths}
          maxWidth={limit}
          onWidthChange={(view, width) => calls.push([view, width])}
          projects={[]}
          activeProject={null}
          currentFile={null}
          previewFile={null}
          projectRefreshVersion={0}
          onSelectProject={() => {}}
          onRemoveProject={() => {}}
          onOpenProject={() => {}}
          onNewFile={() => {}}
          onFileSelect={() => {}}
          onFilePreview={() => {}}
        />,
      );
    });
  render();
  const panel = container.querySelector<HTMLElement>('[data-testid="shell-side-panel"]');
  const handle = container.querySelector<HTMLElement>('[data-testid="side-panel-resize"]');
  assert.ok(panel && handle);
  return {
    panel,
    handle,
    calls,
    render,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('窗口临时收窄不改偏好，变宽后恢复；调宽语义报告显示值', () => {
  const widths = { book: 420 };
  const { panel, handle, calls, render, cleanup } = renderPanel(widths, 236);
  try {
    assert.equal(panel.style.width, '236px');
    assert.equal(handle.getAttribute('aria-valuenow'), '236');
    assert.equal(handle.getAttribute('aria-valuemax'), '236');
    render(720);
    assert.equal(panel.style.width, '420px');
    assert.equal(handle.getAttribute('aria-valuenow'), '420');
    assert.deepEqual(calls, []);
    assert.deepEqual(widths, { book: 420 });
  } finally {
    cleanup();
  }
});

test('窄窗口从显示宽度开始拖拽和键盘调整，不从较大的偏好宽度跳跃', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 420 }, 236);
  try {
    act(() =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    );
    assert.deepEqual(calls.pop(), ['book', 226]);
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 220 }));
    });
    assert.equal(panel.style.width, '220px');
    assert.deepEqual(calls, []);
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 220 })));
    assert.deepEqual(calls.pop(), ['book', 220]);
    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    assert.deepEqual(calls.pop(), ['book', 236]);
    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.deepEqual(calls.pop(), ['book', defaultSidePanelWidth('book')]);
  } finally {
    cleanup();
  }
});

test('取消拖拽或在松手前卸载，不提交偏好也不留下全局拖拽监听', () => {
  const first = renderPanel({ book: 420 }, 236);
  act(() => {
    first.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 210 }));
    window.dispatchEvent(new PointerEvent('pointercancel'));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 210 }));
  });
  assert.equal(first.panel.style.width, '236px');
  assert.deepEqual(first.calls, []);
  first.cleanup();

  const second = renderPanel({ book: 420 }, 236);
  act(() =>
    second.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 236, bubbles: true })),
  );
  second.cleanup();
  act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 210 })));
  assert.deepEqual(second.calls, []);
});

test('拖右缘把手改宽度，松手才落盘（拖拽中不写设置）', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 320 });
  try {
    assert.equal(panel.style.width, '320px');

    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 420 }));
    });
    assert.equal(panel.style.width, '420px', '拖拽中宽度应跟手');
    assert.deepEqual(calls, [], '拖拽中不该逐帧写设置——会把 localStorage 刷爆');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 420 }));
    });
    assert.deepEqual(calls, [['book', 420]], '松手才落一次');
  } finally {
    cleanup();
  }
});

test('松手后不再跟随指针——监听必须摘干净', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 320 });
  try {
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 320, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 400 }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700 }));
    });
    assert.equal(panel.style.width, '320px', '松手后应回到已保存宽度，不再跟手');
    assert.deepEqual(calls, [['book', 400]]);
  } finally {
    cleanup();
  }
});

test('双击把手复位到该视图的档位默认', () => {
  const { handle, calls, cleanup } = renderPanel({ book: 700 });
  try {
    act(() => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    assert.deepEqual(calls, [['book', defaultSidePanelWidth('book')]]);
  } finally {
    cleanup();
  }
});

test('侧栏分隔器可通过键盘调整、夹限与复位，提供名称和当前范围', () => {
  const { panel, handle, calls, cleanup } = renderPanel({ book: 320 });
  try {
    assert.equal(handle.getAttribute('role'), 'separator');
    assert.equal(handle.tabIndex, 0);
    assert.equal(handle.getAttribute('aria-label'), '调整侧栏宽度');
    assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
    assert.equal(handle.getAttribute('aria-controls'), panel.id);
    assert.equal(handle.getAttribute('aria-valuemin'), String(SIDE_PANEL_WIDTH_MIN));
    assert.equal(handle.getAttribute('aria-valuemax'), String(SIDE_PANEL_WIDTH_MAX));
    assert.equal(handle.getAttribute('aria-valuenow'), '320');
    for (const [key, shiftKey, expected] of [
      ['ArrowLeft', false, 310],
      ['ArrowRight', false, 330],
      ['ArrowRight', true, 370],
      ['Home', false, SIDE_PANEL_WIDTH_MIN],
      ['End', false, SIDE_PANEL_WIDTH_MAX],
      ['Enter', false, defaultSidePanelWidth('book')],
    ] as const) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => handle.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(calls.at(-1), ['book', expected]);
    }
    const before = calls.length;
    for (const options of [
      { key: 'Tab' },
      { key: 'ArrowRight', ctrlKey: true },
      { key: 'ArrowLeft', metaKey: true },
      { key: 'Home', altKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      act(() => handle.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false);
    }
    assert.equal(calls.length, before);
  } finally {
    cleanup();
  }
});

test('侧栏分隔器的方向键及加速调整不会超过现有宽度边界', () => {
  for (const [width, key] of [
    [SIDE_PANEL_WIDTH_MAX, 'ArrowRight'],
    [SIDE_PANEL_WIDTH_MIN, 'ArrowLeft'],
  ] as const) {
    const { handle, calls, cleanup } = renderPanel({ book: width });
    try {
      for (const shiftKey of [false, true]) {
        act(() =>
          handle.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })),
        );
      }
      assert.deepEqual(calls, [
        ['book', width],
        ['book', width],
      ]);
    } finally {
      cleanup();
    }
  }
});
